const express = require('express');
const { z } = require('zod');
const { authRequired, adminRequired } = require('../middlewares/auth.middleware');
const { createAdminTransaction, getStats, listSuspiciousTransactions } = require('../services/admin.service');
const { getTransactionDetail } = require('../services/transaction.service');
const { applyAdminAction } = require('../services/action.service');
const { listPolicyRules, togglePolicyRule, listPolicyRuleLogs } = require('../services/policy.service');

const router = express.Router();

const adminTransactionSchema = z.object({
  customerRef: z.string().min(1).max(80),
  customerName: z.string().max(120).optional(),
  phoneNumber: z.string().max(40).optional(),
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'PAYMENT']),
  amount: z.number().positive(),
  occurredAt: z.string().datetime(),
  countryCode: z.string().length(2).optional(),
  city: z.string().max(120).optional(),
  merchantCategory: z.string().max(80).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  ipAddress: z.string().optional(),
  deviceId: z.string().max(120).optional(),
  paymentMethod: z.string().max(50).optional(),
  recipientAccount: z.string().max(120).optional()
});

const actionSchema = z.object({
  action: z.enum(['APPROVE', 'HOLD', 'BLOCK', 'REQUEST_AUTH', 'CALL_APPROVE', 'CALL_HOLD']),
  memo: z.string().max(1000).optional()
});

const policyToggleSchema = z.object({
  reason: z.string().max(1000).optional()
});

router.use(authRequired, adminRequired);

router.post('/transactions', async (req, res, next) => {
  try {
    const body = adminTransactionSchema.parse(req.body);
    const transaction = await createAdminTransaction(body);
    res.status(201).json({ transaction });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getStats();
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

router.get('/policy-rules', async (req, res, next) => {
  try {
    const rules = await listPolicyRules();
    res.json({ rules });
  } catch (err) {
    next(err);
  }
});

router.post('/policy-rules/:id/toggle', async (req, res, next) => {
  try {
    const body = policyToggleSchema.parse(req.body);
    const rule = await togglePolicyRule(req.params.id, req.user.id, body.reason);
    res.json({ rule });
  } catch (err) {
    next(err);
  }
});

router.get('/policy-rule-logs', async (req, res, next) => {
  try {
    const logs = await listPolicyRuleLogs();
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

router.get('/suspicious-transactions', async (req, res, next) => {
  try {
    const transactions = await listSuspiciousTransactions();
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions/:id', async (req, res, next) => {
  try {
    const transaction = await getTransactionDetail(req.params.id, req.user);
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
});

router.post('/transactions/:id/actions', async (req, res, next) => {
  try {
    const body = actionSchema.parse(req.body);
    const result = await applyAdminAction(req.params.id, req.user.id, body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = { adminRoutes: router };
