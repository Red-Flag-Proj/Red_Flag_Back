const { pool } = require('../src/db/pool');

const CUSTOMER_COUNT = 60;
const TOTAL_ROWS = 200;
const DISTRIBUTION = {
  NORMAL: 140,
  SUSPICIOUS: 45,
  DANGER: 15
};

const normalCategories = ['GROCERY', 'CAFE', 'CONVENIENCE_STORE', 'BOOKSTORE', 'TRANSPORT'];
const suspiciousCategories = ['ONLINE_SHOPPING', 'TRANSFER', 'ELECTRONICS'];
const dangerCategories = ['LUXURY', 'TRANSFER', 'CRYPTO'];

function pad(value, size = 3) {
  return String(value).padStart(size, '0');
}

function customerRef(index) {
  return `DEMO-CUST-${pad(((index - 1) % CUSTOMER_COUNT) + 1)}`;
}

function customerName(index) {
  return `Demo Customer ${pad(((index - 1) % CUSTOMER_COUNT) + 1)}`;
}

function occurredAtFor(index) {
  const date = new Date(Date.UTC(2026, 4, 10, 0, 0, 0, 0));
  date.setUTCMinutes(date.getUTCMinutes() + index * 5);
  return date.toISOString();
}

function baseTransaction(index, riskLevel) {
  const ref = customerRef(index);
  const isNormal = riskLevel === 'NORMAL';
  const isDanger = riskLevel === 'DANGER';
  const categories = isNormal ? normalCategories : isDanger ? dangerCategories : suspiciousCategories;
  const type = isDanger
    ? (index % 2 === 0 ? 'TRANSFER' : 'PAYMENT')
    : riskLevel === 'SUSPICIOUS'
      ? (index % 3 === 0 ? 'TRANSFER' : 'PAYMENT')
      : 'PAYMENT';

  return {
    customerRef: ref,
    customerName: customerName(index),
    phoneNumber: `+82106400${pad(((index - 1) % CUSTOMER_COUNT) + 1)}`,
    type,
    amount: isDanger
      ? 1800000 + (index % 7) * 210000
      : riskLevel === 'SUSPICIOUS'
        ? 420000 + (index % 9) * 65000
        : 12000 + (index % 15) * 4200,
    occurredAt: occurredAtFor(index),
    countryCode: isDanger && index % 3 === 0 ? 'US' : 'KR',
    city: isDanger && index % 3 === 0 ? 'New York' : ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon'][index % 5],
    merchantCategory: categories[index % categories.length],
    ipAddress: isDanger && index % 3 === 0 ? `198.51.100.${(index % 200) + 1}` : `203.0.113.${(index % 200) + 1}`,
    deviceId: isDanger ? `demo-risk-device-${pad(index)}` : `demo-device-${pad(((index - 1) % CUSTOMER_COUNT) + 1)}`,
    paymentMethod: type === 'TRANSFER' ? 'ACCOUNT' : 'CARD',
    recipientAccount: `DEMO-RESET-${pad(index)}`
  };
}

function detectionFor(riskLevel, index) {
  if (riskLevel === 'NORMAL') {
    const riskScore = 8 + (index % 13);
    return {
      ruleScore: Math.max(0, riskScore - 5),
      personalScore: 5,
      riskScore,
      status: 'APPROVED',
      action: 'AUTO_APPROVE',
      recommendedAction: 'approve transaction',
      rawRiskLevel: 'low',
      reasons: [{ code: 'NORMAL_SPEND_PATTERN', label: 'Routine domestic low-value transaction', score: riskScore }]
    };
  }

  if (riskLevel === 'SUSPICIOUS') {
    const riskScore = index % 2 === 0 ? 38 : 52;
    return {
      ruleScore: riskScore - 12,
      personalScore: 12,
      riskScore,
      status: riskScore >= 46 ? 'CALL_REQUIRED' : 'REQUIRES_AUTH',
      action: riskScore >= 46 ? 'AUTO_CALL_REQUIRED' : 'AUTO_REQUIRE_AUTH',
      recommendedAction: riskScore >= 46 ? 'hold transaction and verify customer' : 'request additional authentication',
      rawRiskLevel: 'medium',
      reasons: [
        { code: 'AMOUNT_ABOVE_USUAL', label: 'Amount is higher than routine customer spend', score: riskScore - 18 },
        { code: 'STEP_UP_REQUIRED', label: 'Additional verification is recommended', score: 18 }
      ]
    };
  }

  const riskScore = index % 4 === 0 ? 85 : 72;
  return {
    ruleScore: riskScore - 18,
    personalScore: 18,
    riskScore,
    status: riskScore >= 81 ? 'CARD_SUSPENDED' : 'BLOCKED',
    action: riskScore >= 81 ? 'AUTO_CARD_SUSPEND' : 'AUTO_BLOCK',
    recommendedAction: 'block transaction and escalate review',
    rawRiskLevel: 'critical',
    reasons: [
      { code: 'HIGH_VALUE_RISK', label: 'High-value transaction outside normal pattern', score: 35 },
      { code: 'NEW_RISK_SIGNAL', label: 'New device or foreign location risk signal', score: riskScore - 35 }
    ]
  };
}

