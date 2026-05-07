const express = require('express');
const { z } = require('zod');
const { recordArsResponse } = require('../services/ars.service');

const router = express.Router();

const arsResponseSchema = z.object({
  digit: z.string().optional(),
  result: z.enum(['CONFIRMED', 'DENIED', 'NO_RESPONSE', 'TIMEOUT', 'FAILED']).optional(),
  memo: z.string().max(1000).optional()
}).refine((body) => body.digit || body.result, {
  message: 'digit or result is required.'
});

router.post('/call-verifications/:id/response', async (req, res, next) => {
  try {
    const body = arsResponseSchema.parse(req.body);
    const result = await recordArsResponse(req.params.id, body, req.get('x-ars-secret'));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = { arsRoutes: router };
