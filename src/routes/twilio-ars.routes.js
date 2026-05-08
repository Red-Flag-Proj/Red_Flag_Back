const express = require('express');
const { env } = require('../config/env');
const { pool } = require('../db/pool');
const { applyArsDecision } = require('../services/ars.service');
const { HttpError } = require('../utils/http-error');

const router = express.Router();

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sendTwiML(res, body) {
  res.type('text/xml').send(body);
}

router.post('/:id/voice', async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE call_verifications
       SET call_status = 'CALL_IN_PROGRESS'
       WHERE id = $1
       RETURNING ars_prompt`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, 'Call verification not found.');
    }

    const actionUrl = `${env.publicBaseUrl}/api/ars/twilio/${req.params.id}/gather`;
    const prompt = result.rows[0].ars_prompt || '';

    sendTwiML(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather
    input="dtmf"
    numDigits="1"
    timeout="8"
    actionOnEmptyResult="true"
    action="${escapeXml(actionUrl)}"
    method="POST">
    <Say language="ko-KR">${escapeXml(prompt)}</Say>
  </Gather>
  <Say language="ko-KR">입력이 확인되지 않았습니다. 상담원 검토로 전환됩니다.</Say>
</Response>`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/gather', async (req, res, next) => {
  try {
    const digits = req.body.Digits;
    const callSid = req.body.CallSid || null;

    const updateResult = await pool.query(
      `UPDATE call_verifications
       SET selected_digit = $1,
           raw_payload = $2::jsonb,
           twilio_call_sid = COALESCE(twilio_call_sid, $3)
       WHERE id = $4`,
      [digits || null, JSON.stringify(req.body), callSid, req.params.id]
    );

    if (updateResult.rowCount === 0) {
      throw new HttpError(404, 'Call verification not found.');
    }

    if (digits) {
      await applyArsDecision(req.params.id, { digit: digits });
    } else {
      await applyArsDecision(req.params.id, { result: 'NO_RESPONSE' });
    }

    sendTwiML(res, '<Response><Say language="ko-KR">확인되었습니다. 감사합니다.</Say></Response>');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const callStatus = req.body.CallStatus || null;
    const callSid = req.body.CallSid || null;
    const callDuration = req.body.CallDuration || null;

    const result = await pool.query(
      `UPDATE call_verifications
       SET last_provider_status = $1,
           twilio_call_sid = COALESCE(twilio_call_sid, $2),
           provider_response = COALESCE(provider_response, '{}'::jsonb)
             || jsonb_build_object(
               'lastStatusCallback',
               jsonb_build_object('CallSid', $2, 'CallStatus', $1, 'CallDuration', $4)
             ),
           answered_at = CASE WHEN $1 = 'answered' THEN COALESCE(answered_at, NOW()) ELSE answered_at END,
           completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END
       WHERE id = $3`,
      [callStatus, callSid, req.params.id, callDuration]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, 'Call verification not found.');
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = { twilioArsRoutes: router };
