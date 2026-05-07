function maskPhoneNumber(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function maskName(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (text.length <= 1) return '*';
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${'*'.repeat(text.length - 2)}${text[text.length - 1]}`;
}

function maskAccount(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function maskIpAddress(value) {
  if (!value) return null;
  const text = String(value);
  if (text.includes(':')) return text.replace(/:[^:]*$/, ':****');
  const parts = text.split('.');
  if (parts.length !== 4) return '***';
  return `${parts[0]}.${parts[1]}.***.***`;
}

function maskDeviceId(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 6) return '***';
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function maskTransactionRow(row = {}) {
  return {
    ...row,
    customer_name: maskName(row.customer_name),
    recipient_account: maskAccount(row.recipient_account),
    ip_address: maskIpAddress(row.ip_address),
    device_id: maskDeviceId(row.device_id)
  };
}

function maskCallVerificationRow(row = {}) {
  return {
    ...row,
    phone_number: row.masked_phone_number || maskPhoneNumber(row.phone_number)
  };
}

module.exports = {
  maskAccount,
  maskCallVerificationRow,
  maskDeviceId,
  maskIpAddress,
  maskName,
  maskPhoneNumber,
  maskTransactionRow
};
