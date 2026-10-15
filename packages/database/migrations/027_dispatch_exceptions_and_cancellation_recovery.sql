-- Migration 027: Dispatch exceptions, cancellations, SLA tracking, and recovery
-- Establishes policy-driven cancellation, technician decline/no-show tracking, compensation credits, and escalation queues

CREATE TABLE IF NOT EXISTS dispatch_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  contractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  exception_type varchar(64) NOT NULL,
  reason varchar(255) NOT NULL,
  notes text,
  severity varchar(32) NOT NULL DEFAULT 'MEDIUM',
  status varchar(32) NOT NULL DEFAULT 'OPEN',
  sla_deadline_at timestamptz NOT NULL,
  escalated_at timestamptz,
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id),
  resolution_type varchar(64),
  compensation_amount_cents integer NOT NULL DEFAULT 0,
  fee_amount_cents integer NOT NULL DEFAULT 0,
  customer_credit_cents integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_exceptions_request ON dispatch_exceptions(service_request_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_exceptions_job ON dispatch_exceptions(job_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_exceptions_status_sla ON dispatch_exceptions(status, sla_deadline_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_exceptions_contractor ON dispatch_exceptions(contractor_id);

CREATE TABLE IF NOT EXISTS job_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  cancelled_by_role varchar(32) NOT NULL,
  cancelled_by_user_id uuid NOT NULL REFERENCES users(id),
  cancellation_reason varchar(64) NOT NULL,
  cancellation_notes text,
  policy_applied varchar(64) NOT NULL,
  original_amount_paid_cents integer NOT NULL DEFAULT 0,
  cancellation_fee_cents integer NOT NULL DEFAULT 0,
  refund_amount_cents integer NOT NULL DEFAULT 0,
  contractor_payout_cents integer NOT NULL DEFAULT 0,
  customer_credit_cents integer NOT NULL DEFAULT 0,
  contractor_penalty_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_cancellations_job ON job_cancellations(job_id);
CREATE INDEX IF NOT EXISTS idx_job_cancellations_request ON job_cancellations(service_request_id);
CREATE INDEX IF NOT EXISTS idx_job_cancellations_user ON job_cancellations(cancelled_by_user_id);

CREATE TABLE IF NOT EXISTS customer_service_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL,
  balance_cents integer NOT NULL,
  reason varchar(64) NOT NULL,
  reference_type varchar(32),
  reference_id uuid,
  expires_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_credits_customer ON customer_service_credits(customer_id, status);

CREATE TABLE IF NOT EXISTS contractor_dispatch_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  strike_type varchar(64) NOT NULL,
  penalty_amount_cents integer NOT NULL DEFAULT 0,
  strike_points integer NOT NULL DEFAULT 1,
  notes text,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contractor_penalties_contractor ON contractor_dispatch_penalties(contractor_id, status);
