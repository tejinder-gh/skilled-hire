import { describe, expect, it } from "vitest";
import type { TradeRegulatoryPolicy } from "@marketplace/contracts";
import {
  evaluatePreDispatchEligibility,
  evaluatePreWorkCommencement,
} from "./predispatch.js";

const now = new Date("2026-10-12T12:00:00.000Z");
const validExpiry = "2027-10-12T00:00:00.000Z";
const lapsedExpiry = "2026-10-01T00:00:00.000Z";

const mockPolicy: TradeRegulatoryPolicy = {
  id: "policy-1",
  verticalSlug: "electrical",
  categorySlug: "panel-services",
  variantSlug: "panel-replacement-200a",
  geography: "ON",
  policyVersion: 1,
  contractorMandatoryCodes: ["ECRA_ESA_LICENSE"],
  technicianMandatoryCodes: ["309A_ELECTRICIAN_C_OF_Q"],
  apprenticeEligible: false,
  supervisorRatio: "1:1",
  permitRequired: true,
  inspectionAuthority: "Electrical Safety Authority (ESA)",
  legalAuthorityDisclaimer: "Work must be performed by a licensed electrical contractor.",
  active: true,
};

describe("Pre-Dispatch Eligibility Evaluator", () => {
  const baseServiceRequest = {
    id: "req-1",
    verticalId: "vert-elec",
    verticalSlug: "electrical",
    categoryId: "cat-panel",
    categorySlug: "panel-services",
    issueTypeId: "var-200a",
    variantSlug: "panel-replacement-200a",
    urgency: "STANDARD" as const,
    region: "ON",
    estimatedJobValueCents: 450000,
    requiredComplexityTier: "TIER_2_STANDARD" as const,
  };

  const baseContractor = {
    id: "cont-1",
    name: "Apex Volt Electric Inc.",
    status: "VERIFIED",
    verticalIds: ["vert-elec"],
  };

  const baseTechnician = {
    id: "tech-1",
    contractorId: "cont-1",
    displayName: "Jane Spark",
    active: true,
  };

  const baseContractorCreds = [
    {
      id: "cred-c1",
      code: "ECRA_ESA_LICENSE",
      geography: "ON",
      status: "VERIFIED" as const,
      verificationSource: "REGULATOR_API",
      expiryDate: validExpiry,
    },
  ];

  const baseTechnicianCreds = [
    {
      id: "cred-t1",
      code: "309A_ELECTRICIAN_C_OF_Q",
      geography: "ON",
      status: "VERIFIED" as const,
      verificationSource: "REGULATOR_API",
      expiryDate: validExpiry,
    },
  ];

  const baseCapability = {
    id: "cap-1",
    contractorId: "cont-1",
    issueTypeId: "var-200a",
    geography: "ON",
    status: "APPROVED" as const,
    complexityTier: "TIER_3_ADVANCED" as const,
    maxJobValueCents: 1000000,
    validUntil: validExpiry,
  };

  it("passes completely when contractor, technician, policy, and capability match", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: baseContractor,
      technician: baseTechnician,
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: baseCapability,
      now,
    });

    expect(result.eligible).toBe(true);
    expect(result.denyCodes).toHaveLength(0);
    expect(result.failClosedReason).toBeUndefined();
    expect(result.evidenceSnapshot.regulatoryPolicy?.policyId).toBe("policy-1");
    expect(result.evidenceSnapshot.contractor.contractorId).toBe("cont-1");
    expect(result.evidenceSnapshot.technician.technicianId).toBe("tech-1");
  });

  it("fails closed when contractor status is not VERIFIED", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: { ...baseContractor, status: "SUSPENDED" },
      technician: baseTechnician,
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: baseCapability,
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("CONTRACTOR_NOT_VERIFIED");
  });

  it("fails closed when technician belongs to another contractor (unauthorized substitution)", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: baseContractor,
      technician: { ...baseTechnician, contractorId: "cont-OTHER" },
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: baseCapability,
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("UNAUTHORIZED_WORKER_SUBSTITUTION");
  });

  it("fails closed when technician is inactive", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: baseContractor,
      technician: { ...baseTechnician, active: false },
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: baseCapability,
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("TECHNICIAN_NOT_ACTIVE");
  });

  it("fails closed when regulatory policy requirements are deficient", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: baseContractor,
      technician: baseTechnician,
      contractorCredentials: [], // Missing ECRA license
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: baseCapability,
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("REGULATORY_POLICY_DEFICIENCY");
  });

  it("fails closed when credential expired prior to dispatch", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: baseContractor,
      technician: baseTechnician,
      contractorCredentials: [
        {
          ...baseContractorCreds[0]!,
          expiryDate: lapsedExpiry,
        },
      ],
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: baseCapability,
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("REGULATORY_CREDENTIAL_LAPSED");
  });

  it("fails closed when no capability assessment is on file for the variant", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: baseContractor,
      technician: baseTechnician,
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: null,
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("CAPABILITY_NOT_FOUND");
  });

  it("fails closed when required complexity tier exceeds approved tier", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: {
        ...baseServiceRequest,
        requiredComplexityTier: "TIER_4_SPECIALIZED",
      },
      contractor: baseContractor,
      technician: baseTechnician,
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: {
        ...baseCapability,
        complexityTier: "TIER_2_STANDARD",
      },
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("INSUFFICIENT_COMPLEXITY_TIER");
  });

  it("fails closed when job value exceeds financial ceiling", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: {
        ...baseServiceRequest,
        estimatedJobValueCents: 1500000,
      },
      contractor: baseContractor,
      technician: baseTechnician,
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: {
        ...baseCapability,
        maxJobValueCents: 500000,
      },
      now,
    });

    expect(result.eligible).toBe(false);
    expect(result.denyCodes).toContain("EXCEEDS_MAX_JOB_VALUE_CEILING");
  });

  it("enforces supervised requirement flags when capability status is SUPERVISED", () => {
    const result = evaluatePreDispatchEligibility({
      serviceRequest: baseServiceRequest,
      contractor: baseContractor,
      technician: baseTechnician,
      contractorCredentials: baseContractorCreds,
      technicianCredentials: baseTechnicianCreds,
      regulatoryPolicy: mockPolicy,
      capabilityAssessment: {
        ...baseCapability,
        status: "SUPERVISED",
        supervisedRequirements: {
          supervisorTechnicianId: "tech-senior-1",
          supervisorRequiredOnSite: true,
          mandatorySupervisorSignoff: true,
        },
      },
      now,
    });

    expect(result.eligible).toBe(true);
    expect(result.requiresSupervisorOnSite).toBe(true);
    expect(result.mandatorySupervisorSignoff).toBe(true);
    expect(result.evidenceSnapshot.capabilityAssessment?.supervised).toBe(true);
  });
});