async function seedCustomer(client, transaction) {
  await client.query(
    `INSERT INTO customers (customer_ref, name, phone_number)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_ref) DO UPDATE SET
       name = EXCLUDED.name,
       phone_number = EXCLUDED.phone_number`,
    [transaction.customerRef, transaction.customerName, transaction.phoneNumber]
  );

  await client.query(
    `INSERT INTO customer_cards (customer_ref, card_token, status)
     VALUES ($1, $2, 'ACTIVE')
     ON CONFLICT (card_token) DO UPDATE SET
       status = 'ACTIVE',
       suspended_reason = NULL,
       suspended_at = NULL`,
    [transaction.customerRef, `CARD-${transaction.customerRef}`]
  );
}

async function insertTransaction(client, index, riskLevel) {
  const transaction = baseTransaction(index, riskLevel);
  const detection = detectionFor(riskLevel, index);

  await seedCustomer(client, transaction);

  const transactionResult = await client.query(
    `INSERT INTO transactions
     (customer_ref, customer_name, type, amount, occurred_at, country_code, city, merchant_category, ip_address, device_id, payment_method, recipient_account, status, decided_action)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      transaction.customerRef,
      transaction.customerName,
      transaction.type,
      transaction.amount,
      transaction.occurredAt,
      transaction.countryCode,
      transaction.city,
      transaction.merchantCategory,
      transaction.ipAddress,
      transaction.deviceId,
      transaction.paymentMethod,
      transaction.recipientAccount,
      detection.status,
      detection.action
    ]
  );

  const transactionId = transactionResult.rows[0].id;
  await client.query(
    `INSERT INTO detection_results
     (transaction_id, rule_score, personal_score, risk_score, risk_level, reasons, recommended_action, triggered_rules, score_breakdown, model_info, ars_policy, raw_risk_level)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12)`,
    [
      transactionId,
      detection.ruleScore,
      detection.personalScore,
      detection.riskScore,
      riskLevel,
      JSON.stringify(detection.reasons),
      detection.recommendedAction,
      JSON.stringify(detection.reasons),
      JSON.stringify({ ruleScore: detection.ruleScore, personalPatternScore: detection.personalScore }),
      JSON.stringify({ mode: 'api_demo_balanced_seed', modelServing: 'seeded_demo_dataset' }),
      JSON.stringify({ customerNameSource: 'customer_identity_service', doNotSpeakMaskedCustomerName: true }),
      detection.rawRiskLevel
    ]
  );

  await client.query(
    `INSERT INTO action_logs
     (transaction_id, actor_user_id, action, previous_status, new_status, memo, reason_snapshot)
     VALUES ($1, NULL, $2, NULL, $3, $4, $5::jsonb)`,
    [
      transactionId,
      detection.action,
      detection.status,
      detection.recommendedAction,
      JSON.stringify(detection.reasons)
    ]
  );

  await client.query(
    `INSERT INTO response_actions
     (transaction_id, action_type, target, status, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      transactionId,
      riskLevel === 'NORMAL' ? 'APPROVE_TRANSACTION' : riskLevel === 'SUSPICIOUS' ? 'REQUEST_STEP_UP_AUTH' : 'BLOCK_TRANSACTION',
      transaction.customerRef,
      riskLevel === 'NORMAL' ? 'COMPLETED' : 'PENDING',
      detection.recommendedAction
    ]
  );

  if (detection.status === 'CALL_REQUIRED') {
    await client.query(
      `INSERT INTO call_verifications
       (transaction_id, customer_ref, phone_number, masked_phone_number, call_status, memo, ars_prompt)
       VALUES ($1, $2, $3, $4, 'CALL_REQUIRED', $5, $5)`,
      [
        transactionId,
        transaction.customerRef,
        transaction.phoneNumber,
        `${transaction.phoneNumber.slice(0, 6)}****${transaction.phoneNumber.slice(-4)}`,
        'Customer phone verification is required for this transaction.'
      ]
    );
  }
}

async function resetApiDemoData() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM transactions WHERE customer_ref LIKE 'DEMO-CUST-%'");
    await client.query("DELETE FROM customer_cards WHERE customer_ref LIKE 'DEMO-CUST-%'");
    await client.query("DELETE FROM customers WHERE customer_ref LIKE 'DEMO-CUST-%'");

    let index = 1;
    for (let count = 0; count < DISTRIBUTION.NORMAL; count += 1, index += 1) {
      await insertTransaction(client, index, 'NORMAL');
    }
    for (let count = 0; count < DISTRIBUTION.SUSPICIOUS; count += 1, index += 1) {
      await insertTransaction(client, index, 'SUSPICIOUS');
    }
    for (let count = 0; count < DISTRIBUTION.DANGER; count += 1, index += 1) {
      await insertTransaction(client, index, 'DANGER');
    }

    await client.query('COMMIT');
    console.log(`Reset API demo dataset: ${TOTAL_ROWS} rows (${DISTRIBUTION.NORMAL} normal, ${DISTRIBUTION.SUSPICIOUS} suspicious, ${DISTRIBUTION.DANGER} danger).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

resetApiDemoData()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
