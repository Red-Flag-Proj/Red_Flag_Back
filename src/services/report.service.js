const PDFDocument = require('pdfkit');
const fs = require('fs');

const fontCandidates = [
  process.env.REPORT_PDF_FONT_PATH,
  'C:\\Windows\\Fonts\\malgun.ttf',
  'C:\\Windows\\Fonts\\malgunbd.ttf',
  'C:\\Windows\\Fonts\\gulim.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf'
].filter(Boolean);

function resolveReportFont() {
  return fontCandidates.find((fontPath) => fs.existsSync(fontPath));
}

function formatReportDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} KST`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function formatAmount(value) {
  const amount = Number(value);
  if (Number.isNaN(amount)) return `${value} KRW`;
  return `${amount.toLocaleString('ko-KR')} KRW`;
}

function riskStyle(level) {
  const styles = {
    NORMAL: { background: '#E8F6EF', foreground: '#147A46', label: '정상' },
    SUSPICIOUS: { background: '#FFF4D8', foreground: '#9A5B00', label: '의심' },
    DANGER: { background: '#FFE5E5', foreground: '#B42318', label: '위험' }
  };
  return styles[level] || { background: '#EEF2F6', foreground: '#344054', label: level || '-' };
}

function normalizeReasons(reasons) {
  if (!reasons) return '-';
  if (Array.isArray(reasons)) {
    return reasons.map((item) => item.label || item.code).filter(Boolean).join(' · ') || '-';
  }
  if (typeof reasons === 'string') {
    try {
      return normalizeReasons(JSON.parse(reasons));
    } catch (err) {
      return reasons;
    }
  }
  return JSON.stringify(reasons);
}

function summarizeRisks(rows) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    summary[row.risk_level] = (summary[row.risk_level] || 0) + 1;
    return summary;
  }, { total: 0, NORMAL: 0, SUSPICIOUS: 0, DANGER: 0 });
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
    'reasons',
    'recommended_action',
    'triggered_rules'
  ];

  const lines = rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','));
  return [headers.join(','), ...lines].join('\n');
}

function buildPdf(rows) {
  const doc = new PDFDocument({ margin: 36, size: 'A4' });
  const chunks = [];
  const reportFont = resolveReportFont();
  const contentX = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomY = doc.page.height - doc.page.margins.bottom;

  doc.on('data', (chunk) => chunks.push(chunk));

  if (reportFont) {
    doc.registerFont('ReportFont', reportFont);
    doc.font('ReportFont');
  }

  const summary = summarizeRisks(rows);

  doc.rect(0, 0, doc.page.width, 126).fill('#172033');
  doc.fillColor('#FFFFFF').fontSize(22).text('Fraud Detection Report', contentX, 34);
  doc.fillColor('#C8D2E0').fontSize(9).text(`Generated at ${formatReportDate(new Date())}`, contentX, 66);
  doc.fillColor('#DDE6F3').fontSize(10).text('Transaction risk analysis report', contentX, 88);

  const cardGap = 10;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  const cardY = 148;
  const cards = [
    { label: '전체 거래', value: summary.total, background: '#F3F6FA', foreground: '#172033' },
    { label: '정상', value: summary.NORMAL, background: riskStyle('NORMAL').background, foreground: riskStyle('NORMAL').foreground },
    { label: '의심', value: summary.SUSPICIOUS, background: riskStyle('SUSPICIOUS').background, foreground: riskStyle('SUSPICIOUS').foreground },
    { label: '위험', value: summary.DANGER, background: riskStyle('DANGER').background, foreground: riskStyle('DANGER').foreground }
  ];

  cards.forEach((card, index) => {
    const x = contentX + index * (cardWidth + cardGap);
    doc.roundedRect(x, cardY, cardWidth, 58, 8).fill(card.background);
    doc.fillColor('#667085').fontSize(8).text(card.label, x + 12, cardY + 12, { width: cardWidth - 24 });
    doc.fillColor(card.foreground).fontSize(20).text(String(card.value), x + 12, cardY + 27, { width: cardWidth - 24 });
  });

  doc.fillColor('#172033').fontSize(13).text('거래 목록', contentX, 232);
  doc.fillColor('#667085').fontSize(8).text('최대 40건까지 최신순으로 표시합니다.', contentX, 250);

  let y = 274;

  rows.slice(0, 40).forEach((row, index) => {
    const style = riskStyle(row.risk_level);
    const reasons = normalizeReasons(row.reasons);
    doc.fontSize(8);
    const reasonHeight = doc.heightOfString(reasons, { width: contentWidth - 28 });
    const rowHeight = Math.max(102, 86 + reasonHeight);

    if (y + rowHeight > bottomY) {
      doc.addPage();
      y = doc.page.margins.top;
      doc.fillColor('#172033').fontSize(13).text('거래 목록', contentX, y);
      y += 28;
    }

    doc.roundedRect(contentX, y, contentWidth, rowHeight, 8).fill('#F8FAFC');
    doc.roundedRect(contentX, y, 4, rowHeight, 2).fill(style.foreground);

    doc.fillColor('#172033').fontSize(11).text(`${index + 1}. ${row.email || row.customer_ref || '-'}`, contentX + 14, y + 13, {
      width: contentWidth - 150,
      ellipsis: true
    });
    doc.fillColor('#172033').fontSize(12).text(formatAmount(row.amount), contentX + contentWidth - 132, y + 12, {
      width: 118,
      align: 'right'
    });

    doc.fillColor('#667085').fontSize(8).text(`${row.type || '-'} · ${row.payment_method || '-'} · ${row.status || '-'}`, contentX + 14, y + 34, {
      width: contentWidth - 28
    });
    doc.text(`${formatReportDate(row.occurred_at)} · ${row.country_code || '-'} ${row.city || ''}`.trim(), contentX + 14, y + 48, {
      width: contentWidth - 28
    });

    const badgeText = `${style.label} ${row.risk_score ?? 0}`;
    doc.roundedRect(contentX + contentWidth - 86, y + 34, 72, 20, 10).fill(style.background);
    doc.fillColor(style.foreground).fontSize(8).text(badgeText, contentX + contentWidth - 82, y + 39, {
      width: 64,
      align: 'center'
    });

    doc.fillColor('#344054').fontSize(8).text('탐지 사유', contentX + 14, y + 68);
    doc.fillColor('#475467').fontSize(8).text(reasons, contentX + 14, y + 82, {
      width: contentWidth - 28,
      lineGap: 2
    });

    y += rowHeight + 10;
  });

  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

module.exports = { buildCsv, buildPdf };
