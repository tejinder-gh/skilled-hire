// packages/vertical-engine/src/risk-documentation.ts

import type {
  CustomerSignoff,
  DocumentationDeficiency,
  DocumentationGateResult,
  DocumentationRiskTier,
  EvidencePhoto,
  JobDocumentationPackage,
  JobDocumentationStatus,
  QaMetrics,
  RiskChecklistItem,
} from "@marketplace/contracts";

export interface DocumentationGateInput {
  riskTier: DocumentationRiskTier;
  beforePhotos?: EvidencePhoto[] | undefined;
  inProgressPhotos?: EvidencePhoto[] | undefined;
  afterPhotos?: EvidencePhoto[] | undefined;
  workerIdentityConfirmed?: boolean | undefined;
  riskChecklist?: RiskChecklistItem[] | undefined;
  customerSignoff?: CustomerSignoff | undefined;
  permitId?: string | null | undefined;
  permitVerified?: boolean | undefined;
  requiresPermit?: boolean | undefined;
  deficiencies?: DocumentationDeficiency[] | undefined;
  contractorRatingBps?: number | undefined;
  contractorRepeatDefectCount?: number | undefined;
  qaSampleRandomRoll?: number | undefined; // 0.0 to 1.0 for deterministic test control
}

const CRITICAL_HAZARD_KEYS = new Set([
  "LIVE_ELECTRICAL_SHOCK_HAZARD",
  "HIGH_VOLTAGE_ARC_FLASH",
  "GAS_LEAK",
  "COMBUSTION_SAFETY_FAILURE",
  "STRUCTURAL_COLLAPSE_RISK",
  "HAZARDOUS_ASBESTOS_EXPOSURE",
]);

/**
 * Deterministically evaluates job documentation against risk-tiered gates (#63).
 * Enforces evidence minimums, checklist integrity, customer sign-off, QA sampling,
 * and automated #58 safety incident escalation upon detection of severe hazards.
 */
