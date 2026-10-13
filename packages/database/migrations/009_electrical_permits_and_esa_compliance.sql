-- Migration 009: Electrical Permits, ESA Compliance & Acceptance Certificates (#59)

-- 1. Extend jobs table with permit & regulatory sign-off tracking
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS permit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS regulatory_sign_off_status text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (
    regulatory_sign_off_status IN (
      'NOT_APPLICABLE',
      'PENDING',
      'DEFICIENCIES_OUTSTANDING',
      'FULLY_ACCEPTED',
      'EXCEPTION_APPROVED'
    )
  ),
  ADD COLUMN IF NOT EXISTS certificate_of_acceptance_number text,
  ADD COLUMN IF NOT EXISTS regulatory_signed_off_at timestamptz;

-- 2. Electrical Permits Table (Ontario ECRA/ESA, Municipal, TSSA)
CREATE TABLE IF NOT EXISTS electrical_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_number text NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  jurisdiction text NOT NULL DEFAULT 'ON',
  permit_authority text NOT NULL DEFAULT 'ESA',
  permit_type text NOT NULL DEFAULT 'ESA_LEC_NOTIFICATION',
  esa_notification_number text NOT NULL,
  ecra_license_number text NOT NULL,
  designated_master_electrician text NOT NULL,
  scope_of_work text NOT NULL,
  status text NOT NULL DEFAULT 'FILED' CHECK (
    status IN (
      'FILED',
      'DISCONNECT_SCHEDULED',
      'DISCONNECTED',
      'WORK_COMPLETED',
      'INSPECTION_REQUESTED',
      'DEFICIENCIES_RECORDED',
      'CERTIFICATE_ISSUED',
      'EXCEPTION_APPROVED',
      'CLOSED'
    )
  ),
  utility_disconnect_required boolean NOT NULL DEFAULT false,
  utility_provider text,
  utility_meter_number text,
  utility_disconnect_date timestamptz,
  utility_reconnect_authorization_code text,
  utility_reconnect_date timestamptz,
  inspection_status text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (
    inspection_status IN (
      'NOT_REQUESTED',
      'REQUESTED',
      'SCHEDULED',
      'DEFICIENCIES_ISSUED',
      'PASSED',
      'WAIVED_EXCEPTION'
    )
  ),
  inspector_name text,
  inspector_badge_number text,
  inspected_at timestamptz,
  certificate_of_acceptance_number text,
  certificate_of_acceptance_url text,
  certificate_of_acceptance_issued_at timestamptz,
  documented_exception_reason text,
  documented_exception_approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  documented_exception_at timestamptz,
  regulatory_sign_off_status text NOT NULL DEFAULT 'PENDING' CHECK (
    regulatory_sign_off_status IN (
      'PENDING',
      'DEFICIENCIES_OUTSTANDING',
      'FULLY_ACCEPTED',
      'EXCEPTION_APPROVED'
    )
  ),
  provenance_audit jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_electrical_permits_job_id ON electrical_permits(job_id);
CREATE INDEX IF NOT EXISTS idx_electrical_permits_property_id ON electrical_permits(property_id);
CREATE INDEX IF NOT EXISTS idx_electrical_permits_contractor_id ON electrical_permits(contractor_id);
CREATE INDEX IF NOT EXISTS idx_electrical_permits_notif_no ON electrical_permits(esa_notification_number);
CREATE INDEX IF NOT EXISTS idx_electrical_permits_coa_no ON electrical_permits(certificate_of_acceptance_number);
CREATE INDEX IF NOT EXISTS idx_electrical_permits_signoff_status ON electrical_permits(regulatory_sign_off_status);

-- 3. Permit Deficiencies & Defects Table (ESA Inspection Notices)
CREATE TABLE IF NOT EXISTS permit_deficiencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id uuid NOT NULL REFERENCES electrical_permits(id) ON DELETE CASCADE,
  defect_code text NOT NULL,
  severity text NOT NULL DEFAULT 'MAJOR' CHECK (
    severity IN ('CRITICAL', 'MAJOR', 'MINOR')
  ),
  description text NOT NULL,
  corrective_action_required text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN', 'RECTIFIED', 'CLEARED_BY_INSPECTOR')
  ),
  issued_at timestamptz NOT NULL DEFAULT now(),
  rectified_at timestamptz,
  rectified_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  rectification_notes text,
  rectification_evidence_url text,
  cleared_at timestamptz,
  cleared_by_inspector text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permit_deficiencies_permit_id ON permit_deficiencies(permit_id);
CREATE INDEX IF NOT EXISTS idx_permit_deficiencies_status ON permit_deficiencies(status);

-- 4. Extend service_records to link to electrical permits & Certificate of Acceptance
ALTER TABLE service_records
  ADD COLUMN IF NOT EXISTS permit_id uuid REFERENCES electrical_permits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS certificate_of_acceptance_number text,
  ADD COLUMN IF NOT EXISTS regulatory_sign_off_status text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (
    regulatory_sign_off_status IN (
      'NOT_APPLICABLE',
      'PENDING',
      'DEFICIENCIES_OUTSTANDING',
      'FULLY_ACCEPTED',
      'EXCEPTION_APPROVED'
    )
  );

CREATE INDEX IF NOT EXISTS idx_service_records_permit_id ON service_records(permit_id);
