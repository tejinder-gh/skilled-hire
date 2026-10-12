-- Migration 008: Safety Incident Response, Suspension, Quality Audits and Remediation (#58)

-- 1. Extend contractors and technicians with safety status & suspension metadata
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS safety_status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    safety_status IN ('ACTIVE', 'PROBATION', 'RESTRICTED', 'SUSPENDED')
  ),
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

ALTER TABLE technicians
  ADD COLUMN IF NOT EXISTS safety_status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    safety_status IN ('ACTIVE', 'PROBATION', 'SUSPENDED')
  ),
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

-- 2. Safety Incidents Table
CREATE TABLE IF NOT EXISTS safety_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number text NOT NULL UNIQUE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  service_request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  reported_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reporter_role text NOT NULL CHECK (
    reporter_role IN ('CUSTOMER', 'CONTRACTOR', 'TECHNICIAN', 'DISPATCHER', 'INSPECTOR', 'INSURER', 'ADMIN')
  ),
  severity text NOT NULL DEFAULT 'MODERATE_DEFECT' CHECK (
    severity IN ('CRITICAL_EMERGENCY', 'MAJOR_SAFETY', 'MODERATE_DEFECT', 'MINOR_HAZARD')
  ),
  status text NOT NULL DEFAULT 'REPORTED' CHECK (
    status IN ('REPORTED', 'TRIAGED', 'INVESTIGATING', 'QUARANTINED', 'REMEDIATING', 'RESOLVED', 'APPEALED', 'CLOSED')
  ),
  incident_type text NOT NULL CHECK (
    incident_type IN (
      'ELECTRICAL_HAZARD_SHOCK',
      'GAS_LEAK_FIRE_RISK',
      'STRUCTURAL_COLLAPSE_RISK',
      'WATER_DAMAGE_FLOODING',
      'CARBON_MONOXIDE',
      'PROPERTY_DAMAGE_MAJOR',
      'REGULATORY_CODE_VIOLATION',
      'UNAUTHORIZED_UNQUALIFIED_WORK'
    )
  ),
  title text NOT NULL,
  description text NOT NULL,
  occurred_at timestamptz NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  containment_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_locker jsonb NOT NULL DEFAULT '[]'::jsonb,
  insurer_notified boolean NOT NULL DEFAULT false,
  insurer_notified_at timestamptz,
  insurer_claim_reference text,
  legal_retention_hold boolean NOT NULL DEFAULT false,
  quarantine_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  triage_notes text,
  triaged_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  triaged_at timestamptz,
  independent_review_notes text,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_summary text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_incidents_contractor ON safety_incidents(contractor_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_technician ON safety_incidents(technician_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_job ON safety_incidents(job_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_severity_status ON safety_incidents(severity, status);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_property ON safety_incidents(property_id);

-- 3. Auditable Safety Incident Actions (Immutable audit trail)
CREATE TABLE IF NOT EXISTS safety_incident_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES safety_incidents(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (
    action_type IN (
      'TRIAGE',
      'EMERGENCY_ESCALATION',
      'EVIDENCE_PRESERVED',
      'CONTRACTOR_SUSPENDED',
      'TECHNICIAN_SUSPENDED',
      'SCOPE_RESTRICTED',
      'INSURER_NOTIFIED',
      'INDEPENDENT_REVIEW_ASSIGNED',
      'SPOT_INSPECTION_ORDERED',
      'CORRECTIVE_ACTION_REQUIRED',
      'REMEDIATION_SUBMITTED',
      'REMEDIATION_ACCEPTED',
      'QUARANTINE_LIFTED',
      'APPEAL_FILED',
      'APPEAL_DECIDED',
      'CLOSED'
    )
  ),
  previous_status text,
  new_status text,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_incident_actions_incident ON safety_incident_actions(incident_id, created_at ASC);

-- 4. Contractor Safety Quarantines & Scope Restrictions
CREATE TABLE IF NOT EXISTS contractor_safety_quarantines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES safety_incidents(id) ON DELETE RESTRICT,
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  quarantine_type text NOT NULL CHECK (
    quarantine_type IN ('FULL_CONTRACTOR_SUSPENSION', 'TECHNICIAN_SUSPENSION', 'VERTICAL_SCOPE_RESTRICTION', 'PROVISIONAL_AUDIT_SUPERVISION')
  ),
  restricted_vertical_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  restricted_issue_type_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  issued_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz,
  lifted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  lifting_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contractor_quarantines_active ON contractor_safety_quarantines(contractor_id, active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_contractor_quarantines_tech ON contractor_safety_quarantines(technician_id, active) WHERE active = true;

-- 5. Quality Audits and Spot Inspections Table
CREATE TABLE IF NOT EXISTS quality_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_number text NOT NULL UNIQUE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  incident_id uuid REFERENCES safety_incidents(id) ON DELETE SET NULL,
  trigger_type text NOT NULL CHECK (
    trigger_type IN ('INCIDENT_REMEDIATION', 'REPEAT_DEFECT_FLAG', 'RANDOM_SPOT_CHECK', 'HIGH_RISK_TRADE', 'CUSTOMER_DISPUTE')
  ),
  inspector_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (
    status IN ('SCHEDULED', 'IN_PROGRESS', 'PASSED', 'DEFECTS_IDENTIFIED', 'FAILED_CRITICAL')
  ),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  repeat_defect_count integer NOT NULL DEFAULT 0,
  remediation_required boolean NOT NULL DEFAULT false,
  remediation_deadline timestamptz,
  remediation_completed_at timestamptz,
  report_notes text,
  conducted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_audits_contractor ON quality_audits(contractor_id, status);
CREATE INDEX IF NOT EXISTS idx_quality_audits_job ON quality_audits(job_id);
