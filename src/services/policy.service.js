const { pool } = require('../db/pool');
const { HttpError } = require('../utils/http-error');

function mapRule(row) {
  return {
    id: row.id,
    code: row.code,
    category: row.category,
    condition: row.condition,
    score: row.score,
    maxCategoryScore: row.max_category_score,
    enabled: row.enabled,
    deploymentStatus: row.deployment_status,
    lastModifiedBy: row.last_modified_by_email || row.last_modified_by_username || 'system',
    lastModifiedAt: row.last_modified_at
  };
}

async function listPolicyRules() {
  const result = await pool.query(
    `SELECT r.*, u.email AS last_modified_by_email, u.username AS last_modified_by_username
     FROM policy_rules r
     LEFT JOIN users u ON u.id = r.last_modified_by
     ORDER BY r.id ASC`
  );
  return result.rows.map(mapRule);
}

async function getEnabledPolicyCodes(client = pool) {
  const result = await client.query(
    `SELECT code FROM policy_rules
     WHERE enabled = true AND deployment_status = 'DEPLOYED'`
  );
  return result.rows.map((row) => row.code);
}

async function togglePolicyRule(ruleId, actorUserId, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      'SELECT * FROM policy_rules WHERE id = $1 FOR UPDATE',
      [ruleId]
    );

    if (currentResult.rowCount === 0) {
      throw new HttpError(404, 'Policy rule not found.');
    }

    const current = currentResult.rows[0];
    const nextEnabled = !current.enabled;
    const action = nextEnabled ? 'ENABLE' : 'DISABLE';

    const updateResult = await client.query(
      `UPDATE policy_rules
       SET enabled = $1, last_modified_by = $2, last_modified_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [nextEnabled, actorUserId, ruleId]
    );

    await client.query(
      `INSERT INTO policy_rule_logs
       (rule_id, actor_user_id, action, previous_enabled, new_enabled, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ruleId, actorUserId, action, current.enabled, nextEnabled, reason || null]
    );

    await client.query('COMMIT');
    return mapRule(updateResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listPolicyRuleLogs() {
  const result = await pool.query(
    `SELECT l.*, u.email AS actor_email, u.username AS actor_username
     FROM policy_rule_logs l
     LEFT JOIN users u ON u.id = l.actor_user_id
     ORDER BY l.created_at DESC`
  );
  return result.rows;
}

module.exports = { listPolicyRules, getEnabledPolicyCodes, togglePolicyRule, listPolicyRuleLogs };
