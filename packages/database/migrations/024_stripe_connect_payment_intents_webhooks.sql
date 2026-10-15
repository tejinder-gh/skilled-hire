-- Migration 024: Stripe Connect Sandbox, Real Payment Intents and Webhooks (SH-07)

-- 1. Create Enums
DO $$ BEGIN
  CREATE TYPE connect_onboarding_status AS ENUM (
    'NOT_STARTED',
    'IN_PROGRESS',
    'PENDING_VERIFICATION',
    'COMPLETED',
    'RESTRICTED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_intent_status AS ENUM (
    'REQUIRES_PAYMENT_METHOD',
    'REQUIRES_CONFIRMATION',
    'REQUIRES_ACTION',
    'PROCESSING',
    'SUCCEEDED',
    'CANCELED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_event_status AS ENUM (
    'RECEIVED',
    'PROCESSING',
    'PROCESSED',
    'FAILED',
    'IGNORED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE dispute_status AS ENUM (
    'NEEDS_RESPONSE',
    'UNDER_REVIEW',
    'WON',
    'LOST'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Stripe Connect Accounts for Contractors
CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL UNIQUE REFERENCES contractors(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(128) NOT NULL UNIQUE,
  account_type VARCHAR(32) NOT NULL DEFAULT 'express',
  onboarding_status connect_onboarding_status NOT NULL DEFAULT 'NOT_STARTED',
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  details_submitted BOOLEAN NOT NULL DEFAULT false,
  country VARCHAR(2) NOT NULL DEFAULT 'CA',
  default_currency VARCHAR(3) NOT NULL DEFAULT 'CAD',
  requirements_due JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connect_accounts_contractor ON stripe_connect_accounts(contractor_id);
CREATE INDEX IF NOT EXISTS idx_connect_accounts_stripe_id ON stripe_connect_accounts(stripe_account_id);
CREATE INDEX IF NOT EXISTS idx_connect_accounts_status ON stripe_connect_accounts(onboarding_status);

-- 3. Customer Saved Payment Methods
CREATE TABLE IF NOT EXISTS customer_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_method_id VARCHAR(128) NOT NULL UNIQUE,
  brand VARCHAR(32) NOT NULL,
  last4 VARCHAR(4) NOT NULL,
  exp_month INTEGER NOT NULL,
  exp_year INTEGER NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_pm_customer ON customer_payment_methods(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_pm_stripe_id ON customer_payment_methods(stripe_payment_method_id);

-- 4. Payment Intents & Destination Charges
CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES payment_milestones(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  stripe_payment_intent_id VARCHAR(128) NOT NULL UNIQUE,
  stripe_client_secret VARCHAR(255) NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  application_fee_amount_cents BIGINT NOT NULL DEFAULT 0,
  status payment_intent_status NOT NULL DEFAULT 'REQUIRES_PAYMENT_METHOD',
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  failure_code VARCHAR(64),
  failure_message TEXT,
  receipt_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_milestone ON payment_intents(milestone_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_customer ON payment_intents(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_stripe_id ON payment_intents(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);

-- 5. Stripe Webhook Events Ledger
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(128) NOT NULL UNIQUE,
  event_type VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(255),
  payload JSONB NOT NULL,
  status webhook_event_status NOT NULL DEFAULT 'RECEIVED',
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhooks_event_id ON stripe_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_webhooks_type ON stripe_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_stripe_webhooks_status ON stripe_webhook_events(status);

-- 6. Payment Disputes & Chargeback Tracking
CREATE TABLE IF NOT EXISTS payment_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES payment_transactions(id) ON DELETE SET NULL,
  stripe_dispute_id VARCHAR(128) NOT NULL UNIQUE,
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  status dispute_status NOT NULL DEFAULT 'NEEDS_RESPONSE',
  reason VARCHAR(128) NOT NULL,
  evidence_due_by TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_disputes_transaction ON payment_disputes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_disputes_stripe_id ON payment_disputes(stripe_dispute_id);
