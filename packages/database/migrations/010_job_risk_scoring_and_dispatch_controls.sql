-- Migration 010: Versioned Job Risk Scoring & Risk-Tier Dispatch Controls (#60)

-- 1. Risk Policies Table (Versioned risk matrices, hazard rules, and control thresholds)
CREATE TABLE IF NOT EXISTS risk_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  effective_date timestamptz NOT NULL DEFAULT now(),
  dimensions_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  hazard_flag_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  tier_thresholds jsonb NOT NULL DEFAULT '{
    "lowMax": 25,
    "moderateMax": 55,
    "highMax": 80,
    "criticalMin": 81
  }'::jsonb,
  mandatory_controls_config jsonb NOT NULL DEFAULT '[]'::jsonb,
  calibration_notes text,
  provenance_audit jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_policies_version ON risk_policies(version);
CREATE INDEX IF NOT EXISTS idx_risk_policies_is_active ON risk_policies(is_active);

-- 2. Job Risk Assessments Table (Immutable per-assessment calculation snapshots and review records)
CREATE TABLE IF NOT EXISTS job_risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  service_request_id uuid REFERENCES service_requests(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES risk_policies(id),
  policy_version text NOT NULL,
  inherent_score integer NOT NULL CHECK (inherent_score >= 0 AND inherent_score <= 100),
  mitigations_score integer NOT NULL CHECK (mitigations_score >= 0 AND mitigations_score <= 100),
  residual_score integer NOT NULL CHECK (residual_score >= 0 AND residual_score <= 100),
  risk_tier text NOT NULL CHECK (
    risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')
  ),
  hazard_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  mandatory_controls jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_controls jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_manual_approval boolean NOT NULL DEFAULT false,
  manual_approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (
    manual_approval_status IN ('NOT_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')
  ),
  manual_approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  manual_approved_at timestamptz,
  manual_approval_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_job_or_service_request CHECK (job_id IS NOT NULL OR service_request_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_job_risk_assessments_job_id ON job_risk_assessments(job_id);
CREATE INDEX IF NOT EXISTS idx_job_risk_assessments_service_request_id ON job_risk_assessments(service_request_id);
CREATE INDEX IF NOT EXISTS idx_job_risk_assessments_policy_id ON job_risk_assessments(policy_id);
CREATE INDEX IF NOT EXISTS idx_job_risk_assessments_tier ON job_risk_assessments(risk_tier);
CREATE INDEX IF NOT EXISTS idx_job_risk_assessments_manual_status ON job_risk_assessments(manual_approval_status);

-- 3. Extend jobs and service_requests tables with risk tier, score, and assessment links
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'LOW' CHECK (
    risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')
  ),
  ADD COLUMN IF NOT EXISTS risk_score integer,
  ADD COLUMN IF NOT EXISTS risk_assessment_id uuid REFERENCES job_risk_assessments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS risk_review_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (
    risk_review_status IN ('NOT_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')
  );

CREATE INDEX IF NOT EXISTS idx_jobs_risk_tier ON jobs(risk_tier);
CREATE INDEX IF NOT EXISTS idx_jobs_risk_review_status ON jobs(risk_review_status);

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'LOW' CHECK (
    risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')
  ),
  ADD COLUMN IF NOT EXISTS risk_score integer,
  ADD COLUMN IF NOT EXISTS risk_assessment_id uuid REFERENCES job_risk_assessments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS risk_review_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (
    risk_review_status IN ('NOT_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')
  );

CREATE INDEX IF NOT EXISTS idx_service_requests_risk_tier ON service_requests(risk_tier);
CREATE INDEX IF NOT EXISTS idx_service_requests_risk_review_status ON service_requests(risk_review_status);

-- 4. Seed Canonical Initial Risk Policy (v1.0.0)
INSERT INTO risk_policies (
  version,
  name,
  is_active,
  effective_date,
  dimensions_config,
  hazard_flag_rules,
  tier_thresholds,
  mandatory_controls_config,
  calibration_notes,
  provenance_audit
) VALUES (
  '1.0.0',
  'Ontario Multi-Trade Baseline Risk & Dispatch Policy 2026',
  true,
  now(),
  '{
    "tradeBaselineWeights": {
      "electrical": 35,
      "hvac": 30,
      "plumbing": 20,
      "roofing": 35,
      "structural": 40
    },
    "complexityWeights": {
      "TIER_1_STANDARD": 5,
      "TIER_2_INTERMEDIATE": 20,
      "TIER_3_ADVANCED": 40
    },
    "valueCeilings": {
      "standardCents": 100000,
      "highValueCents": 500000,
      "commercialCents": 1000000
    }
  }'::jsonb,
  '[
    {"flag": "LIVE_ELECTRICAL_WORK", "severity": "RED_FLAG", "inherentAdd": 45, "requiresManualApproval": true},
    {"flag": "HIGH_VOLTAGE", "severity": "RED_FLAG", "inherentAdd": 40, "requiresManualApproval": true},
    {"flag": "GAS_COMBUSTION", "severity": "RED_FLAG", "inherentAdd": 35, "requiresManualApproval": true},
    {"flag": "CONFINED_SPACE", "severity": "HIGH", "inherentAdd": 30, "requiresManualApproval": false},
    {"flag": "WORKING_AT_HEIGHTS", "severity": "HIGH", "inherentAdd": 25, "requiresManualApproval": false},
    {"flag": "STRUCTURAL_LOAD_BEARING", "severity": "RED_FLAG", "inherentAdd": 40, "requiresManualApproval": true},
    {"flag": "HAZARDOUS_MATERIALS_ASBESTOS", "severity": "RED_FLAG", "inherentAdd": 45, "requiresManualApproval": true},
    {"flag": "WATER_PROXIMITY_ELECTRICAL", "severity": "HIGH", "inherentAdd": 30, "requiresManualApproval": false}
  ]'::jsonb,
  '{
    "lowMax": 25,
    "moderateMax": 55,
    "highMax": 80,
    "criticalMin": 81
  }'::jsonb,
  '[
    {"trigger": "CRITICAL", "control": "SITE_SPECIFIC_SAFETY_PLAN"},
    {"trigger": "CRITICAL", "control": "SENIOR_SUPERVISOR_ON_SITE"},
    {"trigger": "HIGH_VOLTAGE", "control": "LOCKOUT_TAGOUT_PLAN"},
    {"trigger": "HIGH_VOLTAGE", "control": "CAL_RATED_PPE"},
    {"trigger": "CONFINED_SPACE", "control": "ATMOSPHERIC_TESTING"},
    {"trigger": "WORKING_AT_HEIGHTS", "control": "FALL_ARREST_EQUIPMENT"},
    {"trigger": "LIVE_ELECTRICAL_WORK", "control": "TWO_PERSON_CREW"}
  ]'::jsonb,
  'Calibrated against Ontario Occupational Health and Safety Act and ESA requirements.',
  '{"author": "Safety Operations", "authorizedBy": "Chief Compliance Officer"}'::jsonb
) ON CONFLICT (version) DO NOTHING;
