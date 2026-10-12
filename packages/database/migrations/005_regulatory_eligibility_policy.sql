-- Migration 005: Trade-Specific Regulatory Eligibility Policy & Verification

-- 1. Extend credentials with authoritative regulator verification tracking
ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS verification_source text NOT NULL DEFAULT 'SELF_UPLOAD' CHECK (verification_source IN ('MANUAL_AUDIT', 'REGULATOR_API', 'SELF_UPLOAD')),
  ADD COLUMN IF NOT EXISTS verified_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS regulator_reference text,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS limitations text,
  ADD COLUMN IF NOT EXISTS auditor_notes text;

ALTER TABLE credentials
  ALTER COLUMN verification_source SET DEFAULT 'SELF_UPLOAD';

-- Demote any unverified legacy credentials to PENDING if they lack verified provenance or checked_at
UPDATE credentials
SET status = 'PENDING'
WHERE status = 'VERIFIED' AND (verification_source = 'SELF_UPLOAD' OR checked_at IS NULL);

-- Fail-closed rule: Self-uploaded or unchecked documents cannot hold VERIFIED status directly
ALTER TABLE credentials
  DROP CONSTRAINT IF EXISTS credentials_fail_closed_verification;

ALTER TABLE credentials
  ADD CONSTRAINT credentials_fail_closed_verification
  CHECK (status != 'VERIFIED' OR (verification_source IN ('MANUAL_AUDIT', 'REGULATOR_API') AND checked_at IS NOT NULL));

-- 2. Versioned Trade Regulatory Policies Matrix
CREATE TABLE IF NOT EXISTS trade_regulatory_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_slug text NOT NULL,
  category_slug text NOT NULL DEFAULT '*',
  variant_slug text NOT NULL DEFAULT '*',
  geography text NOT NULL DEFAULT 'ON',
  policy_version integer NOT NULL DEFAULT 1,
  contractor_mandatory_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  technician_mandatory_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  apprentice_eligible boolean NOT NULL DEFAULT false,
  supervisor_ratio text DEFAULT '1:1',
  permit_required boolean NOT NULL DEFAULT false,
  inspection_authority text,
  legal_authority_disclaimer text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vertical_slug, category_slug, variant_slug, geography, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_trade_regulatory_policies_lookup
  ON trade_regulatory_policies(vertical_slug, geography, active);

CREATE INDEX IF NOT EXISTS idx_trade_regulatory_policies_hierarchy
  ON trade_regulatory_policies(vertical_slug, category_slug, variant_slug, geography, active);

-- 3. Seed canonical baseline and variant-specific policies for Ontario
INSERT INTO trade_regulatory_policies (
  vertical_slug, category_slug, variant_slug, geography, policy_version,
  contractor_mandatory_codes, technician_mandatory_codes, apprentice_eligible,
  supervisor_ratio, permit_required, inspection_authority, legal_authority_disclaimer
) VALUES
(
  'electrical', '*', '*', 'ON', 1,
  '["ON_ESA_LEC_CONTRACTOR", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"]'::jsonb,
  '["ON_SKILLED_TRADES_309A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  true, '1:1', true, 'Electrical Safety Authority (ESA / ECRA)',
  'Electricity Act, 1998, O.Reg 570/05 requires all electrical work to be performed by an ECRA/ESA Licensed Electrical Contractor employing qualified 309A certified electricians or registered apprentices.'
),
(
  'electrical', 'panel-service', 'panel-upgrade-200a', 'ON', 1,
  '["ON_ESA_LEC_CONTRACTOR", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"]'::jsonb,
  '["ON_SKILLED_TRADES_309A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  false, '1:1', true, 'Electrical Safety Authority (ESA / ECRA)',
  'Ontario Electrical Safety Code Rule 2-004 & O.Reg 570/05 require ESA notification and connection authorization for 200A service panel changes. Master or 309A journeyperson required.'
),
(
  'plumbing', '*', '*', 'ON', 1,
  '["ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"]'::jsonb,
  '["ON_SKILLED_TRADES_306A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  true, '1:1', false, 'Municipal Building / Plumbing Inspection',
  'Ontario Building Code Part 7 and Building Opportunities in the Skilled Trades Act (BOSTA) require certified 306A plumbers for water supply and drainage systems.'
),
(
  'plumbing', 'drain-sewer', 'main-drain-clog', 'ON', 1,
  '["ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"]'::jsonb,
  '["GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  true, '1:1', false, 'Municipal Building / Plumbing Authority',
  'Mechanical drain augering and camera inspections do not modify fixed potable piping.'
),
(
  'hvac', '*', '*', 'ON', 1,
  '["ON_TSSA_CONTRACTOR_REG", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"]'::jsonb,
  '["ON_TSSA_GAS_G2", "ON_SKILLED_TRADES_313A", "CA_ODS_REFRIGERANT", "ON_MOL_HEIGHTS", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  false, '1:1', false, 'Technical Standards and Safety Authority (TSSA)',
  'Technical Standards and Safety Act, O.Reg 215/01 mandates TSSA contractor registration and individual G2/G1 Gas Technician plus 313A certification for fuel and refrigerant equipment.'
),
(
  'hvac', 'heating', 'furnace-no-heat', 'ON', 1,
  '["ON_TSSA_CONTRACTOR_REG", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"]'::jsonb,
  '["ON_TSSA_GAS_G2", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  false, '1:1', false, 'Technical Standards and Safety Authority (TSSA)',
  'TSSA Act Fuel Safety Division & Ontario Reg 215/01 require heating fuels contractor registration and individual TSSA G2/G1 gas certificate.'
),
(
  'hvac', 'air-quality', 'hrv-erv-service', 'ON', 1,
  '["ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M"]'::jsonb,
  '["GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  true, '1:1', false, 'Ontario Ministry of Labour',
  'General ventilation and indoor air filter maintenance does not involve fuel or sealed refrigerant circuits.'
),
(
  'roofing', '*', '*', 'ON', 1,
  '["CGL_INSURANCE_2M", "ON_WSIB_CLEARANCE", "ROOFING_OPEN_FLAME_INSURANCE"]'::jsonb,
  '["ON_MOL_HEIGHTS", "ROOFING_FALL_PROTECTION", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"]'::jsonb,
  true, '1:2', false, 'Ministry of Labour CPO Working at Heights',
  'Occupational Health and Safety Act, O.Reg 297/13 mandates CPO-approved working at heights training for all roofing and elevated operations.'
)
ON CONFLICT (vertical_slug, category_slug, variant_slug, geography, policy_version) DO UPDATE SET
  contractor_mandatory_codes = EXCLUDED.contractor_mandatory_codes,
  technician_mandatory_codes = EXCLUDED.technician_mandatory_codes,
  apprentice_eligible = EXCLUDED.apprentice_eligible,
  supervisor_ratio = EXCLUDED.supervisor_ratio,
  permit_required = EXCLUDED.permit_required,
  legal_authority_disclaimer = EXCLUDED.legal_authority_disclaimer,
  inspection_authority = EXCLUDED.inspection_authority;
