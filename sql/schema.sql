CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255),
  success BOOLEAN NOT NULL,
  ip_address INET,
  device_id VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ref VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  phone_number VARCHAR(40),
  home_country CHAR(2) NOT NULL DEFAULT 'KR',
  usual_region VARCHAR(120),
  segment VARCHAR(40) NOT NULL DEFAULT 'RETAIL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_ref VARCHAR(80) NOT NULL REFERENCES customers(customer_ref) ON DELETE CASCADE,
  card_token VARCHAR(120) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  suspended_reason TEXT,
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_ref VARCHAR(80),
  customer_name VARCHAR(120),
  type VARCHAR(20) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'PAYMENT')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  country_code CHAR(2),
  city VARCHAR(120),
  merchant_category VARCHAR(80),
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  ip_address INET,
  device_id VARCHAR(120),
  payment_method VARCHAR(50),
  recipient_account VARCHAR(120),
  status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  decided_action VARCHAR(30) NOT NULL DEFAULT 'AUTO_APPROVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  rule_score INTEGER NOT NULL DEFAULT 0,
  personal_score INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL,
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('NORMAL', 'SUSPICIOUS', 'DANGER')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_action TEXT,
  triggered_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  ars_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_risk_level VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(30) NOT NULL CHECK (action IN ('AUTO_APPROVE', 'AUTO_REQUIRE_AUTH', 'AUTO_BLOCK', 'ADMIN_APPROVE', 'ADMIN_HOLD', 'ADMIN_BLOCK', 'ADMIN_REQUIRE_AUTH')),
  previous_status VARCHAR(30) CHECK (previous_status IN ('APPROVED', 'PENDING_REVIEW', 'REQUIRES_AUTH', 'BLOCKED')),
  new_status VARCHAR(30) NOT NULL CHECK (new_status IN ('APPROVED', 'PENDING_REVIEW', 'REQUIRES_AUTH', 'BLOCKED')),
  memo TEXT,
  reason_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS response_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  action_type VARCHAR(40) NOT NULL,
  target VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PENDING', 'FAILED')),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  customer_ref VARCHAR(80),
  phone_number VARCHAR(40),
  provider VARCHAR(20),
  twilio_call_sid VARCHAR(64),
  call_status VARCHAR(30) NOT NULL DEFAULT 'CALL_REQUIRED',
  masked_phone_number VARCHAR(40),
  ars_prompt TEXT,
  ars_result VARCHAR(30),
  selected_digit VARCHAR(4),
  raw_payload JSONB,
  provider_response JSONB,
  last_provider_status VARCHAR(32),
  requested_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code VARCHAR(32),
  last_error_message TEXT,
  memo TEXT,
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_rules (
  id VARCHAR(30) PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL,
  condition TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  max_category_score INTEGER NOT NULL CHECK (max_category_score >= score),
  enabled BOOLEAN NOT NULL DEFAULT true,
  deployment_status VARCHAR(20) NOT NULL DEFAULT 'DEPLOYED' CHECK (deployment_status IN ('PENDING', 'DEPLOYED', 'DRAFT')),
  last_modified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_rule_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id VARCHAR(30) NOT NULL REFERENCES policy_rules(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(30) NOT NULL CHECK (action IN ('ENABLE', 'DISABLE', 'UPDATE')),
  previous_enabled BOOLEAN,
  new_enabled BOOLEAN,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS decided_action VARCHAR(30) NOT NULL DEFAULT 'AUTO_APPROVE',
  ADD COLUMN IF NOT EXISTS customer_ref VARCHAR(80),
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS merchant_category VARCHAR(80);

ALTER TABLE detection_results
  ADD COLUMN IF NOT EXISTS rule_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS triggered_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ars_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_risk_level VARCHAR(40);

ALTER TABLE call_verifications
  ADD COLUMN IF NOT EXISTS masked_phone_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS ars_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ars_result VARCHAR(30),
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

ALTER TABLE transactions
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;

  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%decided_action%'
  LOOP
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;

  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'action_logs'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%action%' OR pg_get_constraintdef(oid) LIKE '%status%')
  LOOP
    EXECUTE format('ALTER TABLE action_logs DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;

  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'response_actions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%action_type%'
  LOOP
    EXECUTE format('ALTER TABLE response_actions DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_status_check,
  DROP CONSTRAINT IF EXISTS transactions_decided_action_check;

ALTER TABLE action_logs
  DROP CONSTRAINT IF EXISTS action_logs_action_check,
  DROP CONSTRAINT IF EXISTS action_logs_previous_status_check,
  DROP CONSTRAINT IF EXISTS action_logs_new_status_check;

ALTER TABLE response_actions
  DROP CONSTRAINT IF EXISTS response_actions_action_type_check;

ALTER TABLE call_verifications
  DROP CONSTRAINT IF EXISTS call_verifications_call_status_check,
  DROP CONSTRAINT IF EXISTS call_verifications_ars_result_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('APPROVED', 'PENDING_REVIEW', 'REQUIRES_AUTH', 'CALL_REQUIRED', 'CALL_IN_PROGRESS', 'CALL_CONFIRMED', 'BLOCKED', 'CARD_SUSPENDED'));

ALTER TABLE transactions
  ADD CONSTRAINT transactions_decided_action_check
  CHECK (decided_action IN ('AUTO_APPROVE', 'AUTO_REQUIRE_AUTH', 'AUTO_CALL_REQUIRED', 'AUTO_BLOCK', 'AUTO_CARD_SUSPEND', 'ADMIN_APPROVE', 'ADMIN_HOLD', 'ADMIN_BLOCK', 'ADMIN_REQUIRE_AUTH', 'ADMIN_CALL_APPROVE', 'ADMIN_CALL_HOLD', 'ARS_CUSTOMER_CONFIRM', 'ARS_CUSTOMER_DENY', 'ARS_NO_RESPONSE'));

ALTER TABLE action_logs
  ADD CONSTRAINT action_logs_action_check
  CHECK (action IN ('AUTO_APPROVE', 'AUTO_REQUIRE_AUTH', 'AUTO_CALL_REQUIRED', 'AUTO_BLOCK', 'AUTO_CARD_SUSPEND', 'ADMIN_APPROVE', 'ADMIN_HOLD', 'ADMIN_BLOCK', 'ADMIN_REQUIRE_AUTH', 'ADMIN_CALL_APPROVE', 'ADMIN_CALL_HOLD', 'ARS_CUSTOMER_CONFIRM', 'ARS_CUSTOMER_DENY', 'ARS_NO_RESPONSE'));

ALTER TABLE action_logs
  ADD CONSTRAINT action_logs_previous_status_check
  CHECK (previous_status IS NULL OR previous_status IN ('APPROVED', 'PENDING_REVIEW', 'REQUIRES_AUTH', 'CALL_REQUIRED', 'CALL_IN_PROGRESS', 'CALL_CONFIRMED', 'BLOCKED', 'CARD_SUSPENDED'));

ALTER TABLE action_logs
  ADD CONSTRAINT action_logs_new_status_check
  CHECK (new_status IN ('APPROVED', 'PENDING_REVIEW', 'REQUIRES_AUTH', 'CALL_REQUIRED', 'CALL_IN_PROGRESS', 'CALL_CONFIRMED', 'BLOCKED', 'CARD_SUSPENDED'));

ALTER TABLE response_actions
  ADD CONSTRAINT response_actions_action_type_check
  CHECK (action_type IN ('APPROVE_TRANSACTION', 'HOLD_TRANSACTION', 'BLOCK_TRANSACTION', 'REQUEST_STEP_UP_AUTH', 'CALL_CUSTOMER', 'SUSPEND_CARD', 'FREEZE_TRANSFER', 'NOTIFY_CUSTOMER', 'QUEUE_MANUAL_REVIEW'));

ALTER TABLE call_verifications
  ADD CONSTRAINT call_verifications_call_status_check
  CHECK (call_status IN ('CALL_REQUIRED', 'CALL_IN_PROGRESS', 'CALL_CONFIRMED', 'CALL_DENIED', 'CALL_NO_RESPONSE', 'CALL_HOLD'));

ALTER TABLE call_verifications
  ADD CONSTRAINT call_verifications_ars_result_check
  CHECK (ars_result IS NULL OR ars_result IN ('CONFIRMED', 'DENIED', 'NO_RESPONSE'));

INSERT INTO policy_rules (id, code, category, condition, score, max_category_score)
VALUES
  ('RULE-001', 'HIGH_AMOUNT', '금액', '최근 7일 평균 대비 3배 이상 또는 100만원 이상 거래', 30, 40),
  ('RULE-002', 'FREQUENT_TRANSACTION', '빈도', '1시간 내 반복 거래 3회 이상', 25, 50),
  ('RULE-003', 'FOREIGN_IP_OR_LOCATION', '위치', '해외 IP 또는 해외 위치 거래', 30, 60),
  ('RULE-004', 'NIGHT_TRANSACTION', '시간', '00시부터 05시 사이 새벽 거래', 15, 30),
  ('RULE-005', 'NEW_DEVICE', '행동', '신규 기기 거래', 20, 50),
  ('RULE-006', 'NEW_PAYMENT_METHOD', '행동', '새로운 결제 방식 사용', 10, 50),
  ('RULE-007', 'FAILED_LOGIN_BEFORE_TRANSACTION', '계정 보안', '로그인 실패 후 1시간 이내 거래', 20, 50)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  category = EXCLUDED.category,
  condition = EXCLUDED.condition,
  score = EXCLUDED.score,
  max_category_score = EXCLUDED.max_category_score;

CREATE INDEX IF NOT EXISTS idx_transactions_user_time ON transactions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_time ON transactions(customer_ref, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_ref ON customers(customer_ref);
CREATE INDEX IF NOT EXISTS idx_customer_cards_customer ON customer_cards(customer_ref, status);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_detection_level ON detection_results(risk_level, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_action_logs_transaction_time ON action_logs(transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_response_actions_transaction_time ON response_actions(transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_verifications_transaction ON call_verifications(transaction_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_verifications_twilio_call_sid
  ON call_verifications (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_policy_rules_enabled ON policy_rules(enabled, deployment_status);
CREATE INDEX IF NOT EXISTS idx_policy_rule_logs_rule_time ON policy_rule_logs(rule_id, created_at DESC);
