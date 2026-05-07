const PDFDocument = require('pdfkit');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows) {
  const headers = [
    'transaction_id',
    'email',
    'type',
    'amount',
    'occurred_at',
    'country_code',
    'city',
    'ip_address',
    'device_id',
    'payment_method',
    'status',
    'decided_action',
    'risk_score',
    'risk_level',
    'reasons'
  ];

  const lines = rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','));
  return [headers.join(','), ...lines].join('\n');
}

function buildPdf(rows) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));

  doc.fontSize(18).text('Fraud Detection Report');
  doc.moveDown();
  doc.fontSize(10).text(`Generated at: ${new Date().toISOString()}`);
  doc.text(`Total transactions: ${rows.length}`);
  doc.moveDown();

  rows.slice(0, 40).forEach((row, index) => {
    const reasons = Array.isArray(row.reasons)
      ? row.reasons.map((item) => item.label).join('; ')
      : JSON.stringify(row.reasons);

    doc.fontSize(11).text(`${index + 1}. ${row.email} | ${row.type} | ${row.amount} KRW`);
    doc.fontSize(9).text(`Risk: ${row.risk_level} (${row.risk_score}) | ${row.occurred_at}`);
    doc.text(`Reason: ${reasons || '-'}`);
    doc.moveDown(0.7);
  });

  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

module.exports = { buildCsv, buildPdf };
