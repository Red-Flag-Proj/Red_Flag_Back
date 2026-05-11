const { pool } = require('../db/pool');
const { detectTransactionWithFraudGuard } = require('./fraudguard.service');
const { decideInitialResponse } = require('./response-policy.service');
const { addActionLog, listActionLogs } = require('./action.service');
const {
  buildAutomaticResponseActions,
  addResponseActions,
  applyAutomaticSideEffects,
  createCallVerificationIfNeeded,
  listCallVerifications,
  listResponseActions
} = require('./response-action.service');
const { HttpError } = require('../utils/http-error');
const { maskPhoneNumber, maskTransactionRow } = require('./security.service');
const { env } = require('../config/env');
const { sendTwilioArsCall } = require('./twilio-ars.service');
const { buildArsPrompt } = require('./ars.service');

const COMPLETED_ARS_TRANSACTION_STATUSES = new Set(['CALL_CONFIRMED', 'APPROVED']);
const BLOCKED_ARS_TRANSACTION_STATUSES = new Set(['BLOCKED', 'CARD_SUSPENDED']);
const RETRYABLE_CALL_STATUSES = new Set(['CALL_NO_RESPONSE', 'CALL_HOLD']);

function buildArsCallResponse({ transactionId, callVerification, message, skipped = false }) {
  const providerResponse = callVerification?.provider_response || {};
  return {
    transactionId,
    callVerificationId: callVerification?.id || null,
    callStatus: callVerification?.call_status || null,
    twilioCallSid: callVerification?.twilio_call_sid || null,
    providerStatus: callVerification?.last_provider_status || providerResponse.status || null,
    skipped,
    message
  };
}

function buildManualArsPrompt(current) {
  return buildArsPrompt(current, {
    risk_score: current.risk_score,
    reasons: current.reasons || []
  }, {
    displayName: current.customer_display_name || current.customer_name || null,
    phoneNumber: current.customer_phone_number || null
  });
}

async function createManualCallVerification(client, current) {
  const arsPrompt = buildManualArsPrompt(current);
  const result = await client.query(
    `INSERT INTO call_verifications
     (transaction_id, customer_ref, phone_number, masked_phone_number, call_status, memo, ars_prompt)
     VALUES ($1, $2, $3, $4, 'CALL_IN_PROGRESS', $5, $6)
     RETURNING *`,
    [
      current.id,
      current.customer_ref || null,
      current.customer_phone_number || null,
      maskPhoneNumber(current.customer_phone_number),
      arsPrompt,
      arsPrompt
    ]
  );

  return result.rows[0];
}

async function reserveManualCallVerification(client, current, latestCallVerification) {
  if (!latestCallVerification || RETRYABLE_CALL_STATUSES.has(latestCallVerification.call_status)) {
    return createManualCallVerification(client, current);
  }

  const result = await client.query(
    `UPDATE call_verifications
     SET call_status = 'CALL_IN_PROGRESS',
         last_error_code = NULL,
         last_error_message = NULL
     WHERE id = $1
     RETURNING *`,
    [latestCallVerification.id]
  );

  return result.rows[0];
}

async function buildFraudGuardHistory(client, subject, excludeTransactionId) {
  const subjectWhere = subject.customerRef
    ? 't.customer_ref = $1'
    : 't.user_id = $1';
  const subjectValue = subject.customerRef || subject.userId;

  const result = await client.query(
    `SELECT t.*
     FROM transactions t
     LEFT JOIN detection_results d ON d.transaction_id = t.id
     WHERE ${subjectWhere}
       AND t.id <> $2
       AND t.status = 'APPROVED'
       AND (d.risk_level IS NULL OR d.risk_level = 'NORMAL')
     ORDER BY t.occurred_at DESC
     LIMIT 50`,
    [subjectValue, excludeTransactionId]
  );

  return result.rows;
}

