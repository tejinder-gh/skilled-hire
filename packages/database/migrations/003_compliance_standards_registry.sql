CREATE TABLE credential_groups (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  display_order integer NOT NULL,
  icon text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_standards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code text NOT NULL REFERENCES credential_groups(code),
  credential_code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  vertical_slug text NOT NULL DEFAULT '*',
  geography text NOT NULL DEFAULT '*',
  entity_level text NOT NULL CHECK(entity_level IN ('CONTRACTOR', 'TECHNICIAN', 'EITHER')),
  requirement_level text NOT NULL CHECK(requirement_level IN ('MANDATORY', 'RECOMMENDED')),
  issuing_authority text NOT NULL,
  legal_reference text,
  verification_method text NOT NULL CHECK(verification_method IN ('DOCUMENT_UPLOAD', 'REGISTRY_API', 'MANUAL_AUDIT')),
  validity_period_months integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vertical_slug, geography, credential_code, entity_level)
);

CREATE INDEX compliance_standards_lookup_idx ON compliance_standards(vertical_slug, geography, active);

CREATE TABLE compliance_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid REFERENCES contractors(id),
  technician_id uuid REFERENCES technicians(id),
  applicant_email text,
  vertical_slug text NOT NULL,
  geography text NOT NULL,
  overall_status text NOT NULL CHECK(overall_status IN ('VERIFIED', 'DEFICIENT', 'EXPIRED', 'PENDING_REVIEW')),
  score_bps integer NOT NULL CHECK(score_bps BETWEEN 0 AND 10000),
  summary jsonb NOT NULL DEFAULT '{}',
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX compliance_evaluations_contractor_idx ON compliance_evaluations(contractor_id, evaluated_at DESC);

-- Seed Regulatory Groups
INSERT INTO credential_groups (code, name, description, display_order, icon) VALUES
('TRADE_LICENSING', 'Trade & Professional Licensing', 'Mandatory occupational trade certificates, master licenses, and contractor board registrations required by statutory law.', 1, 'badge-check'),
('ENVIRONMENTAL_HAZARDOUS', 'Environmental & Hazardous Materials', 'Federal and state/provincial environmental protection compliance including EPA refrigerants, ODS, and hazardous material management.', 2, 'leaf'),
('INSURANCE_FINANCIAL', 'Insurance, Bonding & Financial Security', 'Commercial general liability, statutory workers compensation boards, commercial vehicle insurance, and surety performance bonds.', 3, 'shield-check'),
('HEALTH_SAFETY', 'Occupational Health & Site Safety', 'Mandatory worker and site safety certifications including fall protection/working at heights, OSHA, and first aid.', 4, 'hard-hat'),
('STATUTORY_REGISTRATION', 'Statutory Business & Municipal Registration', 'Corporate registration, municipal licensing, and regulatory safety authority contractor licensing in good standing.', 5, 'building'),
('TRUST_IDENTITY', 'Trust, Safety & Identity Verification', 'Identity validation, criminal background checks with vulnerable sector screening, and motor vehicle driving records.', 6, 'user-check')
ON CONFLICT (code) DO NOTHING;

