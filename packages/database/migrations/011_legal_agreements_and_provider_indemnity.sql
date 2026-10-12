-- Migration 011: Marketplace Role, Provider Indemnity & Signed Agreements (#61)

-- 1. Legal Agreements Table (Versioned counsel-reviewed terms, ICA, and customer agreements)
CREATE TABLE IF NOT EXISTS legal_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (
    type IN (
      'INDEPENDENT_CONTRACTOR_AGREEMENT',
      'CUSTOMER_SERVICE_TERMS',
      'PLATFORM_TERMS_OF_SERVICE',
      'PRIVACY_POLICY'
    )
  ),
  version text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'ON',
  title text NOT NULL,
  summary text NOT NULL,
  content_markdown text NOT NULL,
  content_checksum text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  effective_date timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  legal_counsel_ref text,
  key_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_legal_agreements_type_version_jurisdiction UNIQUE (type, version, jurisdiction)
);

CREATE INDEX IF NOT EXISTS idx_legal_agreements_type_active ON legal_agreements(type, is_active);
CREATE INDEX IF NOT EXISTS idx_legal_agreements_jurisdiction ON legal_agreements(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_legal_agreements_version ON legal_agreements(version);

-- 2. Agreement Signatures Table (Tamper-evident audit of e-signatures, signer identity, IP, user agent, checksum)
CREATE TABLE IF NOT EXISTS agreement_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES legal_agreements(id) ON DELETE RESTRICT,
  agreement_type text NOT NULL,
  agreement_version text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'ON',
  signer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  signer_role text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('CONTRACTOR', 'CUSTOMER', 'TECHNICIAN')),
  contractor_id uuid REFERENCES contractors(id) ON DELETE CASCADE,
  signer_legal_name text NOT NULL,
  signer_title text,
  ip_address text NOT NULL,
  user_agent text NOT NULL,
  agreement_checksum text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_signatures_contractor ON agreement_signatures(contractor_id, agreement_type);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_user ON agreement_signatures(signer_user_id, agreement_type);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_agreement ON agreement_signatures(agreement_id);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_signed_at ON agreement_signatures(signed_at);

-- 3. Canonical Ontario Seed: Independent Contractor Agreement v1.0.0
INSERT INTO legal_agreements (
  id,
  type,
  version,
  jurisdiction,
  title,
  summary,
  content_markdown,
  content_checksum,
  is_active,
  legal_counsel_ref,
  key_terms
) VALUES (
  '11111111-1111-4111-a111-111111111101',
  'INDEPENDENT_CONTRACTOR_AGREEMENT',
  '1.0.0',
  'ON',
  'Master Independent Contractor Agreement & Mutual Defense/Indemnity Protocol (Ontario)',
  'Ontario counsel-approved marketplace independent contractor agreement defining tripartite contracting privity, mandatory contractor indemnity, statutory permit pull covenants, worker qualification warranty, and explicit platform negligence exceptions.',
  E'# MASTER INDEPENDENT CONTRACTOR AGREEMENT (ONTARIO)\n\n**Effective Date:** October 1, 2026\n**Jurisdiction:** Province of Ontario, Canada\n**Counsel Review:** ON-LEGAL-2026-ICA-771\n\n## 1. MARKETPLACE ROLE & DIRECT PRIVITY OF CONTRACT\n1.1 **Technology Intermediary:** Skilled Hire Inc. ("Platform") provides a communications, scheduling, dispatch-matching, and billing technology platform. The Platform is neither a general contractor, electrical contractor, heating contractor, plumbing contractor, employer, partner, nor joint venturer with the Service Provider ("Contractor").\n1.2 **Tripartite Relationship:** All trade work performed for residential or commercial property owners ("Customers") constitutes a direct contractual relationship between Customer and Contractor. The Contractor maintains complete operational control over methods, equipment, and execution of the trade work.\n\n## 2. INDEMNIFICATION, DEFENSE & LIABILITY ALLOCATION\n2.1 **Contractor Indemnity:** The Contractor shall defend, indemnify, and hold harmless the Platform, its affiliates, directors, officers, and employees against any and all liabilities, losses, claims, damages, statutory penalties (including ESA, TSSA, or Ministry of Labour fines), costs, and legal expenses arising out of or related to: (a) property damage or personal injury caused by Contractor or its technicians; (b) defects in workmanship or materials; (c) failure to obtain required permits or code inspections; or (d) breach of applicable laws.\n2.2 **Platform Negligence Exception:** The indemnity in Section 2.1 shall not apply to the extent damages are judicially determined to have resulted directly from the gross negligence or intentional misconduct of the Platform.\n2.3 **No Blanket Zero-Liability:** The Platform disclaims vicarious liability for trade workmanship, but acknowledges that non-waivable statutory rights under Ontario law (including consumer protection legislation) remain fully preserved.\n\n## 3. STATUTORY PERMITS, CODES & SAFETY GOVERNANCE\n3.1 **Permit Responsibility:** Contractor covenants and agrees that it is solely responsible for: (a) filing all required permits, notices, and inspection requests with regulatory authorities, including Electrical Safety Authority (ESA) notifications and municipal building permits; (b) paying all inspection fees; and (c) providing official Certificates of Acceptance or inspection sign-offs to the Customer and Platform prior to milestone completion.\n3.2 **Health & Safety Compliance:** Contractor warrants compliance with the Occupational Health and Safety Act (OHSA), Workplace Safety and Insurance Act (WSIA), Technical Standards and Safety Act (TSSA), and Electricity Act.\n\n## 4. QUALIFICATIONS, TECHNICIANS & SUBCONTRACTING\n4.1 **Certified Personnel:** Contractor warrants that all dispatched technicians hold active, verified Certificates of Qualification (e.g. 309A Electrician, 313A Refrigeration, 306A Plumber, or TSSA Gas Technician) and active photo identification.\n4.2 **Subcontractor Warranty:** Subcontracting is prohibited without prior written authorization on the Platform, and any approved subcontractor remains the full legal responsibility of the Contractor.',
  'e7f5e8f192b0365743b1778912efce32483582490dcb0a73b4d455428a556859',
  true,
  'ON-LEGAL-2026-ICA-771',
  '{
    "intermediaryModel": "INDEPENDENT_CONTRACTOR_MARKETPLACE",
    "indemnityScope": "FULL_TRADE_DEFENSE_AND_INDEMNITY",
    "permitResponsibility": "CONTRACTOR_EXCLUSIVE",
    "warrantyObligations": "MINIMUM_1_YEAR_LABOUR",
    "platformNegligenceCarveout": true,
    "nonWaivableRightsProtected": true,
    "governingLaw": "ONTARIO_CANADA"
  }'::jsonb
) ON CONFLICT (type, version, jurisdiction) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  content_markdown = EXCLUDED.content_markdown,
  content_checksum = EXCLUDED.content_checksum,
  key_terms = EXCLUDED.key_terms,
  legal_counsel_ref = EXCLUDED.legal_counsel_ref;

