require('dotenv').config();

const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://fds_user:fds_password@localhost:5432/fds_db',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  arsWebhookSecret: process.env.ARS_WEBHOOK_SECRET || ''
};

module.exports = { env };
