const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { env } = require('./config/env');
const { authRoutes } = require('./routes/auth.routes');
const { transactionRoutes } = require('./routes/transaction.routes');
const { adminRoutes } = require('./routes/admin.routes');
const { reportRoutes } = require('./routes/report.routes');
const { arsRoutes } = require('./routes/ars.routes');
const { errorMiddleware } = require('./middlewares/error.middleware');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigins = env.corsOrigin.split(',').map((origin) => origin.trim());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'fds-backend-node' });
});

app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/ars', arsRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'API 경로를 찾을 수 없습니다.' });
});
app.use(errorMiddleware);

module.exports = { app };