-- 4. Canonical Ontario Seed: Customer Service Terms v1.0.0
INSERT INTO legal_agreements (
  id,
  type,
  version,
  jurisdiction,
  title,
  summary,
  content_markdown,
  content_checksum,
  is_active,
  legal_counsel_ref,
  key_terms
) VALUES (
  '11111111-1111-4111-a111-111111111102',
  'CUSTOMER_SERVICE_TERMS',
  '1.0.0',
  'ON',
  'Customer Service Terms & Marketplace Protections (Ontario)',
  'Ontario counsel-approved customer agreement disclosing the intermediary role of the platform, direct trade privity with licensed contractors, mandatory permit procedures, 1-year workmanship warranty, and non-waivable statutory rights under the Consumer Protection Act, 2002.',
  E'# CUSTOMER SERVICE TERMS & CONDITIONS (ONTARIO)\n\n**Effective Date:** October 1, 2026\n**Jurisdiction:** Province of Ontario, Canada\n**Counsel Review:** ON-LEGAL-2026-CST-882\n\n## 1. HOW SKILLED HIRE WORKS\n1.1 **Marketplace Role:** Skilled Hire Inc. connects homeowners and commercial property managers with independent, certified, and vetted trade contractors. Skilled Hire provides digital matching, credential verification, and payment escrow facilitation.\n1.2 **Direct Contractor Contract:** When a service request is booked and assigned, your contract for the physical trade services is formed directly with the designated independent trade contractor. Skilled Hire is not the trade contractor.\n\n## 2. PERMITS, INSPECTIONS & CODE COMPLIANCE\n2.1 **Permit Pulling:** For all regulated electrical, gas, or plumbing jobs, the assigned contractor is legally obligated to file notices of work (e.g. Electrical Safety Authority notification) and arrange mandatory inspections.\n2.2 **Certificate of Acceptance:** For electrical installations requiring an ESA permit, you are entitled to receive an official Certificate of Acceptance upon work completion.\n\n## 3. WORKMANSHIP WARRANTY & DISPUTE RESOLUTION\n3.1 **1-Year Workmanship Guarantee:** All eligible jobs booked through Skilled Hire include a minimum 1-year workmanship warranty backed by the contractor.\n3.2 **Escrow Protection:** Payments are held in secure escrow and released according to verifiable milestone completions.\n\n## 4. CONSUMER PROTECTION ACT, 2002\n4.1 **Non-Waivable Rights:** Nothing in these terms excludes, restricts, or modifies any consumer guarantee, statutory warranty, right, or remedy conferred by the Consumer Protection Act, 2002 (Ontario) or other applicable law that cannot be lawfully excluded.',
  'bc8d3e9508d72856f6424e4d6d6ce055ecbd72cfb0222a012e128ef83d95ef54',
  true,
  'ON-LEGAL-2026-CST-882',
  '{
    "intermediaryModel": "DIRECT_CONTRACTOR_PRIVITY",
    "consumerProtectionActCompliant": true,
    "warrantyTermMonths": 12,
    "permitDisclosure": "ESA_TSSA_CONTRACTOR_PULLED",
    "governingLaw": "ONTARIO_CANADA"
  }'::jsonb
) ON CONFLICT (type, version, jurisdiction) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  content_markdown = EXCLUDED.content_markdown,
  content_checksum = EXCLUDED.content_checksum,
  key_terms = EXCLUDED.key_terms,
  legal_counsel_ref = EXCLUDED.legal_counsel_ref;