-- Seed Standard Catalog Across Verticals & Jurisdictions
INSERT INTO compliance_standards (group_code, credential_code, name, description, vertical_slug, geography, entity_level, requirement_level, issuing_authority, legal_reference, verification_method, validity_period_months) VALUES
-- HVAC - Ontario (Canada)
('TRADE_LICENSING', 'ON_TSSA_GAS_G2', 'TSSA Gas Technician 2 (G2) or G1', 'Required to install, inspect, and service residential & commercial natural gas / propane heating systems.', 'hvac', 'ON', 'TECHNICIAN', 'MANDATORY', 'Technical Standards and Safety Authority (TSSA)', 'Technical Standards and Safety Act, O.Reg 215/01', 'REGISTRY_API', 36),
('TRADE_LICENSING', 'ON_SKILLED_TRADES_313A', '313A Refrigeration & Air Conditioning Systems Mechanic', 'Mandatory certificate of qualification to install, test, and repair refrigeration and air conditioning systems.', 'hvac', 'ON', 'TECHNICIAN', 'MANDATORY', 'Skilled Trades Ontario', 'Building Opportunities in the Skilled Trades Act (BOSTA)', 'REGISTRY_API', 36),
('ENVIRONMENTAL_HAZARDOUS', 'CA_ODS_REFRIGERANT', 'ODS Environmental Refrigerant Handling Certificate', 'Environmental certificate for handling ozone-depleting substances and fluorocarbon refrigerants.', 'hvac', 'ON', 'TECHNICIAN', 'MANDATORY', 'Heating, Refrigeration and Air Conditioning Institute (HRAI) / MOECC', 'Ontario Reg 463/10', 'DOCUMENT_UPLOAD', 60),
('STATUTORY_REGISTRATION', 'ON_TSSA_CONTRACTOR_REG', 'TSSA Heating Fuels Contractor Registration', 'Mandatory annual registration for businesses offering heating and fuel-related installation and service.', 'hvac', 'ON', 'CONTRACTOR', 'MANDATORY', 'Technical Standards and Safety Authority (TSSA)', 'TSSA Act Fuel Safety Division', 'DOCUMENT_UPLOAD', 12),
('INSURANCE_FINANCIAL', 'ON_WSIB_CLEARANCE', 'WSIB Clearance Certificate', 'Mandatory active clearance certificate confirming workers compensation premium compliance and coverage.', 'hvac', 'ON', 'CONTRACTOR', 'MANDATORY', 'Workplace Safety and Insurance Board (WSIB)', 'Workplace Safety and Insurance Act, Section 141', 'REGISTRY_API', 3),
('HEALTH_SAFETY', 'ON_MOL_HEIGHTS', 'Working at Heights Training (CPO Approved)', 'Chief Prevention Officer approved fall prevention training required for ladder, rooftop, and elevated service.', 'hvac', 'ON', 'TECHNICIAN', 'MANDATORY', 'Ontario Ministry of Labour, Immigration, Training & Skills', 'Occupational Health and Safety Act, O.Reg 297/13', 'DOCUMENT_UPLOAD', 36),

-- HVAC - California (USA)
('TRADE_LICENSING', 'CA_CSLB_C20', 'CSLB Class C-20 Warm-Air Heating, Ventilating & AC', 'Mandatory California specialty contractor license to install, maintain, or repair HVAC systems.', 'hvac', 'CA', 'CONTRACTOR', 'MANDATORY', 'California Contractors State License Board (CSLB)', 'California Business and Professions Code § 7058', 'REGISTRY_API', 24),
('ENVIRONMENTAL_HAZARDOUS', 'US_EPA_608_UNIVERSAL', 'EPA Section 608 Universal Refrigerant Certification', 'Federal Clean Air Act mandatory certification for servicing, maintaining, and disposing of stationary refrigeration equipment.', 'hvac', 'CA', 'TECHNICIAN', 'MANDATORY', 'US Environmental Protection Agency (EPA)', 'Clean Air Act Section 608 (40 CFR Part 82)', 'DOCUMENT_UPLOAD', NULL),
('INSURANCE_FINANCIAL', 'CA_CSLB_SURETY_BOND', 'CSLB Contractor License Surety Bond ($25,000)', 'Statutory performance and compliance bond deposited with the California State License Board.', 'hvac', 'CA', 'CONTRACTOR', 'MANDATORY', 'Licensed California Surety Underwriter', 'California Business and Professions Code § 7071.6', 'DOCUMENT_UPLOAD', 12),
('INSURANCE_FINANCIAL', 'CA_WORKERS_COMP', 'California Workers Compensation Certificate', 'Statutory workers compensation insurance covering all employed technicians and field crews.', 'hvac', 'CA', 'CONTRACTOR', 'MANDATORY', 'California Department of Industrial Relations (DIR)', 'California Labor Code § 3700', 'DOCUMENT_UPLOAD', 12),
('HEALTH_SAFETY', 'US_OSHA_10_CONST', 'OSHA 10-Hour Construction Safety Card', 'Comprehensive occupational construction safety training covering hazard recognition and mitigation.', 'hvac', 'CA', 'TECHNICIAN', 'RECOMMENDED', 'Occupational Safety and Health Administration (OSHA)', '29 CFR 1926 Safety and Health Regulations', 'DOCUMENT_UPLOAD', NULL),

