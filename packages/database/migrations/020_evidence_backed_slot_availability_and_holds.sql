-- packages/database/migrations/020_evidence_backed_slot_availability_and_holds.sql
-- SH-02: Evidence-backed booking availability, atomic slot holds, and SLA claims

-- 1. Make service_request_id nullable in dispatch_slot_holds so customers can lease a slot during intake
ALTER TABLE dispatch_slot_holds ALTER COLUMN service_request_id DROP NOT NULL;

-- 2. Add hold_token for pre-booking identification
ALTER TABLE dispatch_slot_holds ADD COLUMN IF NOT EXISTS hold_token VARCHAR(64) UNIQUE;

-- 3. Add postal_fsa and vertical_id to dispatch_slot_holds
ALTER TABLE dispatch_slot_holds ADD COLUMN IF NOT EXISTS postal_fsa VARCHAR(8);
ALTER TABLE dispatch_slot_holds ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE;

-- 4. Index for fast hold lookup by token and postal_fsa
CREATE INDEX IF NOT EXISTS idx_slot_holds_token ON dispatch_slot_holds(hold_token);
CREATE INDEX IF NOT EXISTS idx_slot_holds_fsa ON dispatch_slot_holds(postal_fsa);
