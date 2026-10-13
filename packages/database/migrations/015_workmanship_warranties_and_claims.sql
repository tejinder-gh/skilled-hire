-- packages/database/migrations/015_workmanship_warranties_and_claims.sql

-- 1. Workmanship Warranty Policies (Issue #48)
CREATE TABLE IF NOT EXISTS warranty_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL DEFAULT '1.0.0',
  vertical_id UUID REFERENCES verticals(id) ON DELETE SET NULL,
  category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'ON',
  duration_months INTEGER NOT NULL DEFAULT 12,
  response_sla_hours INTEGER NOT NULL DEFAULT 48,
  emergency_sla_hours INTEGER NOT NULL DEFAULT 24,
  covered_defects JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  statutory_terms TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_policy_code ON warranty_policies(policy_code);
CREATE INDEX IF NOT EXISTS idx_wp_vertical ON warranty_policies(vertical_id);

-- 2. Job Warranty Snapshots (Issue #48)
CREATE TABLE IF NOT EXISTS job_warranty_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_number TEXT NOT NULL UNIQUE,
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES warranty_policies(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  warranty_type TEXT NOT NULL DEFAULT 'STANDARD_WORKMANSHIP' CHECK (warranty_type IN ('STANDARD_WORKMANSHIP', 'PREMIUM_EXTENDED', 'STATUTORY_MANDATORY')),
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  duration_months INTEGER NOT NULL,
  covered_defects JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  response_sla_hours INTEGER NOT NULL DEFAULT 48,
  contractor_acknowledged BOOLEAN NOT NULL DEFAULT true,
  contractor_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  homeowner_certificate_url TEXT,
  terms_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLAIM_IN_PROGRESS', 'EXPIRED', 'VOIDED_TAMPERING')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jws_job_id ON job_warranty_snapshots(job_id);
CREATE INDEX IF NOT EXISTS idx_jws_property_id ON job_warranty_snapshots(property_id);
CREATE INDEX IF NOT EXISTS idx_jws_contractor_id ON job_warranty_snapshots(contractor_id);
CREATE INDEX IF NOT EXISTS idx_jws_customer_id ON job_warranty_snapshots(customer_id);
CREATE INDEX IF NOT EXISTS idx_jws_status_expires ON job_warranty_snapshots(status, expires_at);

-- 3. Warranty Claims & Callback Dispatch (Issue #49)
CREATE TABLE IF NOT EXISTS warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number TEXT NOT NULL UNIQUE,
  warranty_id UUID NOT NULL REFERENCES job_warranty_snapshots(id) ON DELETE RESTRICT,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  urgency TEXT NOT NULL DEFAULT 'STANDARD' CHECK (urgency IN ('STANDARD', 'URGENT_NO_HEAT', 'URGENT_WATER_LEAK', 'EMERGENCY_SAFETY_HAZARD')),
  status TEXT NOT NULL DEFAULT 'FILED' CHECK (status IN ('FILED', 'TRIAGED_COVERED', 'TRIAGED_EXCLUDED', 'CONTRACTOR_INSPECTING', 'REMEDIATION_SCHEDULED', 'REMEDIATED', 'ESCALATED_DISPUTE', 'REJECTED', 'CLOSED')),
  triage_notes TEXT,
  sla_deadline TIMESTAMPTZ NOT NULL,
  original_contractor_accepted BOOLEAN,
  contractor_response_notes TEXT,
  contractor_responded_at TIMESTAMPTZ,
  callback_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  remediation_completed_at TIMESTAMPTZ,
  remediation_notes TEXT,
  dispute_reason TEXT,
  disputed_at TIMESTAMPTZ,
  fallback_contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,
  recovery_amount_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wc_warranty_id ON warranty_claims(warranty_id);
CREATE INDEX IF NOT EXISTS idx_wc_contractor_id ON warranty_claims(contractor_id);
CREATE INDEX IF NOT EXISTS idx_wc_customer_id ON warranty_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_wc_status ON warranty_claims(status);

-- 4. Warranty Recovery Ledger (Issue #49)
CREATE TABLE IF NOT EXISTS warranty_recovery_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RECOVERED_FROM_PAYOUT', 'MANUAL_INVOICE_SENT', 'WRITTEN_OFF')),
  reason TEXT NOT NULL,
  recovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wrl_claim_id ON warranty_recovery_ledger(claim_id);
CREATE INDEX IF NOT EXISTS idx_wrl_contractor_id ON warranty_recovery_ledger(contractor_id);
