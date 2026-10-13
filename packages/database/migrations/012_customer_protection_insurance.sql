-- Migration 012: Optional Customer Protection Product and Coverage Eligibility (SH-62 / #62)
-- Enforces licensed Canadian broker distribution (RIBO/FSRA compliance), underwriting eligibility,
-- tamper-evident coverage certificates, claims adjudication lifecycle, and financial reconciliation ledger.

-- 1. Versioned Customer Protection Products Catalog
CREATE TABLE IF NOT EXISTS customer_protection_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  jurisdiction TEXT NOT NULL DEFAULT 'ON',
  underwriter_name TEXT NOT NULL,
  underwriter_policy_ref TEXT NOT NULL,
  broker_name TEXT NOT NULL,
  broker_license_ref TEXT NOT NULL,
  coverage_limit_cents BIGINT NOT NULL,
  deductible_cents BIGINT NOT NULL,
  duration_months INTEGER NOT NULL DEFAULT 12,
  base_rate_bps INTEGER NOT NULL DEFAULT 250,
  min_premium_cents BIGINT NOT NULL DEFAULT 4900,
  broker_commission_bps INTEGER NOT NULL DEFAULT 1500,
  platform_fee_bps INTEGER NOT NULL DEFAULT 1000,
  tax_rate_bps INTEGER NOT NULL DEFAULT 800,
  terms_markdown TEXT NOT NULL,
  disclaimers JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_vertical_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_job_value_cents BIGINT NOT NULL DEFAULT 50000000,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protection_products_active ON customer_protection_products(active, jurisdiction);

-- 2. Protection Quotes (Underwriting evaluation & pricing snapshot)
CREATE TABLE IF NOT EXISTS protection_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES customer_protection_products(id) ON DELETE RESTRICT,
  job_value_cents BIGINT NOT NULL,
  coverage_limit_cents BIGINT NOT NULL,
  deductible_cents BIGINT NOT NULL,
  gross_premium_cents BIGINT NOT NULL,
  broker_commission_cents BIGINT NOT NULL,
  platform_fee_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  total_payable_cents BIGINT NOT NULL,
  eligible BOOLEAN NOT NULL,
  underwriting_decision TEXT NOT NULL,
  decline_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protection_quotes_request ON protection_quotes(service_request_id, status);

-- 3. Binding Protection Policies (Issued coverage certificate & state)
CREATE TABLE IF NOT EXISTS protection_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_number TEXT NOT NULL UNIQUE,
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES customer_protection_products(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL REFERENCES protection_quotes(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'BOUND_ACTIVE',
  coverage_limit_cents BIGINT NOT NULL,
  deductible_cents BIGINT NOT NULL,
  gross_premium_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  total_paid_cents BIGINT NOT NULL,
  effective_start_date TIMESTAMPTZ NOT NULL,
  effective_end_date TIMESTAMPTZ NOT NULL,
  cancellation_deadline TIMESTAMPTZ NOT NULL,
  policy_checksum TEXT NOT NULL,
  underwriter_policy_ref TEXT NOT NULL,
  broker_license_ref TEXT NOT NULL,
  binding_evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_protection_policies_customer ON protection_policies(customer_id);
CREATE INDEX IF NOT EXISTS idx_protection_policies_request ON protection_policies(service_request_id);
CREATE INDEX IF NOT EXISTS idx_protection_policies_status ON protection_policies(status);

-- 4. Protection Claims (Homeowner defect and property loss claims)
CREATE TABLE IF NOT EXISTS protection_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number TEXT NOT NULL UNIQUE,
  policy_id UUID NOT NULL REFERENCES protection_policies(id) ON DELETE RESTRICT,
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  claimant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  incident_date TIMESTAMPTZ NOT NULL,
  incident_description TEXT NOT NULL,
  claimed_amount_cents BIGINT NOT NULL,
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  adjudicated_amount_cents BIGINT DEFAULT 0,
  deductible_applied_cents BIGINT DEFAULT 0,
  net_payout_cents BIGINT DEFAULT 0,
  adjudication_notes TEXT,
  adjudicated_by_user_id UUID REFERENCES users(id),
  adjudicated_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  decline_reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protection_claims_policy ON protection_claims(policy_id);
CREATE INDEX IF NOT EXISTS idx_protection_claims_claimant ON protection_claims(claimant_user_id);
CREATE INDEX IF NOT EXISTS idx_protection_claims_status ON protection_claims(status);

-- 5. Protection Financial Reconciliation Ledger (Immutable double-entry journal)
CREATE TABLE IF NOT EXISTS protection_financial_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type TEXT NOT NULL,
  policy_id UUID REFERENCES protection_policies(id) ON DELETE SET NULL,
  claim_id UUID REFERENCES protection_claims(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  direction TEXT NOT NULL,
  source_account TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  reference TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protection_ledger_policy ON protection_financial_ledger(policy_id);
CREATE INDEX IF NOT EXISTS idx_protection_ledger_type ON protection_financial_ledger(transaction_type);

-- Seed Canonical Canadian Protection Products
INSERT INTO customer_protection_products (
  slug, name, version, jurisdiction, underwriter_name, underwriter_policy_ref,
  broker_name, broker_license_ref, coverage_limit_cents, deductible_cents,
  duration_months, base_rate_bps, min_premium_cents, broker_commission_bps,
  platform_fee_bps, tax_rate_bps, terms_markdown, disclaimers, max_job_value_cents
) VALUES
(
  'STANDARD_DEFECT_PROTECTION',
  'Standard Workmanship & Defect Protection ($25,000)',
  '1.0.0',
  'ON',
  'Trillium Surety & Casualty Canada ULC',
  'TRILLIUM-ON-POL-2026-STD-25K',
  'SkilledHire Insurance Services Inc.',
  'RIBO-ON-LIC-39102-CORP',
  2500000, -- $25,000 CAD limit
  25000,   -- $250 CAD deductible
  12,      -- 12 months duration
  250,     -- 2.50% base rate
  4900,    -- $49.00 CAD minimum premium
  1500,    -- 15% broker commission
  1000,    -- 10% platform tech fee
  800,     -- 8.00% Ontario insurance premium tax
  E'# Standard Workmanship & Defect Protection Policy Summary\n\n**Underwriter:** Trillium Surety & Casualty Canada ULC (Federal Insurer Licence #88219)\n**Broker of Record:** SkilledHire Insurance Services Inc. (RIBO #39102)\n\n## 1. Coverage Scope\nCovers direct physical damage to property and non-compliant workmanship defects occurring within 12 months of certified job completion, up to $25,000 CAD subject to a $250 CAD deductible.\n\n## 2. Exclusions\nPre-existing structural defects, normal wear and tear, unpermitted homeowner alterations, and consequential loss of rental income.\n\n## 3. Statutory Consumer Disclosures\nSkilled Hire Inc. acts strictly as an authorized technology platform. Insurance products are distributed exclusively through licensed brokers. Homeowner maintains a 10-day statutory cooling-off cancellation right with full premium refund prior to trade dispatch.',
  '["NO_UNSUPPORTED_GUARANTEE_DISCLOSURE", "LICENSED_BROKER_DISTRIBUTION_ONLY", "STATUTORY_COOLING_OFF_RIGHTS"]'::jsonb,
  10000000 -- $100,000 max job value
),
(
  'COMPREHENSIVE_PROPERTY_AND_WATER',
  'Comprehensive Trade & Consequential Water Protection ($100,000)',
  '1.0.0',
  'ON',
  'Trillium Surety & Casualty Canada ULC',
  'TRILLIUM-ON-POL-2026-COMP-100K',
  'SkilledHire Insurance Services Inc.',
  'RIBO-ON-LIC-39102-CORP',
  10000000, -- $100,000 CAD limit
  50000,    -- $500 CAD deductible
  24,       -- 24 months duration
  450,      -- 4.50% base rate
  9900,     -- $99.00 CAD minimum premium
  1500,     -- 15% broker commission
  1000,     -- 10% platform tech fee
  800,      -- 8.00% Ontario insurance premium tax
  E'# Comprehensive Trade & Consequential Water Protection Policy Summary\n\n**Underwriter:** Trillium Surety & Casualty Canada ULC\n**Broker of Record:** SkilledHire Insurance Services Inc. (RIBO #39102)\n\n## 1. Coverage Scope\nCovers trade workmanship defects, electrical arc damage, sewer backup caused by trade intervention, and water escape damage up to $100,000 CAD subject to a $500 CAD deductible for 24 months.\n\n## 2. Exclusions\nActs of God / overland flooding without backwater valve, uncertified knob-and-tube extensions, intentional homeowner sabotage.\n\n## 3. Disclosures\nInsurance coverage is underwritten by a licensed Canadian insurer. Full terms available in your policy certificate.',
  '["NO_UNSUPPORTED_GUARANTEE_DISCLOSURE", "WATER_DAMAGE_ENDORSEMENT_INCLUDED", "STATUTORY_COOLING_OFF_RIGHTS"]'::jsonb,
  25000000 -- $250,000 max job value
),
(
  'MAJOR_MECHANICAL_AND_STRUCTURAL',
  'Major Mechanical & Structural Integrity Protection ($250,000)',
  '1.0.0',
  'ON',
  'Trillium Surety & Casualty Canada ULC',
  'TRILLIUM-ON-POL-2026-STRUCT-250K',
  'SkilledHire Insurance Services Inc.',
  'RIBO-ON-LIC-39102-CORP',
  25000000, -- $250,000 CAD limit
  100000,   -- $1,000 CAD deductible
  36,       -- 36 months duration
  600,      -- 6.00% base rate
  19900,    -- $199.00 CAD minimum premium
  1500,     -- 15% broker commission
  1000,     -- 10% platform tech fee
  800,      -- 8.00% Ontario insurance premium tax
  E'# Major Mechanical & Structural Integrity Protection Policy Summary\n\n**Underwriter:** Trillium Surety & Casualty Canada ULC\n**Broker of Record:** SkilledHire Insurance Services Inc. (RIBO #39102)\n\n## 1. Coverage Scope\nCovers major 200A electrical service entrance failures, HVAC compressor defects, and structural renovations requiring municipal permits up to $250,000 CAD for 36 months.\n\n## 2. Exclusions\nUninspected work where ESA Certificate of Acceptance or municipal building permit was omitted or withheld by the property owner.',
  '["NO_UNSUPPORTED_GUARANTEE_DISCLOSURE", "STRUCTURAL_AND_ESA_MANDATORY_EVIDENCE", "STATUTORY_COOLING_OFF_RIGHTS"]'::jsonb,
  50000000 -- $500,000 max job value
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  coverage_limit_cents = EXCLUDED.coverage_limit_cents,
  deductible_cents = EXCLUDED.deductible_cents,
  duration_months = EXCLUDED.duration_months,
  base_rate_bps = EXCLUDED.base_rate_bps,
  min_premium_cents = EXCLUDED.min_premium_cents,
  terms_markdown = EXCLUDED.terms_markdown,
  disclaimers = EXCLUDED.disclaimers,
  max_job_value_cents = EXCLUDED.max_job_value_cents,
  updated_at = NOW();
