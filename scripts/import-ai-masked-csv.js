const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../src/db/pool');

const API_BASE_URL = process.env.FDS_API_BASE_URL || 'http://localhost:4000';
const DEFAULT_CSV_PATH = path.join('C:', 'Users', 'USER', 'Desktop', 'FraudGuard-main', 'AI Engine', 'data', 'db_test_transactions_400_masked.csv');
const LOGIN_PAYLOAD = {
  emailOrUsername: process.env.FDS_ADMIN_EMAIL || 'admin@fds.local',
  password: process.env.FDS_ADMIN_PASSWORD || 'Admin1234!'
};

const TYPE_BY_METHOD = {
  ACCOUNT: 'TRANSFER',
  CARD: 'PAYMENT',
  'E-PAY': 'PAYMENT',
};

function parseArgs(argv) {
  const options = {
    csvPath: DEFAULT_CSV_PATH,
    reset: true,
    delayMs: 0,
    limit: null,
    preserveOrder: false,
    reverse: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--csv') {
      options.csvPath = argv[index + 1];
      index += 1;
    } else if (arg === '--no-reset') {
      options.reset = false;
    } else if (arg === '--delay-ms') {
      options.delayMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--limit') {
      options.limit = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--preserve-order') {
      options.preserveOrder = true;
    } else if (arg === '--reverse') {
      options.reverse = true;
    }
  }

  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be a non-negative number.');
  }
  if (options.limit !== null && (!Number.isFinite(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive number.');
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseCsv(content) {
  const lines = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
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

  if (!response.ok || !body.token) {
    throw new Error(body.message || `Login failed (${response.status})`);
  }

  return body.token;
}

function rowToPayload(row) {
  const paymentMethod = row.paymentMethod || 'CARD';
  const occurredAt = row.occurredAt.endsWith('Z') || /[+-]\d\d:\d\d$/.test(row.occurredAt)
    ? row.occurredAt
    : `${row.occurredAt}Z`;
  return {
    customerRef: row.customerRef,
    customerName: row.customerName,
    phoneNumber: '+821060000000',
    type: TYPE_BY_METHOD[paymentMethod] || 'PAYMENT',
    amount: Number(row.amount),
    occurredAt: new Date(occurredAt).toISOString(),
    countryCode: row.countryCode || undefined,
    city: row.city || undefined,
    merchantCategory: row.merchantCategory || undefined,
    latitude: row.latitude ? Number(row.latitude) : undefined,
    longitude: row.longitude ? Number(row.longitude) : undefined,
    deviceId: row.deviceId || undefined,
    paymentMethod,
    recipientAccount: row.merchantId || row.transactionId
  };
}

async function resetImportedRows() {
  await pool.query("DELETE FROM transactions WHERE customer_ref LIKE 'CUST\\_%' ESCAPE '\\'");
  await pool.query("DELETE FROM customer_cards WHERE customer_ref LIKE 'CUST\\_%' ESCAPE '\\'");
  await pool.query("DELETE FROM customers WHERE customer_ref LIKE 'CUST\\_%' ESCAPE '\\'");
}

async function postTransaction(payload, token) {
  const response = await fetch(`${API_BASE_URL}/api/admin/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    const details = Array.isArray(body.errors) ? ` ${JSON.stringify(body.errors)}` : '';
    throw new Error(`${body.message || `Transaction import failed (${response.status})`}${details}`);
  }

  return body.transaction;
}

function summarize(counts, transaction) {
  const riskLevel = transaction?.detection?.risk_level || transaction?.risk_level || 'UNKNOWN';
  counts[riskLevel] = (counts[riskLevel] || 0) + 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const content = await fs.readFile(options.csvPath, 'utf8');
  let rows = parseCsv(content);
  if (!options.preserveOrder) {
    rows = rows.sort((a, b) => {
      if (a.occurredAt === b.occurredAt) return a.transactionId.localeCompare(b.transactionId);
      return a.occurredAt.localeCompare(b.occurredAt);
    });
  }
  if (options.limit !== null) {
    rows = rows.slice(0, options.limit);
  }
  if (options.reverse) {
    rows = rows.reverse();
  }

  if (options.reset) {
    await resetImportedRows();
  }

  const token = await login();
  const counts = {};

  for (let index = 0; index < rows.length; index += 1) {
    const created = await postTransaction(rowToPayload(rows[index]), token);
    summarize(counts, created);

    if ((index + 1) % 25 === 0 || index + 1 === rows.length) {
      console.log(`Imported ${index + 1}/${rows.length}`);
    }
    if (options.delayMs > 0 && index + 1 < rows.length) {
      await sleep(options.delayMs);
    }
  }

  console.log(`Imported ${rows.length} masked AI rows through backend API.`);
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
