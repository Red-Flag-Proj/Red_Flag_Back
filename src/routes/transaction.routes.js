const express = require('express');
const { z } = require('zod');
const { authRequired } = require('../middlewares/auth.middleware');
const { createTransaction, listUserTransactions, getTransactionDetail } = require('../services/transaction.service');

const router = express.Router();

const transactionSchema = z.object({
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'PAYMENT']),
  amount: z.number().positive(),
  occurredAt: z.string().datetime(),
  countryCode: z.string().length(2).optional(),
  city: z.string().max(120).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  ipAddress: z.string().optional(),
  deviceId: z.string().max(120).optional(),
  paymentMethod: z.string().max(50).optional(),
  recipientAccount: z.string().max(120).optional()
});

router.use(authRequired);

router.get('/', async (req, res, next) => {
  try {
    const transactions = await listUserTransactions(req.user.id);
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = transactionSchema.parse(req.body);
    const transaction = await createTransaction(req.user.id, body);
    res.status(201).json({ transaction });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const transaction = await getTransactionDetail(req.params.id, req.user);
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
});

module.exports = { transactionRoutes: router };
