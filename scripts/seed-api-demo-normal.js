const { pool } = require('../src/db/pool');

const NORMAL_COUNT = 80;
const RECIPIENT_PREFIX = 'DEMO-NORMAL';

function pad(value) {
  return String(value).padStart(3, '0');
}

function occurredAtFor(index) {
  const date = new Date(Date.UTC(2026, 4, 9, 8, 0, 0, 0));
  date.setUTCMinutes(date.getUTCMinutes() + index * 3);
  return date.toISOString();
}

async function seedNormalApiDemoRows() {
  const existing = await pool.query(
    'SELECT COUNT(*)::int AS count FROM transactions WHERE recipient_account LIKE $1',
    [`${RECIPIENT_PREFIX}-%`]
  );

  if (existing.rows[0].count > 0) {
    console.log(`API demo normal baseline already exists: ${existing.rows[0].count} rows`);
    return;
  }

  await pool.query('BEGIN');
  try {
    for (let index = 1; index <= NORMAL_COUNT; index += 1) {
      const customerIndex = ((index - 1) % 40) + 1;
      const customerRef = `DEMO-CUST-${pad(customerIndex)}`;
      const customerName = `Demo Normal Customer ${pad(customerIndex)}`;
      const amount = 12000 + (index % 9) * 3500;
      const recipientAccount = `${RECIPIENT_PREFIX}-${pad(index)}`;

      await pool.query(
        `INSERT INTO customers (customer_ref, name, phone_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_ref) DO UPDATE SET
           name = COALESCE(customers.name, EXCLUDED.name),
           phone_number = COALESCE(customers.phone_number, EXCLUDED.phone_number)`,
        [customerRef, customerName, `+82106400${pad(customerIndex)}`]
      );

      await pool.query(
        `INSERT INTO customer_cards (customer_ref, card_token, status)
         VALUES ($1, $2, 'ACTIVE')
         ON CONFLICT (card_token) DO NOTHING`,
        [customerRef, `CARD-${customerRef}`]
      );

      const transactionResult = await pool.query(
        `INSERT INTO transactions
         (customer_ref, customer_name, type, amount, occurred_at, country_code, city, merchant_category, ip_address, device_id, payment_method, recipient_account, status, decided_action)
         VALUES ($1, $2, 'PAYMENT', $3, $4, 'KR', 'Seoul', 'GROCERY', $5::inet, $6, 'CARD', $7, 'APPROVED', 'AUTO_APPROVE')
         RETURNING id`,
        [
          customerRef,
          customerName,
          amount,
          occurredAtFor(index),
          `203.0.113.${(index % 200) + 1}`,
          `demo-normal-device-${pad(customerIndex)}`,
          recipientAccount
        ]
      );

      await pool.query(
        `INSERT INTO detection_results
         (transaction_id, rule_score, personal_score, risk_score, risk_level, reasons, recommended_action, triggered_rules, score_breakdown, model_info, ars_policy, raw_risk_level)
         VALUES ($1, 8, 6, 14, 'NORMAL', $2::jsonb, 'approve transaction', '[]'::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, 'low')`,
        [
          transactionResult.rows[0].id,
          JSON.stringify([{ code: 'API_DEMO_NORMAL_BASELINE', label: 'Routine domestic low-value card payment', score: 14 }]),
          JSON.stringify({ ruleScore: 8, personalPatternScore: 6, sequencePatternScore: 0, anomalyScore: 0 }),
          JSON.stringify({ mode: 'api_demo_seed', modelServing: 'seeded_normal_baseline' }),
          JSON.stringify({ customerNameSource: 'customer_identity_service', doNotSpeakMaskedCustomerName: true })
        ]
      );
    }

    await pool.query('COMMIT');
    console.log(`Seeded ${NORMAL_COUNT} API demo normal baseline rows.`);
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

seedNormalApiDemoRows()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
