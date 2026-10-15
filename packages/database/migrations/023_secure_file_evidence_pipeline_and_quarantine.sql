-- Migration 023: Secure Customer and Contractor File Evidence Pipeline & Quarantine (SH-04)

-- 1. Create Enums
DO $$ BEGIN
  CREATE TYPE file_scan_status AS ENUM (
    'PENDING_SCAN',
    'CLEAN',
    'QUARANTINED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE file_attachment_status AS ENUM (
    'INITIATED',
    'UPLOADED',
    'ACTIVE',
    'DELETED',
    'QUARANTINED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE file_visibility AS ENUM (
    'PRIVATE',
    'CUSTOMER_VISIBLE',
    'CONTRACTOR_VISIBLE',
    'SHARED',
    'INTERNAL_ONLY'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. File Attachments Table
CREATE TABLE IF NOT EXISTS file_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key VARCHAR(255) NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  service_request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
  file_category VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  byte_size BIGINT NOT NULL DEFAULT 0,
  sha256_checksum VARCHAR(64),
  scan_status file_scan_status NOT NULL DEFAULT 'PENDING_SCAN',
  quarantine_reason TEXT,
  visibility file_visibility NOT NULL DEFAULT 'SHARED',
  status file_attachment_status NOT NULL DEFAULT 'INITIATED',
  uploaded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. File Quarantine Events Table (Audit Log)
CREATE TABLE IF NOT EXISTS file_quarantine_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES file_attachments(id) ON DELETE CASCADE,
  trigger_reason TEXT NOT NULL,
  detected_signatures JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_file_attachments_owner ON file_attachments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_storage_key ON file_attachments(storage_key);
CREATE INDEX IF NOT EXISTS idx_file_attachments_job_id ON file_attachments(job_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_service_request_id ON file_attachments(service_request_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_contractor_id ON file_attachments(contractor_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_customer_id ON file_attachments(customer_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_scan_status ON file_attachments(scan_status);
CREATE INDEX IF NOT EXISTS idx_file_quarantine_events_file_id ON file_quarantine_events(file_id);
