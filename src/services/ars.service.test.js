const assert = require('assert');
const { buildArsPrompt, mapArsResult, normalizeArsResult } = require('./ars.service');

assert.strictEqual(normalizeArsResult({ digit: '1' }), 'CONFIRMED');
assert.strictEqual(normalizeArsResult({ digit: '2' }), 'DENIED');
assert.strictEqual(normalizeArsResult({ result: 'TIMEOUT' }), 'NO_RESPONSE');

assert.deepStrictEqual(mapArsResult('CONFIRMED'), {
  status: 'APPROVED',
  action: 'ARS_CUSTOMER_CONFIRM',
  callStatus: 'CALL_CONFIRMED',
  memo: 'Customer pressed 1 and confirmed the transaction.'
});
assert.strictEqual(mapArsResult('DENIED').status, 'BLOCKED');
assert.strictEqual(mapArsResult('NO_RESPONSE').status, 'PENDING_REVIEW');

const prompt = buildArsPrompt(
  {
    customer_ref: 'CUST-001',
    amount: 1500000,
    payment_method: 'CARD',
    type: 'PAYMENT'
  },
  {
    risk_score: 70,
    reasons: [{ code: 'HIGH_AMOUNT', score: 30 }, { code: 'NEW_DEVICE', score: 20 }]
  },
  {
    displayName: 'Kim Minjun',
    phoneNumber: '010-1234-5678'
  }
);

assert.ok(prompt.includes('Kim Minjun'));
assert.ok(!prompt.includes('CUST-001'));
assert.ok(prompt.includes('press 1'));
assert.ok(prompt.includes('press 2'));
assert.ok(prompt.includes('010-****-5678'));
assert.ok(!prompt.includes('010-1234-5678'));

console.log('ARS service test passed.');
