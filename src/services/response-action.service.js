const { pool } = require('../db/pool');
const { buildArsPrompt } = require('./ars.service');
const { maskCallVerificationRow, maskPhoneNumber } = require('./security.service');

function buildAutomaticResponseActions(transaction, detection, decision) {
  const actions = [];
  const riskLevel = detection.riskLevel;
  const type = transaction.type;
  const paymentMethod = transaction.payment_method;

  if (riskLevel === 'NORMAL') {
    actions.push({
      actionType: 'APPROVE_TRANSACTION',
      target: transaction.id,
      status: 'COMPLETED',
      description: 'Risk score is within the normal range. Transaction is automatically approved.'
    });
    return actions;
  }

  if (riskLevel === 'SUSPICIOUS') {
    if (detection.riskScore >= 46) {
      actions.push({
        actionType: 'HOLD_TRANSACTION',
        target: transaction.id,
        status: 'COMPLETED',
        description: 'Transaction is held until phone verification is completed.'
      });
      actions.push({
        actionType: 'CALL_CUSTOMER',
        target: transaction.customer_ref || transaction.user_id || transaction.id,
        status: 'PENDING',
        description: 'ARS must ask the customer to press 1 to confirm or 2 to deny before approval.'
      });
      actions.push({
        actionType: 'NOTIFY_CUSTOMER',
        target: transaction.customer_ref || transaction.user_id || transaction.id,
        status: 'COMPLETED',
        description: 'Customer notification is sent before phone verification.'
      });
      return actions;
    }

    actions.push({
      actionType: 'REQUEST_STEP_UP_AUTH',
      target: transaction.customer_ref || transaction.user_id || transaction.id,
      status: 'PENDING',
      description: 'Additional authentication is requested before completing the transaction.'
    });
    actions.push({
      actionType: 'NOTIFY_CUSTOMER',
      target: transaction.customer_ref || transaction.user_id || transaction.id,
      status: 'COMPLETED',
      description: 'Customer notification is sent for suspicious transaction verification.'
    });
    actions.push({
      actionType: 'QUEUE_MANUAL_REVIEW',
      target: transaction.id,
      status: 'PENDING',
      description: 'Transaction is queued for analyst review.'
    });
    return actions;
  }

  if (riskLevel === 'DANGER') {
    actions.push({
      actionType: decision.status === 'BLOCKED' ? 'BLOCK_TRANSACTION' : 'HOLD_TRANSACTION',
      target: transaction.id,
      status: 'COMPLETED',
      description: 'High-risk transaction is blocked or held immediately.'
    });

    if (type === 'PAYMENT' || paymentMethod === 'CARD') {
      actions.push({
        actionType: 'SUSPEND_CARD',
        target: transaction.customer_ref || transaction.user_id || transaction.device_id || transaction.id,
        status: 'PENDING',
        description: 'Card usage is temporarily suspended pending customer verification.'
      });
    }

    if (type === 'TRANSFER' || type === 'WITHDRAWAL') {
      actions.push({
        actionType: 'FREEZE_TRANSFER',
        target: transaction.recipient_account || transaction.id,
        status: 'COMPLETED',
        description: 'Funds movement is frozen to prevent loss.'
      });
    }

    actions.push({
      actionType: 'NOTIFY_CUSTOMER',
      target: transaction.customer_ref || transaction.user_id || transaction.id,
      status: 'COMPLETED',
      description: 'Urgent customer notification is sent for high-risk activity.'
    });
    actions.push({
      actionType: 'QUEUE_MANUAL_REVIEW',
      target: transaction.id,
      status: 'PENDING',
      description: 'High-risk case is escalated to fraud operations.'
    });
  }

  return actions;
}

async function addResponseActions(client, transactionId, actions) {
  const saved = [];
  for (const action of actions) {
    const result = await client.query(
      `INSERT INTO response_actions
       (transaction_id, action_type, target, status, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [transactionId, action.actionType, action.target || null, action.status, action.description]
    );
    saved.push(result.rows[0]);
  }
  return saved;
}

async function createCallVerificationIfNeeded(client, transaction, actions, detection) {
  const shouldCall = actions.some((action) => action.actionType === 'CALL_CUSTOMER');
  if (!shouldCall) return null;

  const customerResult = transaction.customer_ref
    ? await client.query('SELECT name AS display_name, phone_number FROM customers WHERE customer_ref = $1', [transaction.customer_ref])
    : { rows: [] };

  const phoneNumber = customerResult.rows[0]?.phone_number || null;
  const arsPrompt = buildArsPrompt(transaction, detection, {
    displayName: customerResult.rows[0]?.display_name || null,
    phoneNumber
  });
  const result = await client.query(
    `INSERT INTO call_verifications
     (transaction_id, customer_ref, phone_number, masked_phone_number, call_status, memo, ars_prompt)
     VALUES ($1, $2, $3, $4, 'CALL_REQUIRED', $5, $6)
     RETURNING *`,
    [
      transaction.id,
      transaction.customer_ref || null,
      phoneNumber,
      maskPhoneNumber(phoneNumber),
      arsPrompt,
      arsPrompt
    ]
  );

  return result.rows[0];
}

async function applyAutomaticSideEffects(client, transaction, actions) {
  const shouldSuspendCard = actions.some((action) => action.actionType === 'SUSPEND_CARD');
  if (shouldSuspendCard && transaction.customer_ref) {
    await client.query(
      `UPDATE customer_cards
       SET status = 'SUSPENDED',
           suspended_reason = $1,
           suspended_at = NOW()
       WHERE customer_ref = $2 AND status = 'ACTIVE'`,
      ['High-risk FDS transaction response', transaction.customer_ref]
    );
  }
}

async function listCallVerifications(transactionId) {
  const result = await pool.query(
    `SELECT *
     FROM call_verifications
     WHERE transaction_id = $1
     ORDER BY created_at DESC`,
    [transactionId]
  );
  return result.rows.map(maskCallVerificationRow);
}

async function listResponseActions(transactionId) {
  const result = await pool.query(
    `SELECT *
     FROM response_actions
     WHERE transaction_id = $1
     ORDER BY created_at DESC`,
    [transactionId]
  );
  return result.rows;
}

module.exports = {
  buildAutomaticResponseActions,
  addResponseActions,
  applyAutomaticSideEffects,
  createCallVerificationIfNeeded,
  listCallVerifications,
  listResponseActions
};
