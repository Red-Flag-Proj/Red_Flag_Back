// 실행 방법: node scripts/stream-transactions.js
// 기본: 1~10건씩 랜덤 전송 후 1000~5000ms 랜덤 대기
// 옵션:
//   node scripts/stream-transactions.js --interval 3000
//   node scripts/stream-transactions.js --min-interval 1000 --max-interval 5000 --min-batch 1 --max-batch 10

const fs = require('fs/promises');
const path = require('path');

const API_BASE_URL = process.env.FDS_API_BASE_URL || 'http://localhost:4000';
const DEFAULT_MIN_INTERVAL = 1000;
const DEFAULT_MAX_INTERVAL = 5000;
const DEFAULT_MIN_BATCH = 1;
const DEFAULT_MAX_BATCH = 10;
const LOGIN_PAYLOAD = {
  emailOrUsername: 'admin@fds.local',
  password: 'Admin1234!'
};

const STATUS_META = {
  APPROVED: { icon: '✅', label: '정상 승인' },
  REQUIRES_AUTH: { icon: '⚠️', label: '추가 인증 필요' },
  CALL_REQUIRED: { icon: '📞', label: 'ARS 발신!' },
  CALL_IN_PROGRESS: { icon: '📞', label: 'ARS 발신!' },
  BLOCKED: { icon: '🚫', label: '차단' },
  CARD_SUSPENDED: { icon: '❌', label: '카드 정지' }
};

function readNumberOption(argv, name, defaultValue) {
  const optionIndex = argv.indexOf(name);
  if (optionIndex === -1) return defaultValue;

  const value = Number(argv[optionIndex + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} 옵션은 숫자여야 합니다.`);
  }

  return value;
}

function parseOptions(argv) {
  const fixedInterval = readNumberOption(argv, '--interval', null);
  const minInterval = readNumberOption(argv, '--min-interval', DEFAULT_MIN_INTERVAL);
  const maxInterval = readNumberOption(argv, '--max-interval', DEFAULT_MAX_INTERVAL);
  const minBatch = readNumberOption(argv, '--min-batch', DEFAULT_MIN_BATCH);
  const maxBatch = readNumberOption(argv, '--max-batch', DEFAULT_MAX_BATCH);

  if (fixedInterval !== null && fixedInterval < 0) {
    throw new Error('--interval 옵션은 0 이상의 숫자(ms)여야 합니다.');
  }

  if (minInterval < 0 || maxInterval < 0 || minInterval > maxInterval) {
    throw new Error('--min-interval과 --max-interval은 0 이상이며 min이 max보다 작거나 같아야 합니다.');
  }

  if (minBatch < 1 || maxBatch < 1 || minBatch > maxBatch) {
    throw new Error('--min-batch와 --max-batch는 1 이상이며 min이 max보다 작거나 같아야 합니다.');
  }

  return {
    fixedInterval,
    minInterval: Math.floor(minInterval),
    maxInterval: Math.floor(maxInterval),
    minBatch: Math.floor(minBatch),
    maxBatch: Math.floor(maxBatch)
  };
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getNextDelay(options) {
  if (options.fixedInterval !== null) return options.fixedInterval;
  return randomInt(options.minInterval, options.maxInterval);
}

function getNextBatchSize(options, remainingCount) {
  return Math.min(randomInt(options.minBatch, options.maxBatch), remainingCount);
}

function formatAmount(amount) {
  return `${new Intl.NumberFormat('ko-KR').format(Number(amount))}원`;
}

function extractRiskScore(transaction) {
  return transaction?.detection?.risk_score ?? transaction?.detection?.riskScore ?? '-';
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(LOGIN_PAYLOAD)
  });

  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(body.message || `로그인 실패 (${response.status})`);
  }

  if (!body.token) {
    throw new Error('로그인 응답에 token이 없습니다.');
  }

  return body.token;
}

async function postTransaction(transaction, token) {
  return fetch(`${API_BASE_URL}/api/admin/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...transaction,
      occurredAt: new Date().toISOString()
    })
  });
}

async function sendTransaction(transaction, tokenProvider) {
  let response = await postTransaction(transaction, tokenProvider.get());

  if (response.status === 401) {
    await tokenProvider.refresh();
    response = await postTransaction(transaction, tokenProvider.get());
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(body.message || `거래 생성 실패 (${response.status})`);
  }

  return body.transaction;
}

async function loadTransactions() {
  const filePath = path.join(__dirname, 'transactions.json');
  const content = await fs.readFile(filePath, 'utf8');
  const transactions = JSON.parse(content);

  if (!Array.isArray(transactions)) {
    throw new Error('transactions.json은 배열이어야 합니다.');
  }

  return transactions;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const transactions = await loadTransactions();
  const tokenProvider = {
    token: await login(),
    refreshPromise: null,
    get() {
      return this.token;
    },
    set(token) {
      this.token = token;
    },
    async refresh() {
      if (!this.refreshPromise) {
        this.refreshPromise = login().finally(() => {
          this.refreshPromise = null;
        });
      }
      this.token = await this.refreshPromise;
      return this.token;
    }
  };

  let successCount = 0;
  let index = 0;

  while (index < transactions.length) {
    const batchSize = getNextBatchSize(options, transactions.length - index);
    const batch = transactions.slice(index, index + batchSize);
    const batchStart = index + 1;
    const batchEnd = index + batch.length;

    console.log(`[${timestamp()}] ▶ 거래 ${batch.length}건 전송 중... (${batchStart}-${batchEnd}/${transactions.length})`);

    const results = await Promise.all(batch.map(async (transaction) => {
      try {
        const created = await sendTransaction(transaction, tokenProvider);
        const status = created.status || 'UNKNOWN';
        const meta = STATUS_META[status] || { icon: '❔', label: status };
        const score = extractRiskScore(created);

        console.log(
          `[${timestamp()}] ${meta.icon} ${meta.label} | ${transaction.customerName} | ${formatAmount(transaction.amount)} | 점수: ${score}`
        );
        return true;
      } catch (err) {
        console.error(
          `[${timestamp()}] ❗ 거래 실패 | ${transaction.customerName} | ${formatAmount(transaction.amount)} | ${err.message}`
        );
        return false;
      }
    }));

    successCount += results.filter(Boolean).length;
    index += batch.length;

    if (index < transactions.length) {
      await sleep(getNextDelay(options));
    }
  }

  console.log(`✨ 스트리밍 완료! 총 ${transactions.length}건 전송`);
  if (successCount < transactions.length) {
    console.log(`❗ 실패 ${transactions.length - successCount}건, 성공 ${successCount}건`);
  }
}

main().catch((err) => {
  console.error(`❗ 스트리밍 시작 실패: ${err.message}`);
  process.exitCode = 1;
});
