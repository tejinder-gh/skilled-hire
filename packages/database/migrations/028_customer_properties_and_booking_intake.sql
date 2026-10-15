-- packages/database/migrations/028_customer_properties_and_booking_intake.sql
-- Up migration for SH-11: Customer accounts, properties, equipment passport & booking UX

-- 1. Extend properties table with property classification, access instructions, and primary designation
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'DETACHED',
  ADD COLUMN IF NOT EXISTS unit_number text,
  ADD COLUMN IF NOT EXISTS access_notes text,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Index for customer property queries
CREATE INDEX IF NOT EXISTS idx_properties_customer_primary
  ON properties (customer_id, is_primary)
  WHERE deleted_at IS NULL;

-- 2. Customer booking drafts (persisted across sessions and devices)
CREATE TABLE IF NOT EXISTS booking_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step integer NOT NULL DEFAULT 0,
  draft_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_booking_drafts_customer_id UNIQUE (customer_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_drafts_customer
  ON booking_drafts (customer_id);
