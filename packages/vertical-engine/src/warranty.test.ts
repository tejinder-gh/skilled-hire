// packages/vertical-engine/src/warranty.test.ts

import { describe, expect, it } from "vitest";
import {
  calculateWarrantyExpiry,
  calculateWarrantyRecoveryAssessment,
  computeWarrantyTermsDigest,
  evaluateWarrantyStatus,
  generateWarrantyCertificateNumber,
  generateWarrantyClaimNumber,
  getOntarioStatutoryWarrantyTerms,
  triageWarrantyClaimUrgency,
  validateWarrantyClaimTransition,
} from "./warranty.js";

describe("Warranty Engine", () => {
  it("calculates warranty expiry correctly across month boundaries", () => {
    const startDate = "2026-01-15T12:00:00.000Z";
    const expiry12 = calculateWarrantyExpiry(startDate, 12);
    expect(expiry12).toBe("2027-01-15T12:00:00.000Z");

    const expiry24 = calculateWarrantyExpiry(startDate, 24);
    expect(expiry24).toBe("2028-01-15T12:00:00.000Z");

    const expiry6 = calculateWarrantyExpiry(startDate, 6);
    expect(expiry6).toBe("2026-07-15T12:00:00.000Z");
  });

  it("generates structured certificate and claim numbers", () => {
    const certNum = generateWarrantyCertificateNumber(2026);
    expect(certNum).toMatch(/^WAR-2026-[0-9A-F]{8}$/);

    const claimNum = generateWarrantyClaimNumber(2026);
    expect(claimNum).toMatch(/^CLM-2026-[0-9A-F]{8}$/);
  });

  it("computes deterministic digests for immutable warranty terms", () => {
    const payloadA = {
      certificateNumber: "WAR-2026-TEST1234",
      jobId: "00000000-0000-0000-0000-000000000001",
      durationMonths: 12,
      coveredDefects: ["Pipe leaks at soldered joints", "Faulty shutoff valve installation"],
      exclusions: ["Acts of God", "Consumer tampering"],
      statutoryTerms: "Ontario Consumer Protection Act terms",
      responseSlaHours: 48,
    };

    const payloadB = {
      certificateNumber: "WAR-2026-TEST1234",
      jobId: "00000000-0000-0000-0000-000000000001",
      durationMonths: 12,
      // Array order swapped to test normalization
      coveredDefects: ["Faulty shutoff valve installation", "Pipe leaks at soldered joints"],
      exclusions: ["Consumer tampering", "Acts of God"],
      statutoryTerms: "Ontario Consumer Protection Act terms",
      responseSlaHours: 48,
    };

    const digestA = computeWarrantyTermsDigest(payloadA);
    const digestB = computeWarrantyTermsDigest(payloadB);

    expect(digestA).toHaveLength(64);
    expect(digestA).toBe(digestB);

    const payloadC = { ...payloadA, durationMonths: 24 };
    const digestC = computeWarrantyTermsDigest(payloadC);
    expect(digestC).not.toBe(digestA);
  });

  it("triages claim urgency and assigns proper emergency SLAs", () => {
    const baseInput = {
      urgency: "STANDARD" as const,
      title: "Minor paint scuff near vent",
      description: "Paint was touched by installer and flaking off near the vent trim.",
      coveredDefects: ["Vent trim misalignment", "Installation damage to adjoining surfaces"],
      exclusions: ["Cosmetic wear and tear", "Unauthorized modification"],
      responseSlaHours: 48,
      emergencySlaHours: 24,
      filedAt: "2026-03-01T10:00:00.000Z",
    };

    // Standard non-emergency
    const resStandard = triageWarrantyClaimUrgency(baseInput);
    expect(resStandard.urgency).toBe("STANDARD");
    expect(resStandard.covered).toBe(true);
    expect(resStandard.slaHours).toBe(48);
    expect(resStandard.slaDeadline).toBe("2026-03-03T10:00:00.000Z");

    // Emergency no-heat detection
    const resNoHeat = triageWarrantyClaimUrgency({
      ...baseInput,
      title: "Furnace blowing cold air, freezing in house",
      description: "Temperature dropped to 5C overnight after heat pump installation. We have no heat.",
    });
    expect(resNoHeat.urgency).toBe("URGENT_NO_HEAT");
    expect(resNoHeat.covered).toBe(true);
    expect(resNoHeat.slaHours).toBe(24);
    expect(resNoHeat.slaDeadline).toBe("2026-03-02T10:00:00.000Z");

    // Emergency water leak detection
    const resWaterLeak = triageWarrantyClaimUrgency({
      ...baseInput,
      title: "Water leaking under kitchen sink",
      description: "There is an active leak flooding the cabinet floor under the newly installed faucet.",
    });
    expect(resWaterLeak.urgency).toBe("URGENT_WATER_LEAK");
    expect(resWaterLeak.covered).toBe(true);
    expect(resWaterLeak.slaHours).toBe(24);

    // Exclusion detection
    const resExcluded = triageWarrantyClaimUrgency({
      ...baseInput,
      title: "Unauthorized modification by DIY homeowner",
      description: "Homeowner attempted unauthorized modification and stripped the fitting.",
    });
    expect(resExcluded.covered).toBe(false);
    expect(resExcluded.reason).toContain("excluded condition");
  });

  it("evaluates warranty snapshot status over time", () => {
    const activeSnapshot = {
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      status: "ACTIVE" as const,
    };

    expect(evaluateWarrantyStatus(activeSnapshot, new Date("2026-06-01T00:00:00.000Z"))).toBe("ACTIVE");
    expect(evaluateWarrantyStatus(activeSnapshot, new Date("2027-06-01T00:00:00.000Z"))).toBe("EXPIRED");

    const voidedSnapshot = {
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      status: "VOIDED_TAMPERING" as const,
    };
    expect(evaluateWarrantyStatus(voidedSnapshot, new Date("2026-06-01T00:00:00.000Z"))).toBe("VOIDED_TAMPERING");
  });

  it("provides statutory Ontario warranty terms", () => {
    const terms = getOntarioStatutoryWarrantyTerms();
    expect(terms).toContain("ONTARIO STATUTORY WORKMANSHIP WARRANTY");
    expect(terms).toContain("Consumer Protection Act, 2002");
    expect(terms).toContain("Right to Cure");
    expect(terms).toContain("recovery ledger");
  });

  it("enforces warranty claim lifecycle transitions", () => {
    expect(validateWarrantyClaimTransition("FILED", "TRIAGED_COVERED").valid).toBe(true);
    expect(validateWarrantyClaimTransition("TRIAGED_COVERED", "CONTRACTOR_INSPECTING").valid).toBe(true);
    expect(validateWarrantyClaimTransition("CONTRACTOR_INSPECTING", "REMEDIATION_SCHEDULED").valid).toBe(true);
    expect(validateWarrantyClaimTransition("REMEDIATION_SCHEDULED", "REMEDIATED").valid).toBe(true);
    expect(validateWarrantyClaimTransition("REMEDIATED", "CLOSED").valid).toBe(true);

    // Escalation allowed from inspecting
    expect(validateWarrantyClaimTransition("CONTRACTOR_INSPECTING", "ESCALATED_DISPUTE").valid).toBe(true);

    // Invalid transition
    const invalid = validateWarrantyClaimTransition("FILED", "REMEDIATED");
    expect(invalid.valid).toBe(false);
    expect(invalid.error).toContain("Invalid warranty claim status transition");
  });

  it("assesses recovery ledger requirements accurately", () => {
    // When contractor accepted and cured
    const assessmentA = calculateWarrantyRecoveryAssessment({
      originalContractorAccepted: true,
      fallbackRemediationCostCents: 50000,
    });
    expect(assessmentA.recoveryRequired).toBe(false);
    expect(assessmentA.recoveryAmountCents).toBe(0);

    // When contractor refused/disputed and fallback contractor was paid
    const assessmentB = calculateWarrantyRecoveryAssessment({
      originalContractorAccepted: false,
      fallbackRemediationCostCents: 75000,
    });
    expect(assessmentB.recoveryRequired).toBe(true);
    expect(assessmentB.recoveryAmountCents).toBe(75000);
    expect(assessmentB.recoveryReason).toContain("fallback contractor");
  });
});
