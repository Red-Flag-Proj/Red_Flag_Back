const { pool } = require('../db/pool');
const { getTwilioClient } = require('../integrations/twilio.client');
const { HttpError } = require('../utils/http-error');

function buildWebhookUrl(env, callVerificationId, path) {
  if (!env.publicBaseUrl) {
    throw new HttpError(503, 'Twilio public base URL is not configured.');
  }
  return `${env.publicBaseUrl}/api/ars/twilio/${callVerificationId}/${path}`;
}

function buildProviderResponse(call) {
  return {
    sid: call.sid,
    status: call.status,
    to: call.to,
    from: call.from,
    direction: call.direction,
    dateCreated: call.dateCreated,
    uri: call.uri
  };
}

async function sendTwilioArsCall({ env, callVerificationId, to }) {
  try {
    if (!env.twilioFromNumber) {
      throw new HttpError(503, 'Twilio from number is not configured.');
    }
    if (!to) {
      throw new HttpError(400, 'Call verification phone number is not configured.');
    }

    const client = getTwilioClient(env);
    const call = await client.calls.create({
      to,
      from: env.twilioFromNumber,
      url: buildWebhookUrl(env, callVerificationId, 'voice'),
      statusCallback: buildWebhookUrl(env, callVerificationId, 'status'),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      timeout: env.twilioCallTimeoutSeconds
    });

    const result = await pool.query(
      `UPDATE call_verifications
       SET provider = 'TWILIO',
           twilio_call_sid = $1,
           call_status = 'CALL_IN_PROGRESS',
           requested_at = NOW(),
           last_provider_status = $2,
           provider_response = $3::jsonb
       WHERE id = $4
       RETURNING *`,
      [call.sid, call.status, JSON.stringify(buildProviderResponse(call)), callVerificationId]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, 'Call verification not found.');
    }

    await pool.query(
      `UPDATE transactions
       SET status = 'CALL_IN_PROGRESS'
       WHERE id = $1
         AND status NOT IN ('APPROVED', 'BLOCKED', 'CARD_SUSPENDED')`,
      [result.rows[0].transaction_id]
    );

    return result.rows[0];
  } catch (err) {
    await pool.query(
      `UPDATE call_verifications
       SET provider = 'TWILIO',
           call_status = 'CALL_HOLD',
           last_error_code = $1,
           last_error_message = $2
       WHERE id = $3`,
      [err.code ? String(err.code) : null, err.message || 'Twilio call failed', callVerificationId]
    );
    throw err;
  }
}

module.exports = { sendTwilioArsCall };