async function createDetectedTransaction(subject, payload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (subject.customerRef) {
      const hasAuthoritativeCustomerName = Boolean(subject.customerName);
      await client.query(
        `INSERT INTO customers (customer_ref, name, phone_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_ref) DO UPDATE SET
           name = CASE WHEN $4 THEN EXCLUDED.name ELSE customers.name END,
           phone_number = COALESCE(EXCLUDED.phone_number, customers.phone_number)`,
        [subject.customerRef, subject.customerName || 'Unknown Customer', payload.phoneNumber || null, hasAuthoritativeCustomerName]
      );
      await client.query(
        `INSERT INTO customer_cards (customer_ref, card_token, status)
         VALUES ($1, $2, 'ACTIVE')
         ON CONFLICT (card_token) DO NOTHING`,
        [subject.customerRef, `CARD-${subject.customerRef}`]
      );
    }

    const transactionResult = await client.query(
      `INSERT INTO transactions
       (user_id, customer_ref, customer_name, type, amount, occurred_at, country_code, city, merchant_category, latitude, longitude, ip_address, device_id, payment_method, recipient_account)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        subject.userId || null,
        subject.customerRef || null,
        subject.customerName || null,
        payload.type,
        payload.amount,
        payload.occurredAt,
        payload.countryCode || null,
        payload.city || null,
        payload.merchantCategory || null,
        payload.latitude || null,
        payload.longitude || null,
        payload.ipAddress || null,
        payload.deviceId || null,
        payload.paymentMethod || null,
        payload.recipientAccount || null
      ]
    );

    const transaction = transactionResult.rows[0];
    const fraudGuardHistory = await buildFraudGuardHistory(client, subject, transaction.id);
    const detection = await detectTransactionWithFraudGuard(transaction, fraudGuardHistory, subject);
    const responseDecision = decideInitialResponse(detection.riskLevel, detection.riskScore);

    const detectionResult = await client.query(
      `INSERT INTO detection_results
       (transaction_id, rule_score, personal_score, risk_score, risk_level, reasons, recommended_action, triggered_rules, score_breakdown, model_info, ars_policy, raw_risk_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        transaction.id,
        detection.ruleScore,
        detection.personalScore,
        detection.riskScore,
        detection.riskLevel,
        JSON.stringify(detection.reasons),
        detection.recommendedAction,
        JSON.stringify(detection.triggeredRules),
        JSON.stringify(detection.scoreBreakdown || {}),
        JSON.stringify(detection.modelInfo || {}),
        JSON.stringify(detection.arsPolicy || {}),
        detection.rawRiskLevel
      ]
    );

    const updatedTransactionResult = await client.query(
      `UPDATE transactions
       SET status = $1, decided_action = $2
       WHERE id = $3
       RETURNING *`,
      [responseDecision.status, responseDecision.action, transaction.id]
    );

    const actionLog = await addActionLog(client, {
      transactionId: transaction.id,
      actorUserId: null,
      action: responseDecision.action,
      previousStatus: null,
      newStatus: responseDecision.status,
      memo: responseDecision.label,
      reasonSnapshot: detection.reasons
    });
    const responseActions = buildAutomaticResponseActions(updatedTransactionResult.rows[0], detection, responseDecision);
    const savedResponseActions = await addResponseActions(client, transaction.id, responseActions);
    const callVerification = await createCallVerificationIfNeeded(client, updatedTransactionResult.rows[0], responseActions, detectionResult.rows[0]);
    await applyAutomaticSideEffects(client, updatedTransactionResult.rows[0], responseActions);

    await client.query('COMMIT');

    // COMMIT 이후 비동기 발신 — 트랜잭션과 분리
    if (callVerification && env.twilioEnabled) {
      setImmediate(async () => {
        try {
          await sendTwilioArsCall({
            env,
            callVerificationId: callVerification.id,
            to: callVerification.phone_number,
          });
        } catch (err) {
          console.error('[ARS] Twilio call failed:', err.message);
        }
      });
    }

    return {
      ...maskTransactionRow(updatedTransactionResult.rows[0]),
      detection: detectionResult.rows[0],
      actionLog,
      responseActions: savedResponseActions
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createTransaction(userId, payload) {
  return createDetectedTransaction({ userId }, payload);
}

async function createCustomerTransaction(payload) {
  return createDetectedTransaction({
    customerRef: payload.customerRef,
    customerName: payload.customerName
  }, payload);
}

async function listUserTransactions(userId) {
  const result = await pool.query(
    `SELECT t.*, d.rule_score, d.personal_score, d.risk_score, d.risk_level, d.reasons,
            d.recommended_action, d.triggered_rules, d.score_breakdown, d.model_info, d.ars_policy, d.raw_risk_level
     FROM transactions t
     JOIN detection_results d ON d.transaction_id = t.id
     WHERE t.user_id = $1
     ORDER BY t.occurred_at DESC`,
    [userId]
  );
  return result.rows.map(maskTransactionRow);
}

async function getTransactionDetail(id, user) {
  const values = user.role === 'ADMIN' ? [id] : [id, user.id];
  const where = user.role === 'ADMIN' ? 't.id = $1' : 't.id = $1 AND t.user_id = $2';

  const result = await pool.query(
    `SELECT t.*, u.email, u.username, d.rule_score, d.personal_score, d.risk_score, d.risk_level, d.reasons,
            d.recommended_action, d.triggered_rules, d.score_breakdown, d.model_info, d.ars_policy, d.raw_risk_level
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     JOIN detection_results d ON d.transaction_id = t.id
     WHERE ${where}`,
    values
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, 'Transaction not found.');
  }

  const transaction = result.rows[0];
  const actionLogs = await listActionLogs(id);
  const responseActions = await listResponseActions(id);
  const callVerifications = await listCallVerifications(id);

  return { ...maskTransactionRow(transaction), action_logs: actionLogs, response_actions: responseActions, call_verifications: callVerifications };
}

async function requestManualArsCall(transactionId, user) {
  const values = user.role === 'ADMIN' ? [transactionId] : [transactionId, user.id];
  const where = user.role === 'ADMIN' ? 't.id = $1' : 't.id = $1 AND t.user_id = $2';
  const client = await pool.connect();
  let reservedCallVerification;

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT t.*, d.risk_score, d.risk_level, d.reasons,
              c.name AS customer_display_name,
              c.phone_number AS customer_phone_number
       FROM transactions t
       JOIN detection_results d ON d.transaction_id = t.id
       LEFT JOIN customers c ON c.customer_ref = t.customer_ref
       WHERE ${where}
       FOR UPDATE OF t`,
      values
    );

    if (currentResult.rowCount === 0) {
      throw new HttpError(404, 'Transaction not found.');
    }

    const current = currentResult.rows[0];
    const latestCallResult = await client.query(
      `SELECT *
       FROM call_verifications
       WHERE transaction_id = $1
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [transactionId]
    );
    const latestCallVerification = latestCallResult.rows[0] || null;

    if (COMPLETED_ARS_TRANSACTION_STATUSES.has(current.status) || latestCallVerification?.call_status === 'CALL_CONFIRMED') {
      await client.query('COMMIT');
      return buildArsCallResponse({
        transactionId,
        callVerification: latestCallVerification,
        skipped: true,
        message: '이미 고객 확인/승인 완료된 거래입니다.'
      });
    }

    if (BLOCKED_ARS_TRANSACTION_STATUSES.has(current.status) || latestCallVerification?.call_status === 'CALL_DENIED') {
      await client.query('COMMIT');
      return buildArsCallResponse({
        transactionId,
        callVerification: latestCallVerification,
        skipped: true,
        message: '이미 차단/정지 처리된 거래입니다.'
      });
    }

    const canRetry = latestCallVerification && RETRYABLE_CALL_STATUSES.has(latestCallVerification.call_status);
    if (!canRetry && (current.status === 'CALL_IN_PROGRESS' || latestCallVerification?.call_status === 'CALL_IN_PROGRESS')) {
      await client.query('COMMIT');
      return buildArsCallResponse({
        transactionId,
        callVerification: latestCallVerification,
        skipped: true,
        message: '이미 ARS 진행 중입니다.'
      });
    }

    if (!canRetry && current.status !== 'CALL_REQUIRED') {
      throw new HttpError(409, 'ARS 발신 대상 상태가 아닙니다.');
    }

    if (!env.twilioEnabled) {
      throw new HttpError(503, 'Twilio ARS 발신이 비활성화되어 있습니다.');
    }

    reservedCallVerification = await reserveManualCallVerification(client, current, latestCallVerification);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const sentCallVerification = await sendTwilioArsCall({
    env,
    callVerificationId: reservedCallVerification.id,
    to: reservedCallVerification.phone_number
  });

  return buildArsCallResponse({
    transactionId,
    callVerification: sentCallVerification,
    message: 'ARS 발신 요청이 생성되었습니다.'
  });
}

module.exports = {
  createTransaction,
  createCustomerTransaction,
  listUserTransactions,
  getTransactionDetail,
  requestManualArsCall
};
