// packages/vertical-engine/src/warranty.ts

import type {
  WarrantyClaimStatus,
  WarrantyClaimUrgency,
  WarrantySnapshotStatus,
  WarrantyTriageResult,
} from "@marketplace/contracts";
import { computeAgreementChecksum } from "./legal.js";

/**
 * Calculates warranty expiry date given a start date and duration in months.
 */
export function calculateWarrantyExpiry(
  startDate: Date | string,
  durationMonths: number,
): string {
  const start = typeof startDate === "string" ? new Date(startDate) : new Date(startDate.getTime());
  const expiry = new Date(start.getTime());
  expiry.setUTCMonth(expiry.getUTCMonth() + durationMonths);
  return expiry.toISOString();
}

/**
 * Generates human-readable, unique certificate number.
 * Example: WAR-2026-A1B2C3D4
 */
export function generateWarrantyCertificateNumber(year?: number): string {
  const y = year ?? new Date().getUTCFullYear();
  const rand = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  return `WAR-${y}-${rand}`;
}

/**
 * Generates human-readable, unique claim number.
 * Example: CLM-2026-F9E8D7C6
 */
export function generateWarrantyClaimNumber(year?: number): string {
  const y = year ?? new Date().getUTCFullYear();
  const rand = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  return `CLM-${y}-${rand}`;
}

export interface WarrantyDigestPayload {
  certificateNumber: string;
  jobId: string;
  durationMonths: number;
  coveredDefects: string[];
  exclusions: string[];
  statutoryTerms?: string | undefined;
  responseSlaHours?: number | undefined;
}

/**
 * Deterministically computes SHA-256 digest of accepted warranty terms.
 */
export function computeWarrantyTermsDigest(payload: WarrantyDigestPayload): string {
  const normalized = {
    certificateNumber: payload.certificateNumber,
    jobId: payload.jobId,
    durationMonths: payload.durationMonths,
    coveredDefects: [...payload.coveredDefects].sort(),
    exclusions: [...payload.exclusions].sort(),
    statutoryTerms: payload.statutoryTerms ?? "",
    responseSlaHours: payload.responseSlaHours ?? 48,
  };
  return computeAgreementChecksum(JSON.stringify(normalized));
}

export interface TriageInput {
  urgency: WarrantyClaimUrgency;
  title: string;
  description: string;
  coveredDefects: string[];
  exclusions: string[];
  responseSlaHours?: number | undefined;
  emergencySlaHours?: number | undefined;
  filedAt?: Date | string | undefined;
}

/**
 * Evaluates urgency and coverage for a filed warranty claim.
 */
export function triageWarrantyClaimUrgency(input: TriageInput): WarrantyTriageResult {
  const text = `${input.title} ${input.description}`.toLowerCase();
  
  // Detect emergency conditions
  const isEmergencyCondition =
    input.urgency === "URGENT_NO_HEAT" ||
    input.urgency === "URGENT_WATER_LEAK" ||
    input.urgency === "EMERGENCY_SAFETY_HAZARD" ||
    text.includes("no heat") ||
    text.includes("freezing") ||
    text.includes("burst pipe") ||
    text.includes("active leak") ||
    text.includes("water leaking") ||
    text.includes("gas smell") ||
    text.includes("sparking") ||
    text.includes("electrical hazard");

  let effectiveUrgency: WarrantyClaimUrgency = input.urgency;
  if (isEmergencyCondition && input.urgency === "STANDARD") {
    if (text.includes("no heat") || text.includes("freezing")) {
      effectiveUrgency = "URGENT_NO_HEAT";
    } else if (text.includes("water") || text.includes("leak") || text.includes("burst pipe")) {
      effectiveUrgency = "URGENT_WATER_LEAK";
    } else {
      effectiveUrgency = "EMERGENCY_SAFETY_HAZARD";
    }
  }

  const slaHours =
    effectiveUrgency !== "STANDARD"
      ? (input.emergencySlaHours ?? 24)
      : (input.responseSlaHours ?? 48);

  const filed = input.filedAt
    ? typeof input.filedAt === "string"
      ? new Date(input.filedAt)
      : new Date(input.filedAt.getTime())
    : new Date();

  const deadline = new Date(filed.getTime() + slaHours * 3600 * 1000);

  // Exclusions check
  const matchedExclusion = input.exclusions.find((exclusion) => {
    const exc = exclusion.toLowerCase();
    return exc.length > 3 && text.includes(exc);
  });

  if (matchedExclusion) {
    return {
      urgency: effectiveUrgency,
      covered: false,
      slaHours,
      slaDeadline: deadline.toISOString(),
      reason: `Claim description indicates an excluded condition: "${matchedExclusion}"`,
    };
  }

  return {
    urgency: effectiveUrgency,
    covered: true,
    slaHours,
    slaDeadline: deadline.toISOString(),
    reason: "Defect matches covered workmanship terms and SLA guidelines.",
  };
}

