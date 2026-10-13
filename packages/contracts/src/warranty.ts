// packages/contracts/src/warranty.ts

export type WarrantyType =
  | "STANDARD_WORKMANSHIP"
  | "PREMIUM_EXTENDED"
  | "STATUTORY_MANDATORY";

export type WarrantySnapshotStatus =
  | "ACTIVE"
  | "CLAIM_IN_PROGRESS"
  | "EXPIRED"
  | "VOIDED_TAMPERING";

export type WarrantyClaimUrgency =
  | "STANDARD"
  | "URGENT_NO_HEAT"
  | "URGENT_WATER_LEAK"
  | "EMERGENCY_SAFETY_HAZARD";

export type WarrantyClaimStatus =
  | "FILED"
  | "TRIAGED_COVERED"
  | "TRIAGED_EXCLUDED"
  | "CONTRACTOR_INSPECTING"
  | "REMEDIATION_SCHEDULED"
  | "REMEDIATED"
  | "ESCALATED_DISPUTE"
  | "REJECTED"
  | "CLOSED";

export type WarrantyRecoveryStatus =
  | "PENDING"
  | "RECOVERED_FROM_PAYOUT"
  | "MANUAL_INVOICE_SENT"
  | "WRITTEN_OFF";

export interface WarrantyPolicy {
  id: string;
  policyCode: string;
  version: string;
  verticalId?: string | null | undefined;
  categoryId?: string | null | undefined;
  jurisdiction: string;
  durationMonths: number;
  responseSlaHours: number;
  emergencySlaHours: number;
  coveredDefects: string[];
  exclusions: string[];
  statutoryTerms: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobWarrantySnapshot {
  id: string;
  certificateNumber: string;
  jobId: string;
  policyId?: string | null | undefined;
  propertyId: string;
  contractorId: string;
  customerId: string;
  warrantyType: WarrantyType;
  startsAt: string;
  expiresAt: string;
  durationMonths: number;
  coveredDefects: string[];
  exclusions: string[];
  responseSlaHours: number;
  contractorAcknowledged: boolean;
  contractorAcknowledgedAt: string;
  homeownerCertificateUrl?: string | null | undefined;
  termsDigest: string;
  status: WarrantySnapshotStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyClaim {
  id: string;
  claimNumber: string;
  warrantyId: string;
  jobId: string;
  propertyId: string;
  customerId: string;
  contractorId: string;
  title: string;
  description: string;
  evidencePhotos: string[];
  urgency: WarrantyClaimUrgency;
  status: WarrantyClaimStatus;
  triageNotes?: string | null | undefined;
  slaDeadline: string;
  originalContractorAccepted?: boolean | null | undefined;
  contractorResponseNotes?: string | null | undefined;
  contractorRespondedAt?: string | null | undefined;
  callbackJobId?: string | null | undefined;
  remediationCompletedAt?: string | null | undefined;
  remediationNotes?: string | null | undefined;
  disputeReason?: string | null | undefined;
  disputedAt?: string | null | undefined;
  fallbackContractorId?: string | null | undefined;
  recoveryAmountCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyRecoveryLedgerEntry {
  id: string;
  claimId: string;
  contractorId: string;
  amountCents: number;
  status: WarrantyRecoveryStatus;
  reason: string;
  recoveredAt?: string | null | undefined;
  createdAt: string;
}

export interface WarrantyTriageResult {
  urgency: WarrantyClaimUrgency;
  covered: boolean;
  slaHours: number;
  slaDeadline: string;
  reason: string;
}
