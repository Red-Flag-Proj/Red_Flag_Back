function errorMiddleware(err, req, res, next) {
  if (err.name === 'ZodError') {
    return res.status(400).json({
      message: '요청 값이 올바르지 않습니다.',
      errors: err.errors
    });
  }

  const status = err.status || 500;
  const message = status === 500 ? '서버 오류가 발생했습니다.' : err.message;

  return res.status(status).json({ message });
}

module.exports = { errorMiddleware };
