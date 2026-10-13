import type {
  CapabilityAssessmentStatus,
  CapabilityEvaluationResult,
  ComplexityTier,
  ContractorCapabilityAssessment,
} from "@marketplace/contracts";

export const COMPLEXITY_TIER_RANK: Record<ComplexityTier, number> = {
  TIER_1_BASIC: 1,
  TIER_2_STANDARD: 2,
  TIER_3_ADVANCED: 3,
  TIER_4_SPECIALIZED: 4,
};

export interface EvaluateCapabilityParams {
  assessment: ContractorCapabilityAssessment | null | undefined;
  requiredComplexityTier: ComplexityTier;
  estimatedJobValueCents: number;
  now?: Date;
}

/**
 * Strict fail-closed contractor technical capability evaluator.
 * Enforces per-service-variant scoping, experience tiers, financial ceilings,
 * and qualified supervisor / provisional safeguards.
 */
export function evaluateContractorCapability(
  params: EvaluateCapabilityParams,
): CapabilityEvaluationResult {
  const currentTime = params.now ?? new Date();
  const isoNow = currentTime.toISOString();

  // 1. Fail-closed: No assessment on file
  if (!params.assessment) {
    return {
      eligible: false,
      contractorId: "",
      issueTypeId: "",
      status: "NOT_FOUND",
      requiredComplexityTier: params.requiredComplexityTier,
      estimatedJobValueCents: params.estimatedJobValueCents,
      supervised: false,
      provisional: false,
      supervisorRequiredOnSite: false,
      mandatorySupervisorSignoff: false,
      failClosedReason: "NO_CAPABILITY_ASSESSMENT_ON_FILE",
      restrictions: [
        "Contractor has no approved technical capability assessment on file for this service scope.",
      ],
      evaluatedAt: isoNow,
    };
  }

  const { assessment, requiredComplexityTier, estimatedJobValueCents } = params;

  // 2. Check expiration against current timestamp
  const isExpired =
    assessment.validUntil != null &&
    new Date(assessment.validUntil).getTime() <= currentTime.getTime();

  if (isExpired || assessment.status === "EXPIRED") {
    return {
      eligible: false,
      contractorId: assessment.contractorId,
      issueTypeId: assessment.issueTypeId,
      status: "EXPIRED",
      approvedComplexityTier: assessment.complexityTier,
      requiredComplexityTier,
      approvedMaxJobValueCents: assessment.maxJobValueCents,
      estimatedJobValueCents,
      supervised: false,
      provisional: false,
      supervisorRequiredOnSite: false,
      mandatorySupervisorSignoff: false,
      failClosedReason: "CAPABILITY_ASSESSMENT_EXPIRED",
      restrictions: [
        `Capability assessment expired on ${assessment.validUntil ?? "unknown date"} and requires re-evaluation.`,
      ],
      evaluatedAt: isoNow,
    };
  }

  // 3. Status Gate: Fail closed on pending, under review, appealed, rejected, or revoked
  if (
    assessment.status !== "APPROVED" &&
    assessment.status !== "PROVISIONAL" &&
    assessment.status !== "SUPERVISED"
  ) {
    let failClosedReason: string;
    switch (assessment.status) {
      case "REJECTED":
        failClosedReason = "CAPABILITY_ASSESSMENT_REJECTED";
        break;
      case "REVOKED":
        failClosedReason = "CAPABILITY_ASSESSMENT_REVOKED";
        break;
      case "SUBMITTED":
      case "UNDER_REVIEW":
      case "APPEALED":
      default:
        failClosedReason = "CAPABILITY_ASSESSMENT_PENDING_REVIEW";
        break;
    }

    return {
      eligible: false,
      contractorId: assessment.contractorId,
      issueTypeId: assessment.issueTypeId,
      status: assessment.status,
      approvedComplexityTier: assessment.complexityTier,
      requiredComplexityTier,
      approvedMaxJobValueCents: assessment.maxJobValueCents,
      estimatedJobValueCents,
      supervised: false,
      provisional: false,
      supervisorRequiredOnSite: false,
      mandatorySupervisorSignoff: false,
      failClosedReason,
      restrictions: [
        `Capability status is ${assessment.status}. Reasons: ${
          assessment.denialReasons.length > 0
            ? assessment.denialReasons.join("; ")
            : "Awaiting qualified assessor review."
        }`,
      ],
      evaluatedAt: isoNow,
    };
  }

  // 4. Complexity Tier Gate: Fail closed if required tier exceeds approved tier
  const approvedRank = COMPLEXITY_TIER_RANK[assessment.complexityTier] ?? 1;
  const requiredRank = COMPLEXITY_TIER_RANK[requiredComplexityTier] ?? 1;

  if (approvedRank < requiredRank) {
    return {
      eligible: false,
      contractorId: assessment.contractorId,
      issueTypeId: assessment.issueTypeId,
      status: assessment.status,
      approvedComplexityTier: assessment.complexityTier,
      requiredComplexityTier,
      approvedMaxJobValueCents: assessment.maxJobValueCents,
      estimatedJobValueCents,
      supervised: false,
      provisional: false,
      supervisorRequiredOnSite: false,
      mandatorySupervisorSignoff: false,
      failClosedReason: "INSUFFICIENT_COMPLEXITY_TIER",
      restrictions: [
        `Service variant requires ${requiredComplexityTier}, but contractor is only approved up to ${assessment.complexityTier}.`,
      ],
      evaluatedAt: isoNow,
    };
  }

  // 5. Financial Scope Ceiling Gate: Fail closed if estimated job value exceeds ceiling
  if (estimatedJobValueCents > assessment.maxJobValueCents) {
    return {
      eligible: false,
      contractorId: assessment.contractorId,
      issueTypeId: assessment.issueTypeId,
      status: assessment.status,
      approvedComplexityTier: assessment.complexityTier,
      requiredComplexityTier,
      approvedMaxJobValueCents: assessment.maxJobValueCents,
      estimatedJobValueCents,
      supervised: false,
      provisional: false,
      supervisorRequiredOnSite: false,
      mandatorySupervisorSignoff: false,
      failClosedReason: "EXCEEDS_MAX_JOB_VALUE_CEILING",
      restrictions: [
        `Estimated contract value ($${(estimatedJobValueCents / 100).toFixed(
          2,
        )}) exceeds contractor's approved maximum job value ceiling ($${(
          assessment.maxJobValueCents / 100
        ).toFixed(2)}).`,
      ],
      evaluatedAt: isoNow,
    };
  }

  // 6. Provisional Job Limit Check
  const restrictions: string[] = [];
  const reqs = assessment.supervisedRequirements ?? {};
  let provisional = false;

  if (assessment.status === "PROVISIONAL") {
    provisional = true;
    if (
      reqs.maxProvisionalJobs != null &&
      (reqs.completedProvisionalJobs ?? 0) >= reqs.maxProvisionalJobs
    ) {
      return {
        eligible: false,
        contractorId: assessment.contractorId,
        issueTypeId: assessment.issueTypeId,
        status: "PROVISIONAL",
        approvedComplexityTier: assessment.complexityTier,
        requiredComplexityTier,
        approvedMaxJobValueCents: assessment.maxJobValueCents,
        estimatedJobValueCents,
        supervised: false,
        provisional: true,
        supervisorRequiredOnSite: false,
        mandatorySupervisorSignoff: false,
        failClosedReason: "PROVISIONAL_JOB_QUOTA_EXCEEDED",
        restrictions: [
          `Provisional job quota reached (${reqs.completedProvisionalJobs}/${reqs.maxProvisionalJobs}). Re-assessment required for full approval.`,
        ],
        evaluatedAt: isoNow,
      };
    }
    restrictions.push(
      `Provisional status: ${reqs.completedProvisionalJobs ?? 0}/${
        reqs.maxProvisionalJobs ?? "unlimited"
      } jobs completed.`,
    );
  }

  // 7. Supervised Safeguards
  const supervised = assessment.status === "SUPERVISED";
  const supervisorRequiredOnSite = supervised
    ? (reqs.supervisorRequiredOnSite ?? true)
    : false;
  const mandatorySupervisorSignoff = supervised
    ? (reqs.mandatorySupervisorSignoff ?? true)
    : false;

  if (supervised) {
    restrictions.push(
      "Supervised approval: On-site qualified supervisor and closeout signoff mandatory.",
    );
  }

  return {
    eligible: true,
    contractorId: assessment.contractorId,
    issueTypeId: assessment.issueTypeId,
    status: assessment.status,
    approvedComplexityTier: assessment.complexityTier,
    requiredComplexityTier,
    approvedMaxJobValueCents: assessment.maxJobValueCents,
    estimatedJobValueCents,
    supervised,
    provisional,
    supervisorRequiredOnSite,
    mandatorySupervisorSignoff,
    restrictions,
    evaluatedAt: isoNow,
  };
}
