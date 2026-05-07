const assert = require('assert');
const { pool } = require('../db/pool');
const { listPolicyRules, togglePolicyRule, getEnabledPolicyCodes } = require('./policy.service');

async function run() {
  const rules = await listPolicyRules();
  assert.ok(rules.length >= 7);

  const adminUser = await pool.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1");
  const target = rules[0];
  const changed = await togglePolicyRule(target.id, adminUser.rows[0].id, 'policy test toggle');
  assert.strictEqual(changed.enabled, !target.enabled);

  const enabledCodes = await getEnabledPolicyCodes();
  assert.strictEqual(enabledCodes.includes(target.code), changed.enabled);

  await togglePolicyRule(target.id, adminUser.rows[0].id, 'policy test rollback');
  console.log('Policy rule test passed.');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
