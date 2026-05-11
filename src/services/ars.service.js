const { pool } = require('../db/pool');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http-error');
const { addActionLog } = require('./action.service');
const { maskPhoneNumber, maskTransactionRow } = require('./security.service');

function normalizeArsResult(payload = {}) {
  const value = String(payload.digit || payload.result || '').trim().toUpperCase();
  if (value === '1' || value === 'CONFIRMED') return 'CONFIRMED';
  if (value === '2' || value === 'DENIED') return 'DENIED';
  if (value === 'NO_RESPONSE' || value === 'TIMEOUT' || value === 'FAILED') return 'NO_RESPONSE';
  throw new HttpError(400, 'Unsupported ARS response.');
}

function mapArsResult(result) {
  if (result === 'CONFIRMED') {
    return {
      status: 'APPROVED',
      action: 'ARS_CUSTOMER_CONFIRM',
      callStatus: 'CALL_CONFIRMED',
      memo: 'Customer pressed 1 and confirmed the transaction.'
    };
  }

  if (result === 'DENIED') {
    return {
      status: 'BLOCKED',
      action: 'ARS_CUSTOMER_DENY',
      callStatus: 'CALL_DENIED',
      memo: 'Customer pressed 2 and denied the transaction.'
    };
  }

  return {
    status: 'PENDING_REVIEW',
    action: 'ARS_NO_RESPONSE',
    callStatus: 'CALL_NO_RESPONSE',
    memo: 'ARS did not receive a positive customer confirmation. Transaction is held by fail-closed policy.'
  };
}

function verifyArsSecret(secret) {
  if (!env.arsWebhookSecret) {
    throw new HttpError(503, 'ARS webhook secret is not configured.');
  }
  if (secret !== env.arsWebhookSecret) {
    throw new HttpError(401, 'Invalid ARS webhook secret.');
  }
}

function formatReason(reason) {
  const score = Number(reason.score || 0);
  const reasonLabels = {
    HIGH_AMOUNT: '고액 거래',
    NEW_DEVICE: '새 기기 접속',
    UNUSUAL_LOCATION: '비정상 위치',
    UNUSUAL_TIME: '비정상 시간',
    RAPID_TRANSACTIONS: '짧은 시간 내 반복 거래',
    FOREIGN_COUNTRY: '해외 거래',
    HIGH_RISK_COUNTRY: '고위험 국가 거래',
    NEW_RECIPIENT: '신규 수취인',
    VELOCITY: '거래 빈도 이상',
    IP_MISMATCH: '접속 정보 불일치',
    DEVICE_MISMATCH: '기기 정보 불일치'
  };
  const label = reasonLabels[reason.code] || String(reason.code || '위험 패턴').replace(/_/g, ' ');
  return `${label}${score ? `, 위험 점수 ${score}점` : ''}`;
}

function formatTransactionType(value) {
  const typeLabels = {
    DEPOSIT: '입금',
    WITHDRAWAL: '출금',
    TRANSFER: '이체',
    PAYMENT: '결제'
  };
  return typeLabels[value] || value || '거래';
}

function formatPaymentMethod(value) {
  const methodLabels = {
    CARD: '카드',
    ACCOUNT: '계좌',
    TRANSFER: '계좌 이체',
    BANK_TRANSFER: '계좌 이체',
    'E-PAY': '간편결제',
    EPAY: '간편결제',
    CASH: '현금'
  };
  return methodLabels[value] || value || '확인되지 않은 방식';
}

function formatMerchantCategory(value) {
  const categoryLabels = {
    CAFE: '카페',
    HOTEL: '호텔',
    GROCERY: '마트',
    ONLINE: '온라인 결제',
    TRANSFER: '이체',
    RESTAURANT: '음식점',
    SHOPPING: '쇼핑',
    TRANSPORT: '교통',
    TRAVEL: '여행'
  };
  return categoryLabels[value] || value || null;
}

function buildArsPrompt(transaction, detection, arsIdentity = {}) {
  const displayName = arsIdentity.displayName || transaction.customer_name || '고객님';
  const phoneNumber = arsIdentity.phoneNumber || null;
  const maskedPhone = maskPhoneNumber(phoneNumber);
  const reasons = Array.isArray(detection.reasons) ? detection.reasons : [];
  const reasonText = reasons.length
    ? reasons.slice(0, 3).map(formatReason).join(', ')
    : '이상 거래 패턴';
  const transactionType = formatTransactionType(transaction.type);
  const paymentMethod = formatPaymentMethod(transaction.payment_method || transaction.type);
  const merchantCategory = formatMerchantCategory(transaction.merchant_category);
  const amount = Number(transaction.amount).toLocaleString('ko-KR');
  const transactionDescription = merchantCategory
    ? merchantCategory.includes(transactionType)
      ? `${merchantCategory} 거래`
      : `${merchantCategory} ${transactionType}`
    : `${transactionType} 거래`;

  return [
    'RedFlag ARS 서비스입니다. 안녕하세요.',
    `${displayName} 님의 계좌에서 ${amount}원의 이상 거래가 감지되었습니다.`,
    `위험 점수는 ${detection.risk_score}점입니다.`,
    '본인 거래가 맞으면 일 번을, 본인 거래가 아니면 이 번을 눌러 주세요.'
  ].join(' ');
}

async function applyArsDecision(callVerificationId, payload) {
  const result = normalizeArsResult(payload);
  const mapped = mapArsResult(result);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT cv.id, cv.transaction_id, cv.call_status, t.status, d.reasons
       FROM call_verifications cv
       JOIN transactions t ON t.id = cv.transaction_id
       JOIN detection_results d ON d.transaction_id = t.id
       WHERE cv.id = $1
       FOR UPDATE`,
      [callVerificationId]
    );

    if (currentResult.rowCount === 0) {
      throw new HttpError(404, 'Call verification not found.');
    }

    const current = currentResult.rows[0];
    if (current.call_status === 'CALL_CONFIRMED' || current.call_status === 'CALL_DENIED') {
      throw new HttpError(409, 'ARS response was already recorded.');
    }

    const callResult = await client.query(
      `UPDATE call_verifications
       SET call_status = $1,
           ars_result = $2,
           memo = $3,
           verified_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [mapped.callStatus, result, payload.memo || mapped.memo, callVerificationId]
    );

    const transactionResult = await client.query(
      `UPDATE transactions
       SET status = $1,
           decided_action = $2
       WHERE id = $3
       RETURNING *`,
      [mapped.status, mapped.action, current.transaction_id]
    );

    const actionLog = await addActionLog(client, {
      transactionId: current.transaction_id,
      actorUserId: null,
      action: mapped.action,
      previousStatus: current.status,
      newStatus: mapped.status,
      memo: payload.memo || mapped.memo,
      reasonSnapshot: current.reasons
    });

    await client.query('COMMIT');
    return {
      transaction: maskTransactionRow(transactionResult.rows[0]),
      callVerification: {
        ...callResult.rows[0],
        phone_number: callResult.rows[0].masked_phone_number || maskPhoneNumber(callResult.rows[0].phone_number)
      },
      actionLog
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordArsResponse(callVerificationId, payload, secret) {
  verifyArsSecret(secret);
  return applyArsDecision(callVerificationId, payload);
}

module.exports = {
  applyArsDecision,
  buildArsPrompt,
  mapArsResult,
  normalizeArsResult,
  recordArsResponse
};
