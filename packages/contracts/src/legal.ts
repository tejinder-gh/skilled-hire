export const legalAgreementTypes = [
  "INDEPENDENT_CONTRACTOR_AGREEMENT",
  "CUSTOMER_SERVICE_TERMS",
  "PLATFORM_TERMS_OF_SERVICE",
  "PRIVACY_POLICY",
] as const;
export type LegalAgreementType = (typeof legalAgreementTypes)[number];

export const signerEntityTypes = [
  "CONTRACTOR",
  "CUSTOMER",
  "TECHNICIAN",
] as const;
export type SignerEntityType = (typeof signerEntityTypes)[number];

export interface LegalAgreementKeyTerms {
  intermediaryModel: string;
  indemnityScope?: string;
  permitResponsibility?: string;
  warrantyObligations?: string;
  platformNegligenceCarveout?: boolean;
  nonWaivableRightsProtected?: boolean;
  consumerProtectionActCompliant?: boolean;
  warrantyTermMonths?: number;
  permitDisclosure?: string;
  governingLaw: string;
  [key: string]: unknown;
}

export interface LegalAgreementRecord {
  id: string;
  type: LegalAgreementType;
  version: string;
  jurisdiction: string;
  title: string;
  summary: string;
  contentMarkdown: string;
  contentChecksum: string;
  isActive: boolean;
  effectiveDate: string;
  supersededAt?: string | null;
  legalCounselRef?: string | null;
  keyTerms: LegalAgreementKeyTerms;
  createdAt: string;
  updatedAt: string;
}

export interface AgreementSignatureRecord {
  id: string;
  agreementId: string;
  agreementType: LegalAgreementType;
  agreementVersion: string;
  jurisdiction: string;
  signerUserId: string;
  signerRole: string;
  entityType: SignerEntityType;
  contractorId?: string | null;
  signerLegalName: string;
  signerTitle?: string | null;
  ipAddress: string;
  userAgent: string;
  agreementChecksum: string;
  signedAt: string;
  revokedAt?: string | null;
  metadata: Record<string, unknown>;
}

export interface SignatureEvidenceCertificate {
  certificateId: string;
  signatureId: string;
  agreement: {
    id: string;
    type: LegalAgreementType;
    version: string;
    jurisdiction: string;
    title: string;
    legalCounselRef?: string | null;
    contentChecksum: string;
  };
  signer: {
    userId: string;
    legalName: string;
    role: string;
    title?: string | null;
    entityType: SignerEntityType;
    contractorId?: string | null;
  };
  evidence: {
    signedAt: string;
    ipAddress: string;
    userAgent: string;
    agreementChecksum: string;
    tamperCheckPassed: boolean;
  };
  disclosures: {
    intermediaryModel: string;
    governingLaw: string;
    nonWaivableRightsCarveout: boolean;
  };
}

export interface LegalComplianceEvaluation {
  compliant: boolean;
  requiredAgreementType: LegalAgreementType;
  requiredVersion: string;
  activeSignature: AgreementSignatureRecord | null;
  denyCode?: string | null;
  failClosedReason?: string | null;
}
