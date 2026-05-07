const express = require('express');
const { z } = require('zod');
const { register, login } = require('../services/auth.service');
const { authRequired } = require('../middlewares/auth.middleware');

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(80),
  password: z.string().min(8),
  role: z.enum(['USER', 'ADMIN']).optional()
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(3),
  password: z.string().min(1),
  deviceId: z.string().max(120).optional()
});

router.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const result = await register(body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await login({
      ...body,
      ipAddress: req.ip
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

module.exports = { authRoutes: router };
