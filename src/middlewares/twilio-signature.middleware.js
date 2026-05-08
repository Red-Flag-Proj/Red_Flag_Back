const twilio = require('twilio');

function validateTwilioSignature(env) {
  return (req, res, next) => {
    if (!env.twilioValidateSignature) return next();
    const signature = req.get('X-Twilio-Signature') || '';
    const url = `${env.publicBaseUrl}${req.originalUrl}`;
    const ok = twilio.validateRequest(env.twilioAuthToken, signature, url, req.body);
    if (!ok) return res.status(403).json({ message: 'Invalid Twilio signature' });
    next();
  };
}

module.exports = { validateTwilioSignature };
