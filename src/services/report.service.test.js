const assert = require('assert');
const { buildPdf } = require('./report.service');

async function run() {
  const pdf = await buildPdf([
    {
      email: 'user@example.com',
      type: '송금',
      amount: 120000,
      occurred_at: '2026-05-11T03:20:00.000Z',
      country_code: 'KR',
      city: '서울',
      payment_method: '카드',
      status: '차단',
      risk_score: 91,
      risk_level: 'DANGER',
      reasons: [{ label: '고액 거래' }, { label: '새 기기 사용' }]
    }
  ]);

  assert.ok(Buffer.isBuffer(pdf));
  assert.strictEqual(pdf.slice(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 1000);

  console.log('Report PDF test passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