describe("Pre-Work Commencement Evaluator", () => {
  const baseSnapshot = {
    snapshotVersion: 1,
    capturedAt: now.toISOString(),
    regulatoryPolicy: {
      policyId: "policy-1",
      policyVersion: 1,
      verticalSlug: "electrical",
      geography: "ON",
      verifiedContractorCredentialCodes: ["ECRA_ESA_LICENSE"],
      verifiedTechnicianCredentialCodes: ["309A_ELECTRICIAN_C_OF_Q"],
    },
    capabilityAssessment: {
      assessmentId: "cap-1",
      status: "APPROVED" as const,
      complexityTier: "TIER_3_ADVANCED" as const,
      maxJobValueCents: 1000000,
      supervised: false,
      provisional: false,
    },
    contractor: {
      contractorId: "cont-1",
      companyName: "Apex Volt Electric Inc.",
      status: "VERIFIED",
    },
    technician: {
      technicianId: "tech-1",
      displayName: "Jane Spark",
      active: true,
      credentials: [
        {
          code: "309A_ELECTRICIAN_C_OF_Q",
          status: "VERIFIED" as const,
          expiryDate: validExpiry,
        },
      ],
    },
    jurisdiction: "ON",
    serviceScope: {
      verticalId: "vert-elec",
    },
  };

  const baseJob = {
    id: "job-1",
    contractorId: "cont-1",
    technicianId: "tech-1",
    workerIdentityVerified: true,
    workerIdentityMethod: "GOVT_PHOTO_ID" as const,
    evidenceSnapshot: baseSnapshot,
  };

  const liveTechCreds = [
    {
      id: "cred-live-1",
      code: "309A_ELECTRICIAN_C_OF_Q",
      geography: "ON",
      status: "VERIFIED" as const,
      expiryDate: validExpiry,
    },
  ];

  it("authorizes work to commence when identity is verified and credentials remain valid", () => {
    const result = evaluatePreWorkCommencement({
      job: baseJob,
      attemptingTechnicianId: "tech-1",
      technicianCredentials: liveTechCreds,
      now,
    });

    expect(result.allowedToCommence).toBe(true);
    expect(result.denyCodes).toHaveLength(0);
  });

  it("fails closed when worker identity has not been verified", () => {
    const result = evaluatePreWorkCommencement({
      job: {
        ...baseJob,
        workerIdentityVerified: false,
        workerIdentityMethod: null,
      },
      attemptingTechnicianId: "tech-1",
      technicianCredentials: liveTechCreds,
      now,
    });

    expect(result.allowedToCommence).toBe(false);
    expect(result.denyCodes).toContain("WORKER_IDENTITY_UNVERIFIED");
  });

  it("fails closed when a different technician attempts to commence work (worker substitution)", () => {
    const result = evaluatePreWorkCommencement({
      job: baseJob,
      attemptingTechnicianId: "tech-SUBSTITUTE",
      technicianCredentials: liveTechCreds,
      now,
    });

    expect(result.allowedToCommence).toBe(false);
    expect(result.denyCodes).toContain("UNAUTHORIZED_WORKER_SUBSTITUTION");
  });

  it("fails closed when a credential lapsed between dispatch and commencement", () => {
    const result = evaluatePreWorkCommencement({
      job: baseJob,
      attemptingTechnicianId: "tech-1",
      technicianCredentials: [
        {
          ...liveTechCreds[0]!,
          expiryDate: lapsedExpiry, // credential expired in the interim
        },
      ],
      now,
    });

    expect(result.allowedToCommence).toBe(false);
    expect(result.denyCodes).toContain("REGULATORY_CREDENTIAL_LAPSED");
  });
});
