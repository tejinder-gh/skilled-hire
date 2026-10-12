-- Migration 007: Pre-Dispatch Eligibility Reevaluation and Worker Identity Verification (#57)

-- 1. Extend jobs table with immutable evidence snapshot, jurisdiction, scope, and worker identity verification
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS worker_identity_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS worker_identity_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_identity_method text CHECK (
    worker_identity_method IS NULL OR worker_identity_method IN ('GOVT_PHOTO_ID', 'BIOMETRIC_CHECK', 'SUPERVISOR_CONFIRMATION', 'DISPATCHER_OVERRIDE')
  ),
  ADD COLUMN IF NOT EXISTS worker_identity_notes text,
  ADD COLUMN IF NOT EXISTS assigned_jurisdiction text NOT NULL DEFAULT 'ON',
  ADD COLUMN IF NOT EXISTS assigned_scope jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_jobs_worker_identity_verification'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT chk_jobs_worker_identity_verification CHECK (
        worker_identity_verified = false OR (
          worker_identity_verified_at IS NOT NULL AND worker_identity_method IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_worker_identity
  ON jobs(worker_identity_verified, status);

-- 2. Audit and history table for pre-dispatch & pre-work eligibility evaluations
CREATE TABLE IF NOT EXISTS dispatch_eligibility_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  evaluation_stage text NOT NULL CHECK (
    evaluation_stage IN ('PRE_DISPATCH', 'PRE_WORK_COMMENCEMENT')
  ),
  eligible boolean NOT NULL,
  fail_closed_reason text,
  deny_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_by_user_id uuid REFERENCES users(id),
  escalated_to_ops boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_eligibility_request
  ON dispatch_eligibility_checks(service_request_id, evaluation_stage);

CREATE INDEX IF NOT EXISTS idx_dispatch_eligibility_contractor
  ON dispatch_eligibility_checks(contractor_id, technician_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_eligibility_escalated
  ON dispatch_eligibility_checks(escalated_to_ops) WHERE escalated_to_ops = true;
