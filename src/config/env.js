require('dotenv').config();

const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://fds_user:fds_password@localhost:5432/fds_db',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  arsWebhookSecret: process.env.ARS_WEBHOOK_SECRET || '',
  twilioEnabled: process.env.TWILIO_ENABLED === 'true',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  twilioCallTimeoutSeconds: Number(process.env.TWILIO_CALL_TIMEOUT_SECONDS || 20),
  twilioValidateSignature: process.env.TWILIO_VALIDATE_SIGNATURE === 'true',
  fraudGuardRoot: process.env.FRAUDGUARD_ROOT || 'C:\\Users\\USER\\Desktop\\FraudGuard-main',
  fraudGuardPython: process.env.FRAUDGUARD_PYTHON || 'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\platform\\bundledpython\\python.exe',
  fraudGuardTimeoutMs: Number(process.env.FRAUDGUARD_TIMEOUT_MS || 15000)
};

module.exports = { env };
