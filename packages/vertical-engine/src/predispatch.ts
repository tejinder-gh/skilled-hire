import type {
  BookingUrgency,
  CapabilityAssessmentStatus,
  ComplexityTier,
  CredentialStatus,
  EvidenceSnapshot,
  PreDispatchDenyCode,
  PreDispatchEvaluationResult,
  PreWorkCheckResult,
  TradeRegulatoryPolicy,
  WorkerIdentityMethod,
} from "@marketplace/contracts";
import { evaluateRegulatoryEligibility } from "./regulatory.js";
import { evaluateContractorCapability } from "./capability.js";

export interface PreDispatchServiceRequestInput {
  id: string;
  verticalId: string;
  verticalSlug: string;
  categoryId?: string | null | undefined;
  categorySlug?: string | null | undefined;
  issueTypeId?: string | null | undefined;
  variantSlug?: string | null | undefined;
  urgency: BookingUrgency;
  region: string;
  estimatedJobValueCents?: number | undefined;
  requiredComplexityTier?: ComplexityTier | undefined;
}

export interface PreDispatchContractorInput {
  id: string;
  name: string;
  status: string;
  verticalIds: string[];
  safetyStatus?: string | undefined;
  activeQuarantines?:
    | Array<{
        quarantineType: string;
        restrictedVerticalIds: string[];
        restrictedIssueTypeIds: string[];
      }>
    | undefined;
}

export interface PreDispatchTechnicianInput {
  id: string;
  contractorId: string;
  displayName: string;
  active: boolean;
  safetyStatus?: string | undefined;
}

export interface PreDispatchCredentialInput {
  id: string;
  code: string;
  geography: string;
  status: CredentialStatus;
  verificationSource?: string | null | undefined;
  regulatorReference?: string | null | undefined;
  expiryDate?: string | null | undefined;
  checkedAt?: string | null | undefined;
}

export interface PreDispatchCapabilityAssessmentInput {
  id: string;
  contractorId: string;
  issueTypeId: string;
  geography: string;
  status: CapabilityAssessmentStatus;
  complexityTier: ComplexityTier;
  maxJobValueCents: number;
  validUntil?: string | null | undefined;
  supervisedRequirements?: {
    supervisorTechnicianId?: string | null | undefined;
    supervisorRequiredOnSite?: boolean | undefined;
    mandatorySupervisorSignoff?: boolean | undefined;
    maxProvisionalJobs?: number | null | undefined;
    completedProvisionalJobs?: number | undefined;
  } | null | undefined;
}

export interface EvaluatePreDispatchParams {
  serviceRequest: PreDispatchServiceRequestInput;
  contractor: PreDispatchContractorInput;
  technician: PreDispatchTechnicianInput;
  contractorCredentials: PreDispatchCredentialInput[];
  technicianCredentials: PreDispatchCredentialInput[];
  regulatoryPolicy?: TradeRegulatoryPolicy | null | undefined;
  capabilityAssessment?: PreDispatchCapabilityAssessmentInput | null | undefined;
  now?: Date | undefined;
}