export function evaluateJobDocumentationGate(
  input: DocumentationGateInput,
): DocumentationGateResult {
  const riskTier = input.riskTier;
  const beforePhotos = input.beforePhotos ?? [];
  const inProgressPhotos = input.inProgressPhotos ?? [];
  const afterPhotos = input.afterPhotos ?? [];
  const workerIdentityConfirmed = Boolean(input.workerIdentityConfirmed);
  const riskChecklist = input.riskChecklist ?? [];
  const customerSignoff = input.customerSignoff;
  const deficiencies = input.deficiencies ?? [];

  const missingRequirements: string[] = [];
  let severeHazardDetected = false;
  let escalationReason: string | undefined;

  // 1. Check for severe hazard trigger / safety defect requiring incident escalation (#58)
  for (const deficiency of deficiencies) {
    if (!deficiency.rectified && deficiency.severity === "CRITICAL") {
      severeHazardDetected = true;
      escalationReason = `CRITICAL_DEFICIENCY: ${deficiency.code} - ${deficiency.description}`;
      break;
    }
  }

  for (const item of riskChecklist) {
    if (CRITICAL_HAZARD_KEYS.has(item.key) && !item.confirmed) {
      severeHazardDetected = true;
      escalationReason = `CRITICAL_SAFETY_HAZARD_UNCLEARED: ${item.key} (${item.label})`;
      break;
    }
  }

  // 2. Risk-Tiered Evidence Gates
  switch (riskTier) {
    case "LOW": {
      if (afterPhotos.length < 1) {
        missingRequirements.push("MISSING_AFTER_PHOTO");
      }
      break;
    }

    case "MODERATE": {
      if (beforePhotos.length < 1) {
        missingRequirements.push("MISSING_BEFORE_PHOTO");
      }
      if (afterPhotos.length < 1) {
        missingRequirements.push("MISSING_AFTER_PHOTO");
      }
      if (!workerIdentityConfirmed) {
        missingRequirements.push("UNVERIFIED_WORKER_IDENTITY");
      }
      if (riskChecklist.length === 0 || !riskChecklist.some((item) => item.confirmed)) {
        missingRequirements.push("INCOMPLETE_RISK_CHECKLIST");
      }
      if (!customerSignoff?.signed) {
        missingRequirements.push("MISSING_CUSTOMER_SIGNOFF");
      }
      break;
    }

    case "HIGH": {
      if (beforePhotos.length < 1) {
        missingRequirements.push("MISSING_BEFORE_PHOTO");
      }
      if (inProgressPhotos.length < 1) {
        missingRequirements.push("MISSING_IN_PROGRESS_PHOTO");
      }
      if (afterPhotos.length < 1) {
        missingRequirements.push("MISSING_AFTER_PHOTO");
      }
      if (!workerIdentityConfirmed) {
        missingRequirements.push("UNVERIFIED_WORKER_IDENTITY");
      }
      if (riskChecklist.length < 2 || !riskChecklist.every((item) => item.confirmed)) {
        missingRequirements.push("INCOMPLETE_RISK_CHECKLIST");
      }
      if (input.requiresPermit && !input.permitId && !input.permitVerified) {
        missingRequirements.push("MISSING_REGULATORY_PERMIT");
      }
      if (!customerSignoff?.signed) {
        missingRequirements.push("MISSING_CUSTOMER_SIGNOFF");
      }
      break;
    }

    case "CRITICAL": {
      if (beforePhotos.length < 1) {
        missingRequirements.push("MISSING_BEFORE_PHOTO");
      }
      if (inProgressPhotos.length < 1) {
        missingRequirements.push("MISSING_IN_PROGRESS_PHOTO");
      }
      if (afterPhotos.length < 2) {
        missingRequirements.push("INSUFFICIENT_AFTER_PHOTOS_CRITICAL_MINIMUM_2");
      }
      if (!workerIdentityConfirmed) {
        missingRequirements.push("UNVERIFIED_WORKER_IDENTITY");
      }
      if (riskChecklist.length < 3 || !riskChecklist.every((item) => item.confirmed)) {
        missingRequirements.push("INCOMPLETE_SITE_SAFETY_CHECKLIST");
      }
      if (input.requiresPermit && !input.permitVerified) {
        missingRequirements.push("UNVERIFIED_REGULATORY_PERMIT");
      }
      if (!customerSignoff?.signed) {
        missingRequirements.push("MISSING_CUSTOMER_SIGNOFF");
      }
      break;
    }
  }

  // 3. QA Sampling Eligibility Evaluation
  const qaAuditRequired = evaluateQaSamplingEligibility({
    riskTier,
    contractorRatingBps: input.contractorRatingBps,
    contractorRepeatDefectCount: input.contractorRepeatDefectCount,
    qaSampleRandomRoll: input.qaSampleRandomRoll,
  }).sampleForAudit;

  // 4. Incident Escalation
  const incidentEscalationRequired = severeHazardDetected;

  // 5. Compute Final Status
  let status: JobDocumentationStatus = "IN_PROGRESS";
  let passed = false;

  const unrectifiedDeficiencies = deficiencies.filter((d) => !d.rectified);

  if (incidentEscalationRequired || unrectifiedDeficiencies.length > 0) {
    status = "DEFICIENT";
    passed = false;
  } else if (missingRequirements.length > 0) {
    status = "IN_PROGRESS";
    passed = false;
  } else {
    status = "VERIFIED_COMPLIANT";
    passed = true;
  }

  return {
    passed,
    status,
    riskTier,
    missingRequirements,
    deficiencies,
    qaAuditRequired,
    incidentEscalationRequired,
    ...(severeHazardDetected ? { severeHazardDetected: true, escalationReason } : {}),
  };
}

export interface QaSamplingInput {
  riskTier: DocumentationRiskTier;
  contractorRatingBps?: number | undefined;
  contractorRepeatDefectCount?: number | undefined;
  qaSampleRandomRoll?: number | undefined;
}

/**
 * Determines if a job documentation package should be sampled for an independent QA Audit / inspection.
 */
