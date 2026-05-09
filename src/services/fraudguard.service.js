const path = require('path');
const { spawn } = require('node:child_process');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http-error');

function normalizeRiskLevel(value, riskScore = 0) {
  const text = String(value || '').trim().toUpperCase();
  if (['CRITICAL', 'HIGH', 'DANGER'].includes(text)) return 'DANGER';
  if (['MEDIUM', 'SUSPICIOUS', 'WARNING'].includes(text)) return 'SUSPICIOUS';
  if (['LOW', 'NORMAL', 'SAFE'].includes(text)) return 'NORMAL';

  const score = Number(riskScore || 0);
  if (score >= 61) return 'DANGER';
  if (score >= 31) return 'SUSPICIOUS';
  return 'NORMAL';
}

function normalizeReasons(value) {
  if (!Array.isArray(value)) return [];
  return value.map((reason, index) => {
    if (reason && typeof reason === 'object') return reason;
    return {
      code: `FRAUDGUARD_REASON_${index + 1}`,
      label: String(reason)
    };
  });
}

function mapHistoryRow(row) {
  return {
    transactionId: row.id,
    customerRef: row.customer_ref,
    amount: Number(row.amount),
    occurredAt: row.occurred_at,
    countryCode: row.country_code,
    city: row.city,
    merchantCategory: row.merchant_category,
    deviceId: row.device_id,
    paymentMethod: row.payment_method
  };
}

function mapTransactionRow(row, subject = {}) {
  return {
    transactionId: row.id,
    customerRef: row.customer_ref || subject.customerRef || subject.userId || row.user_id,
    amount: Number(row.amount),
    occurredAt: row.occurred_at,
    countryCode: row.country_code,
    city: row.city,
    merchantId: row.recipient_account || null,
    merchantCategory: row.merchant_category,
    deviceId: row.device_id,
    paymentMethod: row.payment_method || row.type
  };
}

function buildFraudGuardRequest(transaction, historyRows, subject = {}) {
  const customerHistory = historyRows.map(mapHistoryRow);
  return {
    transaction: mapTransactionRow(transaction, subject),
    customerHistory,
    sequenceHistory: customerHistory
  };
}

function callFraudGuard(request) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join('AI Engine', 'detect_transaction.py');
    const child = spawn(env.fraudGuardPython, [scriptPath], {
      cwd: env.fraudGuardRoot,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new HttpError(504, 'FraudGuard detection timed out.'));
    }, env.fraudGuardTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new HttpError(502, `FraudGuard process failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      let response;
      try {
        response = JSON.parse(stdout);
      } catch (err) {
        reject(new HttpError(502, `FraudGuard returned invalid JSON: ${stderr || stdout}`));
        return;
      }

      if (code !== 0 || response.ok === false) {
        const message = Array.isArray(response.errors) ? response.errors.join('; ') : stderr || 'FraudGuard detection failed.';
        reject(new HttpError(502, message));
        return;
      }

      resolve(response);
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

async function detectTransactionWithFraudGuard(transaction, historyRows, subject = {}) {
  const request = buildFraudGuardRequest(transaction, historyRows, subject);
  const response = await callFraudGuard(request);
  const riskScore = Number(response.riskScore ?? response.finalRiskScore ?? 0);

  return {
    riskScore,
    riskLevel: normalizeRiskLevel(response.riskLevel, riskScore),
    reasons: normalizeReasons(response.detectionReasons),
    ruleScore: Number(response.scoreBreakdown?.ruleScore || 0),
    personalScore: Number(response.scoreBreakdown?.personalPatternScore || 0),
    recommendedAction: response.recommendedAction || null,
    triggeredRules: normalizeReasons(response.triggeredRules),
    scoreBreakdown: response.scoreBreakdown || null,
    modelInfo: response.modelInfo || null,
    arsPolicy: response.arsPolicy || null,
    rawRiskLevel: response.riskLevel || null,
    fraudGuardResponse: response
  };
}

module.exports = {
  buildFraudGuardRequest,
  detectTransactionWithFraudGuard,
  normalizeRiskLevel
};
