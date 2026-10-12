import { describe, expect, it } from "vitest";
import type { ContractorCapabilityAssessment } from "@marketplace/contracts";
import { evaluateContractorCapability } from "./capability.js";

describe("Contractor Technical Capability Evaluator", () => {
  const baseAssessment: ContractorCapabilityAssessment = {
    id: "assess-1",
    contractorId: "contractor-1",
    issueTypeId: "issue-type-1",
    geography: "ON",
    status: "APPROVED",
    complexityTier: "TIER_3_ADVANCED",
    yearsExperience: 8,
    maxJobValueCents: 1_000_000, // $10,000
    workSamples: [
      {
        id: "ws-1",
        title: "200A Electrical Panel Upgrade",
        description:
          "Replaced 100A fuse box with 200A breaker panel with ESA permit",
        completedAt: "2025-06-15",
        verified: true,
      },
    ],
    references: [
      {
        id: "ref-1",
        clientName: "Alice Smith",
        clientContact: "555-0199",
        projectScope: "Main service panel upgrade",
        relationship: "Customer",
        verified: true,
      },
    ],
    toolsEquipment: [
      {
        toolName: "Insulated hand tools 1000V",
        ownedOrLeased: true,
        verified: true,
      },
      {
        toolName: "Digital Multimeter CAT IV",
        ownedOrLeased: true,
        verified: true,
      },
    ],
    supervisedRequirements: null,
    denialReasons: [],
    assessedByUserId: "assessor-1",
    assessedAt: "2025-07-01T10:00:00.000Z",
    validUntil: "2027-07-01T10:00:00.000Z",
    decisionNotes:
      "Demonstrated superior technical ability and code compliance.",
    appealHistory: [],
    createdAt: "2025-06-20T10:00:00.000Z",
    updatedAt: "2025-07-01T10:00:00.000Z",
  };

  it("fails closed when no assessment is on file", () => {
    const result = evaluateContractorCapability({
      assessment: null,
      requiredComplexityTier: "TIER_2_STANDARD",
      estimatedJobValueCents: 250_000,
    });

    expect(result.eligible).toBe(false);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.failClosedReason).toBe("NO_CAPABILITY_ASSESSMENT_ON_FILE");
    expect(result.restrictions[0]).toContain(
      "no approved technical capability assessment",
    );
  });

  it("approves qualified assessment when tier, value, and validity pass", () => {
    const result = evaluateContractorCapability({
      assessment: baseAssessment,
      requiredComplexityTier: "TIER_2_STANDARD",
      estimatedJobValueCents: 500_000,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result.eligible).toBe(true);
    expect(result.status).toBe("APPROVED");
    expect(result.approvedComplexityTier).toBe("TIER_3_ADVANCED");
    expect(result.supervised).toBe(false);
    expect(result.provisional).toBe(false);
    expect(result.failClosedReason).toBeUndefined();
  });

  it("fails closed when assessment has expired", () => {
    const result = evaluateContractorCapability({
      assessment: baseAssessment,
      requiredComplexityTier: "TIER_1_BASIC",
      estimatedJobValueCents: 100_000,
      now: new Date("2028-01-01T00:00:00.000Z"), // Past 2027-07-01
    });

    expect(result.eligible).toBe(false);
    expect(result.status).toBe("EXPIRED");
    expect(result.failClosedReason).toBe("CAPABILITY_ASSESSMENT_EXPIRED");
    expect(result.restrictions[0]).toContain("expired");
  });

  it("fails closed when status is SUBMITTED or UNDER_REVIEW", () => {
    const result = evaluateContractorCapability({
      assessment: { ...baseAssessment, status: "UNDER_REVIEW" },
      requiredComplexityTier: "TIER_1_BASIC",
      estimatedJobValueCents: 100_000,
    });

    expect(result.eligible).toBe(false);
    expect(result.status).toBe("UNDER_REVIEW");
    expect(result.failClosedReason).toBe(
      "CAPABILITY_ASSESSMENT_PENDING_REVIEW",
    );
  });

  it("fails closed when status is REJECTED with denial reasons", () => {
    const result = evaluateContractorCapability({
      assessment: {
        ...baseAssessment,
        status: "REJECTED",
        denialReasons: ["MISSING_MANDATORY_TOOLS", "UNVERIFIED_WORK_SAMPLES"],
      },
      requiredComplexityTier: "TIER_1_BASIC",
      estimatedJobValueCents: 100_000,
    });

    expect(result.eligible).toBe(false);
    expect(result.status).toBe("REJECTED");
    expect(result.failClosedReason).toBe("CAPABILITY_ASSESSMENT_REJECTED");
    expect(result.restrictions[0]).toContain("MISSING_MANDATORY_TOOLS");
  });

  it("fails closed when required complexity exceeds approved tier", () => {
    const result = evaluateContractorCapability({
      assessment: { ...baseAssessment, complexityTier: "TIER_2_STANDARD" },
      requiredComplexityTier: "TIER_4_SPECIALIZED",
      estimatedJobValueCents: 500_000,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result.eligible).toBe(false);
    expect(result.failClosedReason).toBe("INSUFFICIENT_COMPLEXITY_TIER");
    expect(result.restrictions[0]).toContain(
      "requires TIER_4_SPECIALIZED, but contractor is only approved up to TIER_2_STANDARD",
    );
  });

  it("fails closed when job value exceeds approved max ceiling", () => {
    const result = evaluateContractorCapability({
      assessment: baseAssessment, // maxJobValueCents = 1,000,000 ($10,000)
      requiredComplexityTier: "TIER_2_STANDARD",
      estimatedJobValueCents: 1_500_000, // $15,000
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result.eligible).toBe(false);
    expect(result.failClosedReason).toBe("EXCEEDS_MAX_JOB_VALUE_CEILING");
    expect(result.restrictions[0]).toContain(
      "exceeds contractor's approved maximum job value ceiling",
    );
  });

  it("enforces supervised restrictions for SUPERVISED approval", () => {
    const result = evaluateContractorCapability({
      assessment: {
        ...baseAssessment,
        status: "SUPERVISED",
        supervisedRequirements: {
          supervisorRequiredOnSite: true,
          mandatorySupervisorSignoff: true,
        },
      },
      requiredComplexityTier: "TIER_2_STANDARD",
      estimatedJobValueCents: 300_000,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    expect(result.eligible).toBe(true);
    expect(result.status).toBe("SUPERVISED");
    expect(result.supervised).toBe(true);
    expect(result.supervisorRequiredOnSite).toBe(true);
    expect(result.mandatorySupervisorSignoff).toBe(true);
    expect(result.restrictions[0]).toContain("Supervised approval");
  });

  it("enforces provisional job limit quota", () => {
    // Under quota: eligible
    const eligibleResult = evaluateContractorCapability({
      assessment: {
        ...baseAssessment,
        status: "PROVISIONAL",
        supervisedRequirements: {
          maxProvisionalJobs: 5,
          completedProvisionalJobs: 2,
        },
      },
      requiredComplexityTier: "TIER_2_STANDARD",
      estimatedJobValueCents: 300_000,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });
    expect(eligibleResult.eligible).toBe(true);
    expect(eligibleResult.provisional).toBe(true);

    // Over quota: fails closed
    const quotaExceededResult = evaluateContractorCapability({
      assessment: {
        ...baseAssessment,
        status: "PROVISIONAL",
        supervisedRequirements: {
          maxProvisionalJobs: 5,
          completedProvisionalJobs: 5,
        },
      },
      requiredComplexityTier: "TIER_2_STANDARD",
      estimatedJobValueCents: 300_000,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });
    expect(quotaExceededResult.eligible).toBe(false);
    expect(quotaExceededResult.failClosedReason).toBe(
      "PROVISIONAL_JOB_QUOTA_EXCEEDED",
    );
  });
});
