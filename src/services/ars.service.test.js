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
    customer_name: '김민준',
    amount: 1500000,
    payment_method: 'CARD',
    type: 'PAYMENT',
    merchant_category: 'ONLINE'
  },
  {
    risk_score: 70,
    reasons: [{ code: 'HIGH_AMOUNT', score: 30 }, { code: 'NEW_DEVICE', score: 20 }]
  },
  {
    displayName: '김민준',
    phoneNumber: '010-1234-5678'
  }
);

assert.ok(prompt.includes('김민준'));
assert.ok(!prompt.includes('CUST-001'));
assert.ok(prompt.includes('1,500,000원의 이상 거래'));
assert.ok(prompt.includes('위험 점수는 70점'));
assert.ok(prompt.includes('본인 거래가 맞으면 일 번'));
assert.ok(prompt.includes('본인 거래가 아니면 이 번'));
assert.ok(!prompt.includes('카드'));
assert.ok(!prompt.includes('온라인 결제 거래'));
assert.ok(!prompt.includes('고액 거래'));
assert.ok(!prompt.includes('새 기기 접속'));
assert.ok(!prompt.includes('010-****-5678'));
assert.ok(!prompt.includes('010-1234-5678'));

console.log('ARS service test passed.');
