const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http-error');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username, role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

async function register({ email, username, password, role = 'USER' }) {
  const exists = await pool.query(
    'SELECT id FROM users WHERE email = $1 OR username = $2',
    [email, username]
  );

  if (exists.rowCount > 0) {
    throw new HttpError(409, '이미 사용 중인 이메일 또는 아이디입니다.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, username, role, created_at`,
    [email, username, passwordHash, role]
  );

  const user = result.rows[0];
  return { user, token: signToken(user) };
}

async function login({ emailOrUsername, password, ipAddress, deviceId }) {
  const result = await pool.query(
    `SELECT id, email, username, password_hash, role
     FROM users
     WHERE email = $1 OR username = $1`,
    [emailOrUsername]
  );

  const user = result.rows[0];
  const success = user ? await bcrypt.compare(password, user.password_hash) : false;

  await pool.query(
    `INSERT INTO login_events (user_id, email, success, ip_address, device_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [user?.id || null, emailOrUsername, success, ipAddress || null, deviceId || null]
  );

  if (!success) {
    throw new HttpError(401, '이메일/아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  const safeUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role
  };

  return { user: safeUser, token: signToken(safeUser) };
}

module.exports = { register, login };
