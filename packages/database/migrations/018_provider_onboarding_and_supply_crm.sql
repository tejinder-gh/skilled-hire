-- Migration 018: Provider Multi-Service Onboarding and Supply CRM
-- Implements P0 Multi-service provider onboarding, prospect vs registered state separation,
-- postal territory assignment, service-by-service and geography approvals, and CRM pipeline.

CREATE TABLE IF NOT EXISTS provider_onboarding_applications (
  id VARCHAR(64) PRIMARY KEY,
  prospect_email TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_number TEXT,
  business_type TEXT NOT NULL DEFAULT 'CORPORATION',
  phone TEXT NOT NULL,
  postal_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_verticals JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_rates_proposal JSONB NOT NULL DEFAULT '[]'::jsonb,
  weekly_capacity INTEGER NOT NULL DEFAULT 10,
  technician_count INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'PROSPECT',
  save_token VARCHAR(64) UNIQUE NOT NULL,
  draft_step INTEGER NOT NULL DEFAULT 1,
  draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  consent_accepted_at TIMESTAMPTZ,
  applicant_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  converted_contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_apps_status ON provider_onboarding_applications(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_apps_email ON provider_onboarding_applications(prospect_email);
CREATE INDEX IF NOT EXISTS idx_onboarding_apps_token ON provider_onboarding_applications(save_token);
CREATE INDEX IF NOT EXISTS idx_onboarding_apps_created ON provider_onboarding_applications(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_apps_biz_num ON provider_onboarding_applications(business_number)
  WHERE business_number IS NOT NULL AND status NOT IN ('REJECTED', 'ABANDONED');

CREATE TABLE IF NOT EXISTS provider_service_geography_approvals (
  id VARCHAR(64) PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL REFERENCES provider_onboarding_applications(id) ON DELETE CASCADE,
  contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
  vertical_slug VARCHAR(64) NOT NULL,
  territory_code VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  decision_reason TEXT,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_app_vertical_territory UNIQUE (application_id, vertical_slug, territory_code)
);

CREATE INDEX IF NOT EXISTS idx_provider_approvals_app ON provider_service_geography_approvals(application_id);
CREATE INDEX IF NOT EXISTS idx_provider_approvals_contractor ON provider_service_geography_approvals(contractor_id);
CREATE INDEX IF NOT EXISTS idx_provider_approvals_status ON provider_service_geography_approvals(status);

CREATE TABLE IF NOT EXISTS provider_technician_roster (
  id VARCHAR(64) PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL REFERENCES provider_onboarding_applications(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  trade_license_code TEXT NOT NULL,
  license_number TEXT NOT NULL,
  license_expiry DATE NOT NULL,
  background_check_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  is_emergency_available BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_roster_app ON provider_technician_roster(application_id);
CREATE INDEX IF NOT EXISTS idx_provider_roster_email ON provider_technician_roster(email);
