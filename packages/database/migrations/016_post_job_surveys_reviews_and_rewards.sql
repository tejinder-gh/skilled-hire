-- packages/database/migrations/016_post_job_surveys_reviews_and_rewards.sql

-- 1. Customer Feedback Preferences
CREATE TABLE IF NOT EXISTS customer_feedback_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  feedback_opt_in BOOLEAN NOT NULL DEFAULT true,
  sms_opt_in BOOLEAN NOT NULL DEFAULT false,
  email_opt_in BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfp_customer_id ON customer_feedback_preferences(customer_id);

-- 2. Post-Job Surveys & Fair Reviews
CREATE TABLE IF NOT EXISTS post_job_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  survey_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'OPTED_OUT', 'EXPIRED')),
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL', 'SMS', 'IN_APP')),
  overall_rating SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
  quality_rating SMALLINT CHECK (quality_rating BETWEEN 1 AND 5),
  professionalism_rating SMALLINT CHECK (professionalism_rating BETWEEN 1 AND 5),
  timeliness_rating SMALLINT CHECK (timeliness_rating BETWEEN 1 AND 5),
  communication_rating SMALLINT CHECK (communication_rating BETWEEN 1 AND 5),
  nps_score SMALLINT CHECK (nps_score BETWEEN 0 AND 10),
  feedback_comment TEXT,
  review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,
  routed_to_support BOOLEAN NOT NULL DEFAULT false,
  support_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pjs_job_id ON post_job_surveys(job_id);
CREATE INDEX IF NOT EXISTS idx_pjs_customer_id ON post_job_surveys(customer_id);
CREATE INDEX IF NOT EXISTS idx_pjs_contractor_id ON post_job_surveys(contractor_id);
CREATE INDEX IF NOT EXISTS idx_pjs_survey_token ON post_job_surveys(survey_token);
CREATE INDEX IF NOT EXISTS idx_pjs_status ON post_job_surveys(status);

-- 3. Customer Reward Credits Ledger (10% Next-Booking Credit)
CREATE TABLE IF NOT EXISTS customer_reward_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin_job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  survey_id UUID NOT NULL UNIQUE REFERENCES post_job_surveys(id) ON DELETE RESTRICT,
  reward_type TEXT NOT NULL DEFAULT 'POST_JOB_SURVEY_10_PERCENT' CHECK (reward_type IN ('POST_JOB_SURVEY_10_PERCENT', 'LOYALTY_PROMOTION', 'SERVICE_RECOVERY')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  cap_cents INTEGER NOT NULL DEFAULT 3000,
  percentage_bps INTEGER NOT NULL DEFAULT 1000,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REDEEMED', 'EXPIRED', 'VOIDED_FRAUD')),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crc_customer_id ON customer_reward_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_crc_origin_job_id ON customer_reward_credits(origin_job_id);
CREATE INDEX IF NOT EXISTS idx_crc_survey_id ON customer_reward_credits(survey_id);
CREATE INDEX IF NOT EXISTS idx_crc_status ON customer_reward_credits(status);
