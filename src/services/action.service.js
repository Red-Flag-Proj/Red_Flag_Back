const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http-error');
const { mapAdminAction } = require('./response-policy.service');
const { validateAdminActionMemo } = require('./memo-validation.service');

async function addActionLog(client, { transactionId, actorUserId, action, previousStatus, newStatus, memo, reasonSnapshot }) {
  const result = await client.query(
    `INSERT INTO action_logs
     (transaction_id, actor_user_id, action, previous_status, new_status, memo, reason_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      transactionId,
      actorUserId || null,
      action,
      previousStatus || null,
      newStatus,
      memo || null,
      JSON.stringify(reasonSnapshot || [])
    ]
  );

  return result.rows[0];
}

async function listActionLogs(transactionId) {
  const result = await pool.query(
    `SELECT l.*, u.email AS actor_email, u.username AS actor_username
     FROM action_logs l
     LEFT JOIN users u ON u.id = l.actor_user_id
     WHERE l.transaction_id = $1
     ORDER BY l.created_at DESC`,
    [transactionId]
  );

  return result.rows;
}

async function applyAdminAction(transactionId, actorUserId, payload) {
  validateAdminActionMemo(payload.action, payload.memo);

  const mapped = mapAdminAction(payload.action);
  if (!mapped) {
    throw new HttpError(400, 'Unsupported action.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT t.id, t.status, d.reasons
       FROM transactions t
       JOIN detection_results d ON d.transaction_id = t.id
       WHERE t.id = $1
       FOR UPDATE`,
      [transactionId]
    );

    if (currentResult.rowCount === 0) {
      throw new HttpError(404, 'Transaction not found.');
    }

    const current = currentResult.rows[0];
    const updateResult = await client.query(
      `UPDATE transactions
       SET status = $1, decided_action = $2
       WHERE id = $3
       RETURNING *`,
      [mapped.status, mapped.action, transactionId]
    );

    const log = await addActionLog(client, {
      transactionId,
      actorUserId,
      action: mapped.action,
      previousStatus: current.status,
      newStatus: mapped.status,
      memo: payload.memo,
      reasonSnapshot: current.reasons
    });

    if (payload.action === 'CALL_APPROVE' || payload.action === 'CALL_HOLD') {
      await client.query(
        `UPDATE call_verifications
         SET call_status = $1,
             memo = $2,
             verified_by = $3,
             verified_at = NOW()
         WHERE transaction_id = $4`,
        [
          payload.action === 'CALL_APPROVE' ? 'CALL_CONFIRMED' : 'CALL_HOLD',
          payload.memo || null,
          actorUserId,
          transactionId
        ]
      );
    }

    await client.query('COMMIT');
    return { transaction: updateResult.rows[0], actionLog: log };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { addActionLog, listActionLogs, applyAdminAction };