export function evaluatePreDispatchEligibility(
  params: EvaluatePreDispatchParams,
): PreDispatchEvaluationResult {
  const now = params.now ?? new Date();
  const denyCodes: PreDispatchDenyCode[] = [];
  const reasons: string[] = [];

  const {
    serviceRequest,
    contractor,
    technician,
    contractorCredentials,
    technicianCredentials,
    regulatoryPolicy,
    capabilityAssessment,
  } = params;

  // 1. Company Status & Vertical Authorization
  if (contractor.status !== "VERIFIED") {
    denyCodes.push("CONTRACTOR_NOT_VERIFIED");
    reasons.push(`Contractor status is '${contractor.status}'; must be 'VERIFIED'.`);
  }

  if (!contractor.verticalIds.includes(serviceRequest.verticalId)) {
    denyCodes.push("CONTRACTOR_COMPANY_MISMATCH");
    reasons.push(
      `Contractor is not approved for service vertical '${serviceRequest.verticalSlug}' (${serviceRequest.verticalId}).`,
    );
  }

  // 1b. Safety Sanctions & Quarantine Governance (#58)
  if (contractor.safetyStatus === "SUSPENDED") {
    denyCodes.push("CONTRACTOR_SAFETY_SUSPENDED");
    reasons.push(
      `Contractor '${contractor.id}' is under active safety suspension.`,
    );
  }

  if (technician.safetyStatus === "SUSPENDED") {
    denyCodes.push("TECHNICIAN_SAFETY_SUSPENDED");
    reasons.push(
      `Technician '${technician.id}' is under active safety suspension.`,
    );
  }

  if (contractor.activeQuarantines && contractor.activeQuarantines.length > 0) {
    for (const q of contractor.activeQuarantines) {
      if (q.quarantineType === "FULL_CONTRACTOR_SUSPENSION") {
        if (!denyCodes.includes("CONTRACTOR_SAFETY_SUSPENDED")) {
          denyCodes.push("CONTRACTOR_SAFETY_SUSPENDED");
          reasons.push(
            `Contractor '${contractor.id}' is subject to an active safety quarantine suspension order.`,
          );
        }
      }
      if (q.quarantineType === "VERTICAL_SCOPE_RESTRICTION") {
        const verticalBlocked = q.restrictedVerticalIds.includes(
          serviceRequest.verticalId,
        );
        const issueBlocked =
          Boolean(serviceRequest.issueTypeId) &&
          q.restrictedIssueTypeIds.includes(serviceRequest.issueTypeId!);
        if (verticalBlocked || issueBlocked) {
          if (!denyCodes.includes("CONTRACTOR_QUARANTINED_SCOPE")) {
            denyCodes.push("CONTRACTOR_QUARANTINED_SCOPE");
            reasons.push(
              `Contractor '${contractor.id}' is safety-quarantined for vertical '${serviceRequest.verticalSlug}' or requested variant.`,
            );
          }
        }
      }
    }
  }

  // 2. Direct Technician Employment & Active Status (Anti-Subcontracting / Tenant Isolation)
  if (technician.contractorId !== contractor.id) {
    denyCodes.push("UNAUTHORIZED_WORKER_SUBSTITUTION");
    reasons.push(
      `Technician '${technician.id}' is employed by contractor '${technician.contractorId}', not assigned contractor '${contractor.id}'. Unauthorized subcontracting or worker substitution prohibited.`,
    );
  }

  if (!technician.active) {
    denyCodes.push("TECHNICIAN_NOT_ACTIVE");
    reasons.push(`Technician '${technician.id}' (${technician.displayName}) is currently marked inactive.`);
  }

  // 3. Trade Regulatory Eligibility (Ontario / Multi-Jurisdiction)
  const verifiedContractorCodes = contractorCredentials
    .filter(
      (c) =>
        c.status === "VERIFIED" &&
        (!c.expiryDate || new Date(c.expiryDate) >= now),
    )
    .map((c) => c.code);
  const verifiedTechnicianCodes = technicianCredentials
    .filter(
      (t) =>
        t.status === "VERIFIED" &&
        (!t.expiryDate || new Date(t.expiryDate) >= now),
    )
    .map((t) => t.code);

  if (regulatoryPolicy) {
    const regResult = evaluateRegulatoryEligibility({
      policy: regulatoryPolicy,
      contractorCredentials: contractorCredentials.map((c) => ({
        ...c,
        verificationSource: (c.verificationSource as any) ?? "REGULATOR_API",
        regulatorReference: c.regulatorReference ?? null,
        expiryDate: c.expiryDate ?? null,
        checkedAt: c.checkedAt ?? now.toISOString(),
      })),
      technicianCredentials: technicianCredentials.map((t) => ({
        ...t,
        verificationSource: (t.verificationSource as any) ?? "REGULATOR_API",
        regulatorReference: t.regulatorReference ?? null,
        expiryDate: t.expiryDate ?? null,
        checkedAt: t.checkedAt ?? now.toISOString(),
      })),
      isApprentice: false,
      asOfDate: now,
    });

    if (!regResult.eligible) {
      denyCodes.push("REGULATORY_POLICY_DEFICIENCY");
      reasons.push(...regResult.reasons);
    }
  }

  // Check for expired credentials amongst relevant credentials
  const allCreds = [...contractorCredentials, ...technicianCredentials];
  const expiredCreds = allCreds.filter(
    (c) => c.expiryDate && new Date(c.expiryDate) < now,
  );
  if (
    expiredCreds.length > 0 &&
    !denyCodes.includes("REGULATORY_CREDENTIAL_LAPSED")
  ) {
    denyCodes.push("REGULATORY_CREDENTIAL_LAPSED");
    reasons.push(
      `Credentials expired before dispatch: ${expiredCreds
        .map((c) => `${c.code} (expired ${c.expiryDate})`)
        .join(", ")}`,
    );
  }

  // 4. Contractor Technical Capability Assessment (Gate 0 Scope Isolation)
  let capabilityDetails: EvidenceSnapshot["capabilityAssessment"] = null;
  let requiresSupervisorOnSite = false;
  let mandatorySupervisorSignoff = false;

  if (serviceRequest.issueTypeId) {
    if (!capabilityAssessment) {
      denyCodes.push("CAPABILITY_NOT_FOUND");
      reasons.push(
        `No approved capability assessment on file for contractor '${contractor.id}' on variant '${serviceRequest.variantSlug ?? serviceRequest.issueTypeId}'.`,
      );
    } else {
      const capResult = evaluateContractorCapability({
        assessment: {
          id: capabilityAssessment.id,
          contractorId: capabilityAssessment.contractorId,
          issueTypeId: capabilityAssessment.issueTypeId,
          geography: capabilityAssessment.geography,
          status: capabilityAssessment.status,
          complexityTier: capabilityAssessment.complexityTier,
          yearsExperience: 5,
          maxJobValueCents: capabilityAssessment.maxJobValueCents,
          workSamples: [],
          references: [],
          toolsEquipment: [],
          supervisedRequirements: capabilityAssessment.supervisedRequirements,
          denialReasons: [],
          appealHistory: [],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          validUntil: capabilityAssessment.validUntil ?? undefined,
        },
        requiredComplexityTier: serviceRequest.requiredComplexityTier ?? "TIER_1_BASIC",
        estimatedJobValueCents: serviceRequest.estimatedJobValueCents ?? 0,
        now,
      });

      if (!capResult.eligible) {
        if (capResult.failClosedReason === "NO_CAPABILITY_ASSESSMENT_ON_FILE") {
          denyCodes.push("CAPABILITY_NOT_FOUND");
        } else if (capResult.failClosedReason === "INSUFFICIENT_COMPLEXITY_TIER") {
          denyCodes.push("INSUFFICIENT_COMPLEXITY_TIER");
        } else if (capResult.failClosedReason === "EXCEEDS_MAX_JOB_VALUE_CEILING") {
          denyCodes.push("EXCEEDS_MAX_JOB_VALUE_CEILING");
        } else if (capResult.failClosedReason === "CAPABILITY_ASSESSMENT_EXPIRED") {
          denyCodes.push("REGULATORY_CREDENTIAL_LAPSED");
        } else {
          denyCodes.push("CAPABILITY_ASSESSMENT_NOT_APPROVED");
        }
        reasons.push(
          `Capability evaluation failed: ${capResult.restrictions.join("; ")}`,
        );
      }

      // Check variant scope match
      if (capabilityAssessment.issueTypeId !== serviceRequest.issueTypeId) {
        denyCodes.push("CAPABILITY_SCOPE_MISMATCH");
        reasons.push(
          `Capability assessment is scoped to issue type '${capabilityAssessment.issueTypeId}', but requested '${serviceRequest.issueTypeId}'.`,
        );
      }

      if (capResult.supervisorRequiredOnSite) {
        requiresSupervisorOnSite = true;
      }
      if (capResult.mandatorySupervisorSignoff) {
        mandatorySupervisorSignoff = true;
      }

      capabilityDetails = {
        assessmentId: capabilityAssessment.id,
        status: capabilityAssessment.status,
        complexityTier: capabilityAssessment.complexityTier,
        maxJobValueCents: capabilityAssessment.maxJobValueCents,
        validUntil: capabilityAssessment.validUntil ?? null,
        supervised: capResult.supervised,
        provisional: capResult.provisional,
      };
    }
  }

  // 5. Build Immutable Evidence Snapshot
  const evidenceSnapshot: EvidenceSnapshot = {
    snapshotVersion: 1,
    capturedAt: now.toISOString(),
    regulatoryPolicy: regulatoryPolicy
      ? {
          policyId: regulatoryPolicy.id,
          policyVersion: regulatoryPolicy.policyVersion,
          verticalSlug: regulatoryPolicy.verticalSlug,
          categorySlug: regulatoryPolicy.categorySlug,
          variantSlug: regulatoryPolicy.variantSlug,
          geography: regulatoryPolicy.geography,
          verifiedContractorCredentialCodes: verifiedContractorCodes,
          verifiedTechnicianCredentialCodes: verifiedTechnicianCodes,
        }
      : null,
    capabilityAssessment: capabilityDetails,
    contractor: {
      contractorId: contractor.id,
      companyName: contractor.name,
      status: contractor.status,
    },
    technician: {
      technicianId: technician.id,
      displayName: technician.displayName,
      active: technician.active,
      credentials: technicianCredentials.map((c) => ({
        code: c.code,
        status: c.status,
        expiryDate: c.expiryDate ?? null,
      })),
    },
    jurisdiction: serviceRequest.region,
    serviceScope: {
      verticalId: serviceRequest.verticalId,
      verticalSlug: serviceRequest.verticalSlug,
      categoryId: serviceRequest.categoryId ?? null,
      categorySlug: serviceRequest.categorySlug ?? null,
      issueTypeId: serviceRequest.issueTypeId ?? null,
      variantSlug: serviceRequest.variantSlug ?? null,
      urgency: serviceRequest.urgency,
    },
  };

  const eligible = denyCodes.length === 0;

  return {
    eligible,
    serviceRequestId: serviceRequest.id,
    contractorId: contractor.id,
    technicianId: technician.id,
    failClosedReason: eligible ? undefined : reasons.join(" "),
    denyCodes,
    evidenceSnapshot,
    requiresSupervisorOnSite,
    mandatorySupervisorSignoff,
    evaluatedAt: now.toISOString(),
  };
}

