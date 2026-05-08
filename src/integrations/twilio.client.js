const twilio = require('twilio');

function getTwilioClient(env) {
  if (!env.twilioAccountSid || !env.twilioAuthToken) {
    throw new Error('Twilio credentials are not configured');
  }
  return twilio(env.twilioAccountSid, env.twilioAuthToken);
}

module.exports = { getTwilioClient };
