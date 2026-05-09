const { pool } = require('../db/pool');
const { createCustomerTransaction } = require('./transaction.service');
const { maskTransactionRow } = require('./security.service');

const scenarios = [
  { type: 'PAYMENT', amount: 45000, countryCode: 'KR', city: 'Seoul', ipAddress: '203.0.113.10', deviceId: 'device-main', paymentMethod: 'CARD' },
  { type: 'TRANSFER', amount: 1500000, countryCode: 'KR', city: 'Seoul', ipAddress: '203.0.113.11', deviceId: 'device-main', paymentMethod: 'ACCOUNT' },
  { type: 'PAYMENT', amount: 320000, countryCode: 'US', city: 'New York', ipAddress: '198.51.100.20', deviceId: 'device-travel', paymentMethod: 'CARD' },
  { type: 'WITHDRAWAL', amount: 850000, countryCode: 'CN', city: 'Shanghai', ipAddress: '198.51.100.30', deviceId: 'new-mobile', paymentMethod: 'ATM' },
  { type: 'TRANSFER', amount: 2100000, countryCode: 'RU', city: 'Moscow', ipAddress: '198.51.100.40', deviceId: 'unknown-browser', paymentMethod: 'ACCOUNT' }
];

async function createAdminTransaction(payload) {
  return createCustomerTransaction(payload);
}

// Development-only helper. The production console no longer calls this.
async function createFakeTransactions(count = 20) {
  const created = [];
  for (let i = 0; i < count; i += 1) {
    const base = scenarios[i % scenarios.length];
    const occurredAt = new Date(Date.now() - i * 17 * 60 * 1000);
    if (i % 7 === 0) occurredAt.setHours(2, 15, 0, 0);

    const transaction = await createCustomerTransaction({
      ...base,
      customerRef: `DEV-CUST-${String((i % 5) + 1).padStart(3, '0')}`,
      customerName: `Development Customer ${(i % 5) + 1}`,
      amount: Number(base.amount) + i * 1000,
      occurredAt: occurredAt.toISOString(),
      recipientAccount: `TEST-${100000 + i}`
    });
    created.push(transaction);
  }
  return created;
}

async function getStats() {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_transactions,
       COUNT(*) FILTER (WHERE d.risk_level != 'NORMAL')::int AS risky_transactions,
       COUNT(*) FILTER (WHERE d.risk_level = 'NORMAL')::int AS normal_count,
       COUNT(*) FILTER (WHERE d.risk_level = 'SUSPICIOUS')::int AS suspicious_count,
       COUNT(*) FILTER (WHERE d.risk_level = 'DANGER')::int AS danger_count,
       COUNT(*) FILTER (WHERE t.status = 'APPROVED')::int AS approved_count,
       COUNT(*) FILTER (WHERE t.status = 'PENDING_REVIEW')::int AS pending_review_count,
       COUNT(*) FILTER (WHERE t.status = 'REQUIRES_AUTH')::int AS requires_auth_count,
       COUNT(*) FILTER (WHERE t.status IN ('CALL_REQUIRED', 'CALL_IN_PROGRESS'))::int AS call_required_count,
       COUNT(*) FILTER (WHERE t.status = 'BLOCKED')::int AS blocked_count,
       COALESCE(AVG(d.risk_score), 0)::numeric(10,2) AS average_risk_score
     FROM transactions t
     JOIN detection_results d ON d.transaction_id = t.id`
  );
  return result.rows[0];
}

async function listSuspiciousTransactions() {
  const result = await pool.query(
    `SELECT t.id, t.amount, t.type, t.occurred_at, t.country_code, t.city,
            t.status, t.decided_action, t.customer_ref, t.customer_name,
            u.email, u.username, d.rule_score, d.personal_score, d.risk_score, d.risk_level, d.reasons,
            d.recommended_action, d.triggered_rules, d.score_breakdown, d.model_info, d.ars_policy, d.raw_risk_level
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     JOIN detection_results d ON d.transaction_id = t.id
     WHERE d.risk_level != 'NORMAL'
     ORDER BY d.risk_score DESC, t.occurred_at DESC`
  );
  return result.rows.map(maskTransactionRow);
}

async function listReportRows() {
  const result = await pool.query(
    `SELECT t.id, COALESCE(t.customer_ref, u.email) AS email,
            t.customer_ref, t.customer_name, t.type, t.amount, t.occurred_at, t.country_code,
            t.city, t.ip_address::text, t.device_id, t.payment_method,
            t.status, t.decided_action,
            d.rule_score, d.personal_score, d.risk_score, d.risk_level, d.reasons,
            d.recommended_action, d.triggered_rules, d.score_breakdown, d.model_info, d.ars_policy, d.raw_risk_level
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     JOIN detection_results d ON d.transaction_id = t.id
     ORDER BY t.occurred_at DESC`
  );
  return result.rows.map(maskTransactionRow);
}

module.exports = { createAdminTransaction, createFakeTransactions, getStats, listSuspiciousTransactions, listReportRows };
