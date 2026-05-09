const { pool } = require('../db/pool');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http-error');
const { addActionLog } = require('./action.service');
const { maskPhoneNumber, maskTransactionRow } = require('./security.service');

function normalizeArsResult(payload = {}) {
  const value = String(payload.digit || payload.result || '').trim().toUpperCase();
  if (value === '1' || value === 'CONFIRMED') return 'CONFIRMED';
  if (value === '2' || value === 'DENIED') return 'DENIED';
  if (value === 'NO_RESPONSE' || value === 'TIMEOUT' || value === 'FAILED') return 'NO_RESPONSE';
  throw new HttpError(400, 'Unsupported ARS response.');
}

function mapArsResult(result) {
  if (result === 'CONFIRMED') {
    return {
      status: 'APPROVED',
      action: 'ARS_CUSTOMER_CONFIRM',
      callStatus: 'CALL_CONFIRMED',
      memo: 'Customer pressed 1 and confirmed the transaction.'
    };
  }

  if (result === 'DENIED') {
    return {
      status: 'BLOCKED',
      action: 'ARS_CUSTOMER_DENY',
      callStatus: 'CALL_DENIED',
      memo: 'Customer pressed 2 and denied the transaction.'
    };
  }

  return {
    status: 'PENDING_REVIEW',
    action: 'ARS_NO_RESPONSE',
    callStatus: 'CALL_NO_RESPONSE',
    memo: 'ARS did not receive a positive customer confirmation. Transaction is held by fail-closed policy.'
  };
}

function verifyArsSecret(secret) {
  if (!env.arsWebhookSecret) {
    throw new HttpError(503, 'ARS webhook secret is not configured.');
  }
  if (secret !== env.arsWebhookSecret) {
    throw new HttpError(401, 'Invalid ARS webhook secret.');
  }
}

function formatReason(reason) {
  const score = Number(reason.score || 0);
  return `${reason.code}${score ? ` +${score}` : ''}`;
}

function buildArsPrompt(transaction, detection, arsIdentity = {}) {
  const displayName = arsIdentity.displayName || 'customer';
  const phoneNumber = arsIdentity.phoneNumber || null;
  const maskedPhone = maskPhoneNumber(phoneNumber);
  const reasons = Array.isArray(detection.reasons) ? detection.reasons : [];
  const reasonText = reasons.length
    ? reasons.slice(0, 3).map(formatReason).join(', ')
    : 'risk pattern detected';

  return [
    `FDS anomaly alert for ${displayName}.`,
    `Risk score ${detection.risk_score}, reason: ${reasonText}.`,
    `Amount KRW ${Number(transaction.amount).toLocaleString('ko-KR')}, method ${transaction.payment_method || transaction.type}.`,
    `Phone ${maskedPhone}. If this transaction is yours, press 1. If not, press 2.`
  ].join(' ');
}

async function applyArsDecision(callVerificationId, payload) {
  const result = normalizeArsResult(payload);
  const mapped = mapArsResult(result);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT cv.id, cv.transaction_id, cv.call_status, t.status, d.reasons
       FROM call_verifications cv
       JOIN transactions t ON t.id = cv.transaction_id
       JOIN detection_results d ON d.transaction_id = t.id
       WHERE cv.id = $1
       FOR UPDATE`,
      [callVerificationId]
    );

    if (currentResult.rowCount === 0) {
      throw new HttpError(404, 'Call verification not found.');
    }

    const current = currentResult.rows[0];
    if (current.call_status === 'CALL_CONFIRMED' || current.call_status === 'CALL_DENIED') {
      throw new HttpError(409, 'ARS response was already recorded.');
    }

    const callResult = await client.query(
      `UPDATE call_verifications
       SET call_status = $1,
           ars_result = $2,
           memo = $3,
           verified_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [mapped.callStatus, result, payload.memo || mapped.memo, callVerificationId]
    );

    const transactionResult = await client.query(
      `UPDATE transactions
       SET status = $1,
           decided_action = $2
       WHERE id = $3
       RETURNING *`,
      [mapped.status, mapped.action, current.transaction_id]
    );

    const actionLog = await addActionLog(client, {
      transactionId: current.transaction_id,
      actorUserId: null,
      action: mapped.action,
      previousStatus: current.status,
      newStatus: mapped.status,
      memo: payload.memo || mapped.memo,
      reasonSnapshot: current.reasons
    });

    await client.query('COMMIT');
    return {
      transaction: maskTransactionRow(transactionResult.rows[0]),
      callVerification: {
        ...callResult.rows[0],
        phone_number: callResult.rows[0].masked_phone_number || maskPhoneNumber(callResult.rows[0].phone_number)
      },
      actionLog
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordArsResponse(callVerificationId, payload, secret) {
  verifyArsSecret(secret);
  return applyArsDecision(callVerificationId, payload);
}

module.exports = {
  applyArsDecision,
  buildArsPrompt,
  mapArsResult,
  normalizeArsResult,
  recordArsResponse
};
