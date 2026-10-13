-- Migration: 013_risk_job_documentation_inspections.sql
-- Description: Risk-based job documentation packages, tiered evidence gates, QA sampling, and incident escalation (#63)

-- 1. Job Documentation Packages
CREATE TABLE IF NOT EXISTS job_documentation_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  risk_tier TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'VERIFIED_COMPLIANT', 'DEFICIENT', 'OPS_APPROVED_EXCEPTION')),
  before_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  in_progress_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  after_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  worker_identity_confirmed BOOLEAN NOT NULL DEFAULT false,
  worker_identity_notes TEXT,
  risk_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_signoff JSONB NOT NULL DEFAULT '{}'::jsonb,
  permit_id UUID REFERENCES electrical_permits(id) ON DELETE SET NULL,
  permit_verified BOOLEAN NOT NULL DEFAULT false,
  qa_audit_id UUID REFERENCES quality_audits(id) ON DELETE SET NULL,
  qa_audit_required BOOLEAN NOT NULL DEFAULT false,
  qa_audit_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (qa_audit_status IN ('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED_DEFICIENCIES')),
  incident_escalation_id UUID REFERENCES safety_incidents(id) ON DELETE SET NULL,
  incident_escalated BOOLEAN NOT NULL DEFAULT false,
  deficiencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  exception_audit_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  property_passport_linked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for performance and querying
CREATE INDEX IF NOT EXISTS idx_job_doc_packages_job_id ON job_documentation_packages(job_id);
CREATE INDEX IF NOT EXISTS idx_job_doc_packages_contractor_id ON job_documentation_packages(contractor_id);
CREATE INDEX IF NOT EXISTS idx_job_doc_packages_property_id ON job_documentation_packages(property_id);
CREATE INDEX IF NOT EXISTS idx_job_doc_packages_risk_tier ON job_documentation_packages(risk_tier);
CREATE INDEX IF NOT EXISTS idx_job_doc_packages_status ON job_documentation_packages(status);
CREATE INDEX IF NOT EXISTS idx_job_doc_packages_qa_audit_status ON job_documentation_packages(qa_audit_status);

-- 3. Extend service_records to track linked risk documentation & safety sign-off
ALTER TABLE service_records 
  ADD COLUMN IF NOT EXISTS documentation_package_id UUID REFERENCES job_documentation_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS risk_tier TEXT DEFAULT 'LOW',
  ADD COLUMN IF NOT EXISTS qa_audit_status TEXT DEFAULT 'NOT_SAMPLED',
  ADD COLUMN IF NOT EXISTS safety_sign_off_status TEXT DEFAULT 'NOT_REQUIRED';