export function evaluateQaSamplingEligibility(input: QaSamplingInput): {
  sampleForAudit: boolean;
  reason: string;
} {
  if (input.riskTier === "CRITICAL") {
    return {
      sampleForAudit: true,
      reason: "MANDATORY_CRITICAL_RISK_AUDIT",
    };
  }

  if (input.riskTier === "HIGH") {
    if ((input.contractorRepeatDefectCount ?? 0) > 0) {
      return {
        sampleForAudit: true,
        reason: "HIGH_RISK_CONTRACTOR_DEFECT_HISTORY",
      };
    }
    if ((input.contractorRatingBps ?? 5000) < 4500) {
      return {
        sampleForAudit: true,
        reason: "HIGH_RISK_BELOW_BENCHMARK_RATING",
      };
    }
    // 20% random sampling roll
    const roll = input.qaSampleRandomRoll ?? Math.random();
    if (roll < 0.2) {
      return {
        sampleForAudit: true,
        reason: "HIGH_RISK_RANDOM_SAMPLE_20_PCT",
      };
    }
  }

  if (input.riskTier === "MODERATE") {
    if ((input.contractorRepeatDefectCount ?? 0) >= 2) {
      return {
        sampleForAudit: true,
        reason: "REPEAT_DEFECT_THRESHOLD_MET",
      };
    }
  }

  return {
    sampleForAudit: false,
    reason: "STANDARD_EXEMPTION",
  };
}

/**
 * Computes operations QA and documentation metrics across submitted packages.
 */
export function calculateQaMetrics(packages: JobDocumentationPackage[]): QaMetrics {
  const totalPackages = packages.length;
  if (totalPackages === 0) {
    return {
      totalPackages: 0,
      verifiedCompliantCount: 0,
      deficientCount: 0,
      exceptionApprovedCount: 0,
      inProgressCount: 0,
      complianceRateBps: 0,
      qaSamplingRateBps: 0,
      tierBreakdown: {},
      defectRemediationRateBps: 10000,
    };
  }

  let verifiedCompliantCount = 0;
  let deficientCount = 0;
  let exceptionApprovedCount = 0;
  let inProgressCount = 0;
  let qaAuditCount = 0;

  let totalDeficiencies = 0;
  let rectifiedDeficiencies = 0;

  const tierBreakdown: Record<string, { total: number; compliant: number }> = {
    LOW: { total: 0, compliant: 0 },
    MODERATE: { total: 0, compliant: 0 },
    HIGH: { total: 0, compliant: 0 },
    CRITICAL: { total: 0, compliant: 0 },
  };

  for (const pkg of packages) {
    const tier = pkg.riskTier;
    if (tierBreakdown[tier]) {
      tierBreakdown[tier]!.total++;
    }

    if (pkg.status === "VERIFIED_COMPLIANT") {
      verifiedCompliantCount++;
      if (tierBreakdown[tier]) tierBreakdown[tier]!.compliant++;
    } else if (pkg.status === "OPS_APPROVED_EXCEPTION") {
      exceptionApprovedCount++;
      if (tierBreakdown[tier]) tierBreakdown[tier]!.compliant++;
    } else if (pkg.status === "DEFICIENT") {
      deficientCount++;
    } else {
      inProgressCount++;
    }

    if (pkg.qaAuditRequired || pkg.qaAuditId) {
      qaAuditCount++;
    }

    for (const def of pkg.deficiencies) {
      totalDeficiencies++;
      if (def.rectified) {
        rectifiedDeficiencies++;
      }
    }
  }

  const compliantTotal = verifiedCompliantCount + exceptionApprovedCount;
  const complianceRateBps = Math.round((compliantTotal / totalPackages) * 10000);
  const qaSamplingRateBps = Math.round((qaAuditCount / totalPackages) * 10000);

  const defectRemediationRateBps =
    totalDeficiencies === 0
      ? 10000
      : Math.round((rectifiedDeficiencies / totalDeficiencies) * 10000);

  return {
    totalPackages,
    verifiedCompliantCount,
    deficientCount,
    exceptionApprovedCount,
    inProgressCount,
    complianceRateBps,
    qaSamplingRateBps,
    tierBreakdown,
    defectRemediationRateBps,
  };
}
