const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http-error');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return next(new HttpError(401, '로그인이 필요합니다.'));
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch (err) {
    return next(new HttpError(401, '인증 토큰이 유효하지 않습니다.'));
  }
}

function adminRequired(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return next(new HttpError(403, '관리자 권한이 필요합니다.'));
  }
  return next();
}

module.exports = { authRequired, adminRequired };