-- HVAC - Texas (USA)
('TRADE_LICENSING', 'TX_TDLR_ACR_CLASS_A', 'TDLR Air Conditioning & Refrigeration Contractor (Class A/B)', 'State license authorizing environmental air conditioning, commercial refrigeration, and process cooling/heating.', 'hvac', 'TX', 'CONTRACTOR', 'MANDATORY', 'Texas Department of Licensing and Regulation (TDLR)', 'Texas Occupations Code Chapter 1302', 'REGISTRY_API', 12),
('ENVIRONMENTAL_HAZARDOUS', 'US_EPA_608_UNIVERSAL', 'EPA Section 608 Universal Refrigerant Certification', 'Federal Clean Air Act mandatory certification for servicing stationary refrigerant equipment.', 'hvac', 'TX', 'TECHNICIAN', 'MANDATORY', 'US Environmental Protection Agency (EPA)', 'Clean Air Act Section 608', 'DOCUMENT_UPLOAD', NULL),
('INSURANCE_FINANCIAL', 'TX_TDLR_INSURANCE', 'TDLR Commercial Liability Insurance Certificate', 'State-mandated commercial general liability insurance ($300,000 Class A / $100,000 Class B minimums).', 'hvac', 'TX', 'CONTRACTOR', 'MANDATORY', 'Texas Department of Insurance / TDLR', '16 TAC § 75.40 Insurance Requirements', 'DOCUMENT_UPLOAD', 12),

-- HVAC - British Columbia (Canada)
('TRADE_LICENSING', 'BC_TECH_SAFETY_GAS_A_B', 'Technical Safety BC Gas Fitter Certificate Class A/B', 'Provincial authorization to install, test, service, and alter gas piping, appliances, and vents.', 'hvac', 'BC', 'TECHNICIAN', 'MANDATORY', 'Technical Safety BC', 'Safety Standards Act & Gas Safety Regulation', 'REGISTRY_API', 36),
('TRADE_LICENSING', 'BC_REFRIGERATION_JOURNEY', 'BC Certificate of Qualification - Refrigeration Mechanic', 'Recognized tradesperson qualification for cooling, chiller, and heat pump installations.', 'hvac', 'BC', 'TECHNICIAN', 'MANDATORY', 'SkilledTradesBC', 'Skilled Trades BC Act', 'REGISTRY_API', 36),
('INSURANCE_FINANCIAL', 'BC_WORKSAFE_CLEARANCE', 'WorkSafeBC Clearance Letter', 'Statutory proof of active registration and good standing with the British Columbia Workers Compensation Board.', 'hvac', 'BC', 'CONTRACTOR', 'MANDATORY', 'WorkSafeBC', 'Workers Compensation Act Part 5', 'REGISTRY_API', 3),

-- Universal / Multi-Vertical Standards
('INSURANCE_FINANCIAL', 'CGL_INSURANCE_2M', 'Commercial General Liability Insurance ($2,000,000 Min)', 'Underwritten policy protecting against third-party bodily injury, property damage, and completed operations.', '*', '*', 'CONTRACTOR', 'MANDATORY', 'Recognized Commercial Insurance Carrier', 'Standard Marketplace Carrier Requirement', 'DOCUMENT_UPLOAD', 12),
('INSURANCE_FINANCIAL', 'COMMERCIAL_AUTO_1M', 'Commercial Auto Fleet Liability Insurance ($1,000,000)', 'Coverage for service vans, trucks, and equipment transports traveling to job sites.', '*', '*', 'CONTRACTOR', 'MANDATORY', 'Recognized Commercial Auto Carrier', 'Standard Fleet Coverage', 'DOCUMENT_UPLOAD', 12),
('TRUST_IDENTITY', 'GOVT_PHOTO_ID', 'Government-Issued Photo Identification', 'Official government driver license or passport verifying identity of all dispatched field technicians.', '*', '*', 'TECHNICIAN', 'MANDATORY', 'Federal / State / Provincial Licensing Authority', 'Identity Verification Standard', 'DOCUMENT_UPLOAD', NULL),
('TRUST_IDENTITY', 'BACKGROUND_CHECK_ANNUAL', 'Annual Criminal Background & Judicial Check', 'Clean background screening with vulnerable sector verification completed within past 12 months.', '*', '*', 'TECHNICIAN', 'MANDATORY', 'Accredited Background Screening Partner / Police Service', 'Residential Trust & Safety Policy', 'DOCUMENT_UPLOAD', 12),
('HEALTH_SAFETY', 'FIRST_AID_CPR_C', 'Standard First Aid & CPR Level C (AED)', 'Accredited basic life support and emergency trauma response training.', '*', '*', 'TECHNICIAN', 'RECOMMENDED', 'Red Cross / St. John Ambulance / AHA', 'Workplace Safety Guidelines', 'DOCUMENT_UPLOAD', 36),

