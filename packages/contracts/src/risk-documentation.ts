// packages/contracts/src/risk-documentation.ts

export type JobDocumentationStatus =
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "VERIFIED_COMPLIANT"
  | "DEFICIENT"
  | "OPS_APPROVED_EXCEPTION";

export type DocumentationRiskTier = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type QaAuditStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "PASSED"
  | "FAILED_DEFICIENCIES";

export interface EvidencePhoto {
  url: string;
  caption?: string | undefined;
  timestamp?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  phase: "BEFORE" | "IN_PROGRESS" | "AFTER";
}

export interface RiskChecklistItem {
  key: string;
  label: string;
  confirmed: boolean;
  notes?: string | undefined;
  criticalHazard?: boolean | undefined;
}

export interface CustomerSignoff {
  signed: boolean;
  customerName?: string | undefined;
  signedAt?: string | undefined;
  feedback?: string | undefined;
  signatureDigest?: string | undefined;
}

export interface DocumentationDeficiency {
  code: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  description: string;
  rectified?: boolean | undefined;
  rectifiedAt?: string | undefined;
}

export interface ExceptionAuditEntry {
  approvedByUserId: string;
  reason: string;
  timestamp: string;
  conditions?: string[] | undefined;
}

export interface JobDocumentationPackage {
  id: string;
  jobId: string;
  serviceRequestId: string;
  contractorId: string;
  technicianId?: string | null | undefined;
  propertyId: string;
  riskTier: DocumentationRiskTier;
  status: JobDocumentationStatus;
  beforePhotos: EvidencePhoto[];
  inProgressPhotos: EvidencePhoto[];
  afterPhotos: EvidencePhoto[];
  workerIdentityConfirmed: boolean;
  workerIdentityNotes?: string | null | undefined;
  riskChecklist: RiskChecklistItem[];
  customerSignoff: CustomerSignoff;
  permitId?: string | null | undefined;
  permitVerified: boolean;
  qaAuditId?: string | null | undefined;
  qaAuditRequired: boolean;
  qaAuditStatus: QaAuditStatus;
  incidentEscalationId?: string | null | undefined;
  incidentEscalated: boolean;
  deficiencies: DocumentationDeficiency[];
  exceptionAuditLog: ExceptionAuditEntry[];
  submittedByUserId?: string | null | undefined;
  submittedAt?: string | null | undefined;
  reviewedByUserId?: string | null | undefined;
  reviewedAt?: string | null | undefined;
  reviewNotes?: string | null | undefined;
  propertyPassportLinked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentationGateResult {
  passed: boolean;
  status: JobDocumentationStatus;
  riskTier: DocumentationRiskTier;
  missingRequirements: string[];
  deficiencies: DocumentationDeficiency[];
  qaAuditRequired: boolean;
  incidentEscalationRequired: boolean;
  severeHazardDetected?: boolean | undefined;
  escalationReason?: string | undefined;
}

export interface QaMetrics {
  totalPackages: number;
  verifiedCompliantCount: number;
  deficientCount: number;
  exceptionApprovedCount: number;
  inProgressCount: number;
  complianceRateBps: number;
  qaSamplingRateBps: number;
  tierBreakdown: Record<string, { total: number; compliant: number }>;
  defectRemediationRateBps: number;
}
