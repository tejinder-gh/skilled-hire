-- packages/database/migrations/019_technician_scheduling_and_dispatch_conflict.sql
-- SH-06: Real technician scheduling, dispatch conflict control, atomic slot holds, and fallback queue

-- 1. Technician Recurring Weekly Schedules
CREATE TABLE IF NOT EXISTS technician_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time VARCHAR(5) NOT NULL, -- e.g. "08:00"
  end_time VARCHAR(5) NOT NULL,   -- e.g. "17:00"
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Toronto',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tech_schedule UNIQUE (technician_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_tech_schedules_tech_day ON technician_schedules(technician_id, day_of_week);

-- 2. Technician Schedule Exceptions & Time-Off
CREATE TABLE IF NOT EXISTS technician_schedule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  exception_type VARCHAR(32) NOT NULL DEFAULT 'TIME_OFF',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time VARCHAR(5),
  end_time VARCHAR(5),
  all_day BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  approved_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tech_exceptions_tech_dates ON technician_schedule_exceptions(technician_id, start_date, end_date);

-- 3. Technician Service Regions & Travel Buffer Settings
CREATE TABLE IF NOT EXISTS technician_service_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  postal_fsa VARCHAR(8) NOT NULL,
  max_travel_radius_km INT NOT NULL DEFAULT 25,
  travel_buffer_minutes INT NOT NULL DEFAULT 30,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tech_region UNIQUE (technician_id, postal_fsa)
);

CREATE INDEX IF NOT EXISTS idx_tech_regions_fsa ON technician_service_regions(postal_fsa);

-- 4. Dispatch Slot Holds with Atomic Overlap Protection
CREATE TABLE IF NOT EXISTS dispatch_slot_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  slot_starts_at TIMESTAMPTZ NOT NULL,
  slot_ends_at TIMESTAMPTZ NOT NULL,
  travel_buffer_minutes INT NOT NULL DEFAULT 30,
  buffered_starts_at TIMESTAMPTZ NOT NULL,
  buffered_ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'HELD', -- 'HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED'
  hold_expires_at TIMESTAMPTZ NOT NULL,
  held_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slot_holds_tech_active ON dispatch_slot_holds(technician_id, status, buffered_starts_at, buffered_ends_at);
CREATE INDEX IF NOT EXISTS idx_slot_holds_req ON dispatch_slot_holds(service_request_id);

-- 5. Dispatch Offers
CREATE TABLE IF NOT EXISTS dispatch_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  slot_hold_id UUID REFERENCES dispatch_slot_holds(id) ON DELETE SET NULL,
  candidate_rank INT NOT NULL DEFAULT 1,
  candidate_score INT NOT NULL DEFAULT 100,
  status VARCHAR(32) NOT NULL DEFAULT 'OFFERED', -- 'OFFERED', 'ACCEPTED', 'DECLINED', 'TIMED_OUT', 'RESCINDED'
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  decline_reason VARCHAR(64),
  decline_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_offers_req_status ON dispatch_offers(service_request_id, status);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_tech ON dispatch_offers(technician_id, status);

-- 6. Dispatch Operations Fallback Queue
CREATE TABLE IF NOT EXISTS dispatch_fallback_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
  failed_offer_count INT NOT NULL DEFAULT 0,
  reason VARCHAR(64) NOT NULL DEFAULT 'ALL_OFFERS_EXHAUSTED', -- 'ALL_OFFERS_EXHAUSTED', 'TIMED_OUT', 'DECLINED_BY_ALL', 'NO_ELIGIBLE_CANDIDATES', 'MANUAL_ESCALATION'
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_TRIAGE', -- 'PENDING_TRIAGE', 'MANUALLY_ASSIGNED', 'RE_DISPATCHED', 'CANCELLED'
  assigned_technician_id UUID REFERENCES technicians(id),
  triaged_by_user_id UUID REFERENCES users(id),
  triaged_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_fallback_status ON dispatch_fallback_queue(status);

-- 7. Extend Jobs with explicit schedule times and buffer
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_starts_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_ends_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS travel_buffer_minutes INT DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_jobs_tech_scheduled ON jobs(technician_id, scheduled_starts_at, scheduled_ends_at)
  WHERE status NOT IN ('CANCELLED', 'COMPLETED', 'CLOSED');