-- Plumbing Standards (Ontario, California, Texas)
('TRADE_LICENSING', 'ON_SKILLED_TRADES_306A', '306A Plumber Certificate of Qualification', 'Mandatory trade qualification for installing, repairing, and maintaining water supply and wastewater systems.', 'plumbing', 'ON', 'TECHNICIAN', 'MANDATORY', 'Skilled Trades Ontario', 'Building Opportunities in the Skilled Trades Act', 'REGISTRY_API', 36),
('TRADE_LICENSING', 'CA_CSLB_C36', 'CSLB Class C-36 Plumbing Contractor License', 'California contractor license authorizing water supply, sewer, gas line, and hydronic heating work.', 'plumbing', 'CA', 'CONTRACTOR', 'MANDATORY', 'California Contractors State License Board', 'California B&P Code § 7058', 'REGISTRY_API', 24),
('TRADE_LICENSING', 'TX_TSBPE_MASTER_PLUMBER', 'Texas Master Plumber License', 'Required to secure permits and contract plumbing work across the State of Texas.', 'plumbing', 'TX', 'CONTRACTOR', 'MANDATORY', 'Texas State Board of Plumbing Examiners (TSBPE)', 'Texas Occupations Code Chapter 1301', 'REGISTRY_API', 12),

-- Electrical Standards (Ontario, California, Texas)
('TRADE_LICENSING', 'ON_ESA_LEC_CONTRACTOR', 'ESA Licensed Electrical Contractor (LEC)', 'Statutory license required to operate an electrical contracting business and pull permits in Ontario.', 'electrical', 'ON', 'CONTRACTOR', 'MANDATORY', 'Electrical Safety Authority (ESA / ECRA)', 'Electricity Act, 1998, O.Reg 570/05', 'REGISTRY_API', 12),
('TRADE_LICENSING', 'ON_SKILLED_TRADES_309A', '309A Electrician - Construction and Maintenance', 'Certificate of qualification permitting installation and maintenance of electrical systems in buildings.', 'electrical', 'ON', 'TECHNICIAN', 'MANDATORY', 'Skilled Trades Ontario', 'BOSTA Act 2021', 'REGISTRY_API', 36),
('TRADE_LICENSING', 'CA_CSLB_C10', 'CSLB Class C-10 Electrical Contractor License', 'California license to install, maintain, and connect electrical wires, conduits, apparatus, and fixtures.', 'electrical', 'CA', 'CONTRACTOR', 'MANDATORY', 'California Contractors State License Board', 'California B&P Code § 7058', 'REGISTRY_API', 24),
('TRADE_LICENSING', 'TX_TDLR_MASTER_ELECTRICIAN', 'Texas Master Electrician License', 'State license permitting contracting and oversight of residential and commercial electrical work.', 'electrical', 'TX', 'CONTRACTOR', 'MANDATORY', 'Texas Department of Licensing and Regulation', 'Texas Occupations Code Chapter 1305', 'REGISTRY_API', 12),

-- Roofing Standards (Ontario, California)
('HEALTH_SAFETY', 'ROOFING_FALL_PROTECTION', 'Comprehensive Fall Protection & Rescue Certification', 'Mandatory safety protocol training for high-angle roofing operations.', 'roofing', '*', 'TECHNICIAN', 'MANDATORY', 'Accredited Safety Training Institute', 'OSHA 1926 Subpart M / Provincial Safety Regs', 'DOCUMENT_UPLOAD', 36),
('TRADE_LICENSING', 'CA_CSLB_C39', 'CSLB Class C-39 Roofing Contractor License', 'California specialty contractor license for installation and repair of all roof coverings.', 'roofing', 'CA', 'CONTRACTOR', 'MANDATORY', 'California Contractors State License Board', 'California B&P Code § 7058', 'REGISTRY_API', 24),
('INSURANCE_FINANCIAL', 'ROOFING_OPEN_FLAME_INSURANCE', 'CGL Open Flame / Hot-Tar Endorsement ($3,000,000)', 'Specific insurance endorsement covering torch-applied roofing systems and fire liability.', 'roofing', '*', 'CONTRACTOR', 'MANDATORY', 'Commercial Insurance Underwriter', 'Roofing Specialty Policy Terms', 'DOCUMENT_UPLOAD', 12)
ON CONFLICT (vertical_slug, geography, credential_code, entity_level) DO NOTHING;