export interface EvaluatePreWorkCommencementParams {
  job: {
    id: string;
    contractorId: string;
    technicianId: string;
    workerIdentityVerified: boolean;
    workerIdentityMethod?: WorkerIdentityMethod | null | undefined;
    evidenceSnapshot: EvidenceSnapshot;
  };
  attemptingTechnicianId: string;
  technicianCredentials: PreDispatchCredentialInput[];
  now?: Date | undefined;
}

export function evaluatePreWorkCommencement(
  params: EvaluatePreWorkCommencementParams,
): PreWorkCheckResult {
  const now = params.now ?? new Date();
  const denyCodes: PreDispatchDenyCode[] = [];
  const reasons: string[] = [];

  const { job, attemptingTechnicianId, technicianCredentials } = params;

  // 1. Worker Identity Verification check
  if (!job.workerIdentityVerified) {
    denyCodes.push("WORKER_IDENTITY_UNVERIFIED");
    reasons.push(
      "Worker identity must be verified (photo ID or dispatcher override) before work commences on-site.",
    );
  }

  // 2. Worker Substitution Check (Assigned tech must match technician on-site)
  if (attemptingTechnicianId !== job.technicianId) {
    denyCodes.push("UNAUTHORIZED_WORKER_SUBSTITUTION");
    reasons.push(
      `Technician attempting work '${attemptingTechnicianId}' does not match assigned technician '${job.technicianId}'. Unauthorized substitution prohibited.`,
    );
  }

  // 3. Live Credential Expiration Recheck (detect any credential that lapsed post-dispatch)
  const snapshotTechCredCodes =
    job.evidenceSnapshot.regulatoryPolicy?.verifiedTechnicianCredentialCodes ?? [];
  for (const code of snapshotTechCredCodes) {
    const validCred = technicianCredentials.find(
      (c) =>
        c.code === code &&
        c.status === "VERIFIED" &&
        (!c.expiryDate || new Date(c.expiryDate) >= now),
    );
    if (!validCred) {
      const anyCred = technicianCredentials.find((c) => c.code === code);
      if (anyCred?.expiryDate && new Date(anyCred.expiryDate) < now) {
        denyCodes.push("REGULATORY_CREDENTIAL_LAPSED");
        reasons.push(
          `Technician credential '${code}' lapsed on ${anyCred.expiryDate} before work commenced.`,
        );
      } else {
        denyCodes.push("REGULATORY_CREDENTIAL_LAPSED");
        reasons.push(
          `Technician credential '${code}' is no longer verified (status: ${anyCred?.status ?? "MISSING"}).`,
        );
      }
    }
  }

  const allowedToCommence = denyCodes.length === 0;

  return {
    allowedToCommence,
    jobId: job.id,
    workerIdentityVerified: job.workerIdentityVerified,
    workerIdentityMethod: job.workerIdentityMethod ?? null,
    failClosedReason: allowedToCommence ? undefined : reasons.join(" "),
    denyCodes,
    evaluatedAt: now.toISOString(),
  };
}
