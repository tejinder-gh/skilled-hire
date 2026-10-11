-- Migration 004: Hierarchical Home-Service Catalog & Trade Configuration

-- 1. Verticals (Top-Level Trade Families & Services)
ALTER TABLE verticals
  ADD COLUMN IF NOT EXISTS family text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'MODERATE' CHECK (risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  ADD COLUMN IF NOT EXISTS permit_authority text,
  ADD COLUMN IF NOT EXISTS launch_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100;

-- 2. Service Categories (Sub-disciplines / Service Lines)
ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'MODERATE' CHECK (risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  ADD COLUMN IF NOT EXISTS launch_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100;

-- 3. Issue Types (Service Variants / Job Scopes)
ALTER TABLE issue_types
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS scope_summary text,
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'MODERATE' CHECK (risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  ADD COLUMN IF NOT EXISTS pricing_type text NOT NULL DEFAULT 'HOURLY' CHECK (pricing_type IN ('HOURLY', 'FIXED', 'ESTIMATE_REQUIRED')),
  ADD COLUMN IF NOT EXISTS base_price_cents bigint NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS default_duration_minutes integer NOT NULL DEFAULT 120 CHECK (default_duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS requires_permit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permit_type text,
  ADD COLUMN IF NOT EXISTS required_evidence jsonb NOT NULL DEFAULT '["before_photo", "after_photo"]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_warranty_months integer NOT NULL DEFAULT 12 CHECK (default_warranty_months >= 0),
  ADD COLUMN IF NOT EXISTS geographic_restrictions jsonb NOT NULL DEFAULT '["ON"]'::jsonb,
  ADD COLUMN IF NOT EXISTS launch_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Indexes for efficient catalog browsing and search
CREATE INDEX IF NOT EXISTS idx_verticals_family ON verticals(family, active);
CREATE INDEX IF NOT EXISTS idx_verticals_launch ON verticals(launch_ready, active);
CREATE INDEX IF NOT EXISTS idx_service_categories_launch ON service_categories(launch_ready, active);
CREATE INDEX IF NOT EXISTS idx_issue_types_launch ON issue_types(launch_ready, active);
CREATE INDEX IF NOT EXISTS idx_issue_types_pricing ON issue_types(pricing_type, active);
