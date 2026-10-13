-- packages/database/migrations/014_job_completion_reports_and_property_passport.sql

-- 1. Job Completion Reports (Issue #50)
CREATE TABLE IF NOT EXISTS job_completion_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  report_number TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'DISPUTED', 'SUPERSEDED')),
  sync_status TEXT NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('OFFLINE_DRAFT', 'SYNCED', 'SYNC_CONFLICT')),
  client_mutation_id TEXT,
  work_summary TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  work_started_at TIMESTAMPTZ NOT NULL,
  work_completed_at TIMESTAMPTZ NOT NULL,
  asset_id UUID REFERENCES property_systems(id) ON DELETE SET NULL,
  parts_installed JSONB NOT NULL DEFAULT '[]'::jsonb,
  tests_performed JSONB NOT NULL DEFAULT '[]'::jsonb,
  before_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  after_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  permit_id UUID REFERENCES electrical_permits(id) ON DELETE SET NULL,
  outstanding_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  maintenance_recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  contractor_attestation JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_acceptance JSONB NOT NULL DEFAULT '{}'::jsonb,
  dispute_reason TEXT,
  disputed_at TIMESTAMPTZ,
  disputed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jcr_job_id ON job_completion_reports(job_id);
CREATE INDEX IF NOT EXISTS idx_jcr_property_id ON job_completion_reports(property_id);
CREATE INDEX IF NOT EXISTS idx_jcr_contractor_id ON job_completion_reports(contractor_id);
CREATE INDEX IF NOT EXISTS idx_jcr_status ON job_completion_reports(status);

-- 2. Enhanced Property Systems Columns (Issue #51)
ALTER TABLE property_systems
  ADD COLUMN IF NOT EXISTS asset_type TEXT DEFAULT 'GENERAL_EQUIPMENT',
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS model_number TEXT,
  ADD COLUMN IF NOT EXISTS serial_number TEXT,
  ADD COLUMN IF NOT EXISTS warranty_status TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS last_service_record_id UUID REFERENCES service_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_serviced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS installed_by_contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_property_systems_serial_number ON property_systems(serial_number);

-- 3. Property Access Grants for Secondary Contractors (Issue #51)
CREATE TABLE IF NOT EXISTS property_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  grantee_contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  granted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL DEFAULT 'FULL_HISTORY' CHECK (scope IN ('FULL_HISTORY', 'SERVICE_SPECIFIC', 'REDACTED_COMMERCIAL')),
  service_vertical_id UUID REFERENCES verticals(id) ON DELETE SET NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pag_property_grantee ON property_access_grants(property_id, grantee_contractor_id);
CREATE INDEX IF NOT EXISTS idx_pag_status_expires ON property_access_grants(status, expires_at);

-- 4. Property Ownership Transfers (Issue #51)
CREATE TABLE IF NOT EXISTS property_ownership_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  previous_owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  new_owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED_ACCEPTED', 'CANCELLED', 'REJECTED')),
  verification_token TEXT NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ,
  transfer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pot_property ON property_ownership_transfers(property_id);
CREATE INDEX IF NOT EXISTS idx_pot_token ON property_ownership_transfers(verification_token);
