-- Migration 006: Contractor Technical Capability Assessment & Scoped Approval

CREATE TABLE IF NOT EXISTS contractor_capability_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  issue_type_id uuid NOT NULL REFERENCES issue_types(id) ON DELETE RESTRICT,
  geography text NOT NULL DEFAULT 'ON',
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (
    status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PROVISIONAL', 'SUPERVISED', 'REJECTED', 'EXPIRED', 'REVOKED', 'APPEALED')
  ),
  complexity_tier text NOT NULL DEFAULT 'TIER_1_BASIC' CHECK (
    complexity_tier IN ('TIER_1_BASIC', 'TIER_2_STANDARD', 'TIER_3_ADVANCED', 'TIER_4_SPECIALIZED')
  ),
  years_experience integer NOT NULL DEFAULT 0 CHECK (years_experience >= 0),
  max_job_value_cents bigint NOT NULL DEFAULT 250000 CHECK (max_job_value_cents >= 0),
  work_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  "references" jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools_equipment jsonb NOT NULL DEFAULT '[]'::jsonb,
  supervised_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  denial_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessed_by_user_id uuid REFERENCES users(id),
  assessed_at timestamptz,
  valid_until timestamptz,
  decision_notes text,
  appeal_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_capability_assessment_uniq UNIQUE(contractor_id, issue_type_id, geography),
  CONSTRAINT capability_approved_requires_assessor CHECK (
    status NOT IN ('APPROVED', 'PROVISIONAL', 'SUPERVISED') OR (
      assessed_by_user_id IS NOT NULL AND assessed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_capability_contractor_lookup
  ON contractor_capability_assessments(contractor_id, issue_type_id, geography, status);

CREATE INDEX IF NOT EXISTS idx_capability_status_validity
  ON contractor_capability_assessments(status, valid_until);

CREATE INDEX IF NOT EXISTS idx_capability_assessor
  ON contractor_capability_assessments(assessed_by_user_id);
