const HIGH_AMOUNT = 1000000;
const NIGHT_START_HOUR = 0;
const NIGHT_END_HOUR = 5;

function getRiskLevel(score) {
  if (score >= 61) return 'DANGER';
  if (score >= 31) return 'SUSPICIOUS';
  return 'NORMAL';
}

function sameHour(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 60 * 60 * 1000;
}

function calculateRisk(transaction, context = {}) {
  const reasons = [];
  let score = 0;
  const amount = Number(transaction.amount);
  const averageAmount = Number(context.averageAmount || 0);
  const recentTransactions = context.recentTransactions || [];
  const knownDevices = context.knownDevices || [];
  const knownPaymentMethods = context.knownPaymentMethods || [];
  const failedLoginWithinOneHour = Boolean(context.failedLoginWithinOneHour);
  const enabledRuleCodes = context.enabledRuleCodes || null;
  const personalBaseline = context.personalBaseline || { score: 0, reasons: [] };
  const isEnabled = (code) => !enabledRuleCodes || enabledRuleCodes.includes(code);

  if (isEnabled('HIGH_AMOUNT') && (amount >= HIGH_AMOUNT || (averageAmount > 0 && amount >= averageAmount * 3))) {
    score += 30;
    reasons.push({ code: 'HIGH_AMOUNT', label: '고액 거래 또는 평균 대비 3배 이상 거래', score: 30 });
  }

  const repeatedCount = recentTransactions.filter((item) => sameHour(item.occurred_at, transaction.occurred_at)).length;
  if (isEnabled('FREQUENT_TRANSACTION') && repeatedCount >= 3) {
    score += 25;
    reasons.push({ code: 'FREQUENT_TRANSACTION', label: '짧은 시간 내 반복 거래', score: 25 });
  }

  if (isEnabled('FOREIGN_IP_OR_LOCATION') && transaction.country_code && transaction.country_code !== 'KR') {
    score += 30;
    reasons.push({ code: 'FOREIGN_IP_OR_LOCATION', label: '해외 IP 또는 해외 위치 거래', score: 30 });
  }

  const hour = new Date(transaction.occurred_at).getHours();
  if (isEnabled('NIGHT_TRANSACTION') && hour >= NIGHT_START_HOUR && hour <= NIGHT_END_HOUR) {
    score += 15;
    reasons.push({ code: 'NIGHT_TRANSACTION', label: '새벽 시간대 거래', score: 15 });
  }

  if (isEnabled('NEW_DEVICE') && transaction.device_id && !knownDevices.includes(transaction.device_id)) {
    score += 20;
    reasons.push({ code: 'NEW_DEVICE', label: '신규 기기 거래', score: 20 });
  }

  if (isEnabled('NEW_PAYMENT_METHOD') && transaction.payment_method && !knownPaymentMethods.includes(transaction.payment_method)) {
    score += 10;
    reasons.push({ code: 'NEW_PAYMENT_METHOD', label: '새로운 결제 방식 사용', score: 10 });
  }

  if (isEnabled('FAILED_LOGIN_BEFORE_TRANSACTION') && failedLoginWithinOneHour) {
    score += 20;
    reasons.push({ code: 'FAILED_LOGIN_BEFORE_TRANSACTION', label: '로그인 실패 후 거래 발생', score: 20 });
  }

  const ruleScore = score;
  const personalScore = Number(personalBaseline.score || 0);
  const totalScore = ruleScore + personalScore;

  return {
    riskScore: totalScore,
    ruleScore,
    personalScore,
    riskLevel: getRiskLevel(totalScore),
    reasons: [...reasons, ...(personalBaseline.reasons || [])],
    personalBaselineSummary: personalBaseline.summary || null
  };
}

module.exports = { calculateRisk, getRiskLevel };
