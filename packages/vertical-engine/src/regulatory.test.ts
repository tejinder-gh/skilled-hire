import { describe, expect, it } from "vitest";
import { CANONICAL_TRADE_POLICIES, evaluateRegulatoryEligibility } from "./regulatory.js";

describe("Regulatory Eligibility Policy Engine (Ontario)", () => {
  const electricalPolicy = CANONICAL_TRADE_POLICIES.find((p: (typeof CANONICAL_TRADE_POLICIES)[number]) => p.verticalSlug === "electrical")!;
  const hvacPolicy = CANONICAL_TRADE_POLICIES.find((p: (typeof CANONICAL_TRADE_POLICIES)[number]) => p.verticalSlug === "hvac")!;

  it("verifies compliant ECRA/ESA electrical contractor and 309A certified electrician", () => {
    const result = evaluateRegulatoryEligibility({
      policy: electricalPolicy,
      contractorCredentials: [
        {
          code: "ON_ESA_LEC_CONTRACTOR",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          regulatorReference: "ECRA-ESA-7001234",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "ON_WSIB_CLEARANCE",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "CGL_INSURANCE_2M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "COMMERCIAL_AUTO_1M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [
        {
          code: "ON_SKILLED_TRADES_309A",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          regulatorReference: "STO-309A-992120",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "GOVT_PHOTO_ID",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "BACKGROUND_CHECK_ANNUAL",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
    });

    expect(result.eligible).toBe(true);
    expect(result.failClosed).toBe(false);
    expect(result.contractorDeficiencies).toHaveLength(0);
    expect(result.technicianDeficiencies).toHaveLength(0);
    expect(result.requiredPermits).toContain("Electrical Safety Authority (ESA / ECRA)");
  });

  it("fails closed when contractor is missing mandatory ECRA/ESA license", () => {
    const result = evaluateRegulatoryEligibility({
      policy: electricalPolicy,
      contractorCredentials: [
        {
          code: "ON_WSIB_CLEARANCE",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [
        {
          code: "ON_SKILLED_TRADES_309A",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
    });

    expect(result.eligible).toBe(false);
    expect(result.failClosed).toBe(true);
    expect(result.contractorDeficiencies).toContain("ON_ESA_LEC_CONTRACTOR");
    expect(result.reasons.some((r: string) => r.includes("ON_ESA_LEC_CONTRACTOR"))).toBe(true);
  });

  it("fails closed when document is SELF_UPLOAD without authoritative audit/regulator verification", () => {
    const result = evaluateRegulatoryEligibility({
      policy: hvacPolicy,
      contractorCredentials: [
        {
          code: "ON_TSSA_CONTRACTOR_REG",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "SELF_UPLOAD", // Disallowed without auditor sign-off
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [],
    });

    expect(result.eligible).toBe(false);
    expect(result.failClosed).toBe(true);
    expect(result.contractorDeficiencies).toContain("ON_TSSA_CONTRACTOR_REG");
    expect(result.reasons.some((r: string) => r.includes("self-uploaded"))).toBe(true);
  });

  it("fails closed when certificate is expired", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30);

    const result = evaluateRegulatoryEligibility({
      policy: electricalPolicy,
      contractorCredentials: [
        {
          code: "ON_ESA_LEC_CONTRACTOR",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          expiryDate: pastDate.toISOString().split("T")[0],
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [],
    });

    expect(result.eligible).toBe(false);
    expect(result.failClosed).toBe(true);
    expect(result.contractorDeficiencies).toContain("ON_ESA_LEC_CONTRACTOR");
    expect(result.reasons.some((r: string) => r.includes("expired"))).toBe(true);
  });

  it("selects valid verified credential among duplicate historical submissions", () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 1);
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const result = evaluateRegulatoryEligibility({
      policy: electricalPolicy,
      contractorCredentials: [
        // Expired historical renewal
        {
          code: "ON_ESA_LEC_CONTRACTOR",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          expiryDate: pastDate.toISOString().split("T")[0],
          checkedAt: "2025-01-01T12:00:00Z",
        },
        // Active renewed credential
        {
          code: "ON_ESA_LEC_CONTRACTOR",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          expiryDate: futureDate.toISOString().split("T")[0],
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "ON_WSIB_CLEARANCE",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "CGL_INSURANCE_2M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "COMMERCIAL_AUTO_1M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [
        {
          code: "ON_SKILLED_TRADES_309A",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "GOVT_PHOTO_ID",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "BACKGROUND_CHECK_ANNUAL",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
    });

    expect(result.eligible).toBe(true);
    expect(result.failClosed).toBe(false);
    expect(result.contractorDeficiencies).toHaveLength(0);
  });

  it("fails closed when apprentice is deployed on trade prohibiting apprentices (HVAC gas heating)", () => {
    const result = evaluateRegulatoryEligibility({
      policy: hvacPolicy,
      contractorCredentials: [
        {
          code: "ON_TSSA_CONTRACTOR_REG",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "ON_WSIB_CLEARANCE",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "CGL_INSURANCE_2M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "COMMERCIAL_AUTO_1M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [],
      isApprentice: true,
    });

    expect(result.eligible).toBe(false);
    expect(result.failClosed).toBe(true);
    expect(result.technicianDeficiencies).toContain("APPRENTICE_NOT_PERMITTED");
  });

  it("fails closed when apprentice is deployed without a verified supervising journeyperson on file", () => {
    const result = evaluateRegulatoryEligibility({
      policy: electricalPolicy,
      contractorCredentials: [
        {
          code: "ON_ESA_LEC_CONTRACTOR",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "ON_WSIB_CLEARANCE",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "CGL_INSURANCE_2M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "COMMERCIAL_AUTO_1M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [],
      isApprentice: true,
      supervisorCredentials: [], // Missing supervisor
    });

    expect(result.eligible).toBe(false);
    expect(result.failClosed).toBe(true);
    expect(result.technicianDeficiencies).toContain("SUPERVISOR_NOT_VERIFIED");
  });

  it("authorizes apprentice when compliant supervisor is verified on file (1:1 ratio)", () => {
    const result = evaluateRegulatoryEligibility({
      policy: electricalPolicy,
      contractorCredentials: [
        {
          code: "ON_ESA_LEC_CONTRACTOR",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "ON_WSIB_CLEARANCE",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "CGL_INSURANCE_2M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "COMMERCIAL_AUTO_1M",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
      technicianCredentials: [],
      isApprentice: true,
      supervisorCredentials: [
        {
          code: "ON_SKILLED_TRADES_309A",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "REGULATOR_API",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "GOVT_PHOTO_ID",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
        {
          code: "BACKGROUND_CHECK_ANNUAL",
          geography: "ON",
          status: "VERIFIED",
          verificationSource: "MANUAL_AUDIT",
          checkedAt: "2026-10-10T12:00:00Z",
        },
      ],
    });

    expect(result.eligible).toBe(true);
    expect(result.failClosed).toBe(false);
    expect(result.technicianDeficiencies).toHaveLength(0);
    expect(result.reasons.some((r: string) => r.includes("Apprentice authorized under direct 1:1 supervision"))).toBe(true);
  });
});

