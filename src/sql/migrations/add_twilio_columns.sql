ALTER TABLE call_verifications
  ADD COLUMN IF NOT EXISTS provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS twilio_call_sid VARCHAR(64),
  ADD COLUMN IF NOT EXISTS selected_digit VARCHAR(4),
  ADD COLUMN IF NOT EXISTS raw_payload JSONB,
  ADD COLUMN IF NOT EXISTS provider_response JSONB,
  ADD COLUMN IF NOT EXISTS last_provider_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_verifications_twilio_call_sid
  ON call_verifications (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;
