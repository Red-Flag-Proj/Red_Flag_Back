async function buildPersonalBaseline(client, transaction) {
  if (!transaction.customer_ref) {
    return { score: 0, reasons: [], summary: null };
  }

  const history = await client.query(
    `SELECT amount, country_code, device_id, payment_method, merchant_category,
            EXTRACT(HOUR FROM occurred_at)::int AS hour
     FROM transactions
     WHERE customer_ref = $1
       AND id <> $2
       AND occurred_at >= $3::timestamptz - INTERVAL '3 years'`,
    [transaction.customer_ref, transaction.id, transaction.occurred_at]
  );

  if (history.rowCount < 30) {
    return {
      score: 0,
      reasons: [],
      summary: { historyCount: history.rowCount, message: 'Not enough customer history for personal baseline.' }
    };
  }

  const rows = history.rows;
  const amounts = rows.map((row) => Number(row.amount));
  const avgAmount = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
  const variance = amounts.reduce((sum, value) => sum + Math.pow(value - avgAmount, 2), 0) / amounts.length;
  const stdAmount = Math.sqrt(variance);
  const reasons = [];
  let score = 0;

  const amount = Number(transaction.amount);
  const zScore = stdAmount > 0 ? (amount - avgAmount) / stdAmount : 0;
  if (amount > avgAmount * 3 || zScore >= 3) {
    score += 35;
    reasons.push({
      code: 'PERSONAL_AMOUNT_OUTLIER',
      label: 'Customer amount is far above their 3-year personal baseline.',
      score: 35
    });
  }

  const knownCountries = new Set(rows.map((row) => row.country_code).filter(Boolean));
  if (transaction.country_code && !knownCountries.has(transaction.country_code)) {
    score += 20;
    reasons.push({
      code: 'PERSONAL_NEW_COUNTRY',
      label: 'Transaction country is not part of this customer baseline.',
      score: 20
    });
  }

  const knownDevices = new Set(rows.map((row) => row.device_id).filter(Boolean));
  if (transaction.device_id && !knownDevices.has(transaction.device_id)) {
    score += 20;
    reasons.push({
      code: 'PERSONAL_NEW_DEVICE',
      label: 'Device has not appeared in this customer history.',
      score: 20
    });
  }

  const knownMethods = new Set(rows.map((row) => row.payment_method).filter(Boolean));
  if (transaction.payment_method && !knownMethods.has(transaction.payment_method)) {
    score += 15;
    reasons.push({
      code: 'PERSONAL_NEW_PAYMENT_METHOD',
      label: 'Payment method is new for this customer.',
      score: 15
    });
  }

  const hour = new Date(transaction.occurred_at).getUTCHours();
  const hourCount = rows.filter((row) => Number(row.hour) === hour).length;
  if (hourCount / rows.length < 0.01) {
    score += 15;
    reasons.push({
      code: 'PERSONAL_UNUSUAL_HOUR',
      label: 'Transaction time is unusual for this customer.',
      score: 15
    });
  }

  return {
    score,
    reasons,
    summary: {
      historyCount: rows.length,
      averageAmount: Math.round(avgAmount),
      stdAmount: Math.round(stdAmount),
      zScore: Number(zScore.toFixed(2)),
      knownCountries: [...knownCountries],
      knownDeviceCount: knownDevices.size,
      knownPaymentMethods: [...knownMethods]
    }
  };
}

module.exports = { buildPersonalBaseline };
