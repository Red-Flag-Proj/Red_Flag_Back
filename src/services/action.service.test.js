const assert = require('assert');
const { pool } = require('../db/pool');
const { createAdminTransaction } = require('./admin.service');
const { applyAdminAction, listActionLogs } = require('./action.service');

async function run() {
  const adminUser = await pool.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1");
  const transaction = await createAdminTransaction({
    customerRef: 'TEST-ACTION-CUSTOMER',
    customerName: 'Action Test Customer',
    type: 'TRANSFER',
    amount: 1500000,
    occurredAt: new Date().toISOString(),
    countryCode: 'US',
    city: 'New York',
    ipAddress: '198.51.100.77',
    deviceId: 'action-test-device',
    paymentMethod: 'ACCOUNT',
    recipientAccount: 'ACTION-TEST'
  });

  assert.ok(['APPROVED', 'REQUIRES_AUTH', 'CALL_REQUIRED', 'BLOCKED', 'CARD_SUSPENDED'].includes(transaction.status));

  const changed = await applyAdminAction(transaction.id, adminUser.rows[0].id, {
    action: 'HOLD',
    memo: 'manual review test'
  });
  const logs = await listActionLogs(transaction.id);

  assert.strictEqual(changed.transaction.status, 'PENDING_REVIEW');
  assert.ok(logs.length >= 2);

  console.log('Action workflow test passed.');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
