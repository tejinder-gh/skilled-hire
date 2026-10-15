-- 026_transactional_outbox_and_reliable_notifications.sql
-- Transactional Outbox, Reliable Notifications, User Preferences, Delivery Logs, and Templates (SH-09)

DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'RETRYING',
    'DEAD_LETTER',
    'CANCELLED_PREFERENCE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_preference_category AS ENUM (
    'DISPATCH_ALERTS',
    'TRANSACTIONAL_RECEIPTS',
    'JOB_MILESTONES',
    'MARKETING_PROMOTIONS',
    'SAFETY_EMERGENCY'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1. Notification Templates Registry & Versioning
CREATE TABLE IF NOT EXISTS notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_slug TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  channel notification_channel NOT NULL,
  subject_template TEXT,
  body_template TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notification_template_version UNIQUE (template_slug, version, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_slug ON notification_templates (template_slug, channel);

-- 2. User Notification Preferences (Opt-in / Opt-out)
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  category notification_preference_category NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  opted_out_at TIMESTAMPTZ,
  opt_in_source TEXT NOT NULL DEFAULT 'ONBOARDING_CONSENT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_channel_category UNIQUE (user_id, channel, category)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_lookup ON user_notification_preferences (user_id, category);

-- 3. Transactional Outbox (Atomic State + Event Capture)
CREATE TABLE IF NOT EXISTS transactional_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel notification_channel NOT NULL,
  destination TEXT NOT NULL,
  template_slug TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status outbox_status NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_poll_queue ON transactional_outbox (status, next_attempt_at) 
  WHERE status IN ('PENDING', 'RETRYING');
CREATE INDEX IF NOT EXISTS idx_outbox_recipient ON transactional_outbox (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON transactional_outbox (aggregate_type, aggregate_id);

-- 4. Notification Delivery Logs (Immutable Provider Audit Trail)
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID NOT NULL REFERENCES transactional_outbox(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  recipient TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_message_id TEXT,
  attempt_number INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_outbox ON notification_delivery_logs (outbox_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_created_at ON notification_delivery_logs (created_at DESC);