/**
 * Evaluates active vs expired status for a snapshot.
 */
export function evaluateWarrantyStatus(
  snapshot: { startsAt: string; expiresAt: string; status: WarrantySnapshotStatus },
  now?: Date,
): WarrantySnapshotStatus {
  if (snapshot.status === "VOIDED_TAMPERING" || snapshot.status === "CLAIM_IN_PROGRESS") {
    return snapshot.status;
  }
  const current = now ?? new Date();
  if (new Date(snapshot.expiresAt) < current) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

/**
 * Returns canonical Ontario statutory workmanship terms under the Ontario Consumer Protection Act.
 */
export function getOntarioStatutoryWarrantyTerms(): string {
  return [
    "ONTARIO STATUTORY WORKMANSHIP WARRANTY & CONSUMER RIGHTS",
    "Pursuant to the Consumer Protection Act, 2002 (S.O. 2002, c. 30, Sched. A) and applicable Ontario trade standards:",
    "1. Deemed Warranty of Quality: The contractor warrants that all services rendered and labour performed are of merchantable quality and fit for the specified residential purpose.",
    "2. Right to Cure: Upon prompt written notice of a defect, the original contractor possesses the primary right to inspect and rectify the workmanship defect within the prescribed SLA window at no charge to the consumer.",
    "3. Defect Remediation: If the original contractor refuses or fails to cure substantiated workmanship defects within the emergency (24h) or standard (48h) SLA, the consumer is entitled to remediation through an approved marketplace replacement contractor, with remediation costs debited to the recovery ledger.",
    "4. Exclusions: This warranty does not cover pre-existing structural flaws, manufacturer equipment defects, unauthorized third-party modifications, or damage resulting from consumer neglect or extraordinary force majeure.",
    "5. Statutory Preservation: No provision of this warranty limits or waives any statutory rights or remedies available under Ontario provincial or Canadian federal law.",
  ].join("\n");
}

const VALID_TRANSITIONS: Record<WarrantyClaimStatus, WarrantyClaimStatus[]> = {
  FILED: ["TRIAGED_COVERED", "TRIAGED_EXCLUDED", "ESCALATED_DISPUTE"],
  TRIAGED_COVERED: ["CONTRACTOR_INSPECTING", "ESCALATED_DISPUTE", "REJECTED"],
  TRIAGED_EXCLUDED: ["CLOSED", "ESCALATED_DISPUTE"],
  CONTRACTOR_INSPECTING: ["REMEDIATION_SCHEDULED", "ESCALATED_DISPUTE", "REJECTED"],
  REMEDIATION_SCHEDULED: ["REMEDIATED", "ESCALATED_DISPUTE"],
  REMEDIATED: ["CLOSED"],
  ESCALATED_DISPUTE: ["REMEDIATION_SCHEDULED", "REJECTED", "CLOSED"],
  REJECTED: ["CLOSED", "ESCALATED_DISPUTE"],
  CLOSED: [],
};

/**
 * Validates state transitions in the warranty claim lifecycle.
 */
export function validateWarrantyClaimTransition(
  currentStatus: WarrantyClaimStatus,
  nextStatus: WarrantyClaimStatus,
): { valid: boolean; error?: string | undefined } {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(nextStatus)) {
    return {
      valid: false,
      error: `Invalid warranty claim status transition from ${currentStatus} to ${nextStatus}`,
    };
  }
  return { valid: true };
}

export interface WarrantyRecoveryAssessmentInput {
  originalContractorAccepted: boolean;
  fallbackRemediationCostCents: number;
}

export interface WarrantyRecoveryAssessmentResult {
  recoveryRequired: boolean;
  recoveryAmountCents: number;
  recoveryReason: string;
}

/**
 * Assesses recovery ledger entries when original contractor refused or failed right-to-cure.
 */
export function calculateWarrantyRecoveryAssessment(
  input: WarrantyRecoveryAssessmentInput,
): WarrantyRecoveryAssessmentResult {
  if (input.originalContractorAccepted || input.fallbackRemediationCostCents <= 0) {
    return {
      recoveryRequired: false,
      recoveryAmountCents: 0,
      recoveryReason: "Original contractor completed remediation or no fallback expense incurred.",
    };
  }

  return {
    recoveryRequired: true,
    recoveryAmountCents: input.fallbackRemediationCostCents,
    recoveryReason: "Remediation performed by fallback contractor following original contractor dispute or SLA failure.",
  };
}
