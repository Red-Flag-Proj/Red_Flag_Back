const assert = require('assert');
const { calculateRisk } = require('./detection.service');

const result = calculateRisk(
  {
    amount: 1500000,
    occurred_at: '2026-05-06T02:10:00.000Z',
    country_code: 'US',
    device_id: 'new-device',
    payment_method: 'CARD'
  },
  {
    averageAmount: 100000,
    recentTransactions: [
      { occurred_at: '2026-05-06T01:40:00.000Z' },
      { occurred_at: '2026-05-06T01:50:00.000Z' },
      { occurred_at: '2026-05-06T02:00:00.000Z' }
    ],
    knownDevices: ['old-device'],
    knownPaymentMethods: ['ACCOUNT'],
    failedLoginWithinOneHour: true
  }
);

assert.strictEqual(result.riskLevel, 'DANGER');
assert.ok(result.riskScore >= 61);
assert.ok(result.reasons.some((reason) => reason.code === 'HIGH_AMOUNT'));

console.log('Detection rule test passed.');
