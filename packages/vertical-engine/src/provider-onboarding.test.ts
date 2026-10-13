import { describe, expect, it } from "vitest";
import type { ProviderApplicationDTO } from "@marketplace/contracts";
import {
  assessOnboardingReadiness,
  checkRateProposalSanity,
  evaluateServiceGeographyApprovals,
  validateAndNormalizePostalTerritories,
  validateTradeVerticals,
} from "./provider-onboarding.js";

describe("Provider Multi-Service Onboarding & Supply CRM (#41, #6)", () => {
  it("normalizes and validates Canadian FSA postal code territories", () => {
    const validResult = validateAndNormalizePostalTerritories([
      "m5v 2h1",
      "M4Y",
      " L5B 1A2 ",
      "M5V",
    ]);
    expect(validResult.valid).toBe(true);
    expect(validResult.normalizedFsaList).toEqual(["M5V", "M4Y", "L5B"]);
    expect(validResult.invalidCodes).toHaveLength(0);

    const invalidResult = validateAndNormalizePostalTerritories([
      "90210",
      "INVALID",
      "12345",
    ]);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.invalidCodes).toEqual(["90210", "INVALID", "12345"]);
  });

  it("validates trade vertical service selections against canonical catalog", () => {
    const validTrades = validateTradeVerticals(["hvac", "plumbing", "electrical"]);
    expect(validTrades.valid).toBe(true);
    expect(validTrades.validSlugs).toEqual(["hvac", "plumbing", "electrical"]);

    const mixedTrades = validateTradeVerticals(["hvac", "rocket-science"]);
    expect(mixedTrades.valid).toBe(false);
    expect(mixedTrades.validSlugs).toEqual(["hvac"]);
    expect(mixedTrades.invalidSlugs).toEqual(["rocket-science"]);
  });

  it("checks rate proposal sanity against market benchmarks", () => {
    const saneRates = checkRateProposalSanity([
      { verticalSlug: "hvac", hourlyRateCents: 12500, diagnosticFeeCents: 9900 },
      { verticalSlug: "plumbing", hourlyRateCents: 11000, diagnosticFeeCents: 8500 },
    ]);
    expect(saneRates.valid).toBe(true);
    expect(saneRates.anomalies).toHaveLength(0);

    const anomalousRates = checkRateProposalSanity([
      { verticalSlug: "hvac", hourlyRateCents: 2000, diagnosticFeeCents: 9900 }, // Below min
      { verticalSlug: "electrical", hourlyRateCents: 60000, diagnosticFeeCents: 50000 }, // Excessive
    ]);
    expect(anomalousRates.valid).toBe(false);
    expect(anomalousRates.anomalies).toHaveLength(3);
  });

  it("assesses onboarding application readiness and flags missing requirements", () => {
    const incompleteApp: ProviderApplicationDTO = {
      id: "APP-001",
      prospectEmail: "prospect@example.com",
      businessName: "Acme Heating",
      businessType: "CORPORATION",
      phone: "416-555-0199",
      postalCodes: [],
      selectedVerticals: ["hvac"],
      serviceRatesProposal: [],
      weeklyCapacity: 10,
      technicianCount: 1,
      status: "PROSPECT",
      saveToken: "tok-abc-123",
      draftStep: 1,
      consentAccepted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const incompleteReadiness = assessOnboardingReadiness(incompleteApp);
    expect(incompleteReadiness.isReadyForReview).toBe(false);
    expect(incompleteReadiness.readinessScoreBps).toBeLessThan(5000);
    expect(incompleteReadiness.missingItems).toContain(
      "Verified Ontario Business Number (BN) / Corporate Registry #",
    );
    expect(incompleteReadiness.missingItems).toContain(
      "Primary postal code territory coverage (FSA zones)",
    );

    const completeApp: ProviderApplicationDTO = {
      ...incompleteApp,
      businessNumber: "123456789RT0001",
      postalCodes: ["M5V", "M4Y"],
      serviceRatesProposal: [
        { verticalSlug: "hvac", hourlyRateCents: 12500, diagnosticFeeCents: 9900 },
      ],
      technicians: [
        {
          id: "tech-1",
          applicationId: "APP-001",
          fullName: "Bob Builder",
          email: "bob@acme.test",
          phone: "416-555-0122",
          tradeLicenseCode: "313A",
          licenseNumber: "LIC-998822",
          licenseExpiry: "2027-12-31",
          backgroundCheckStatus: "CLEARED",
          isEmergencyAvailable: true,
          createdAt: new Date().toISOString(),
        },
      ],
      consentAccepted: true,
    };

    const completeReadiness = assessOnboardingReadiness(completeApp);
    expect(completeReadiness.isReadyForReview).toBe(true);
    expect(completeReadiness.readinessScoreBps).toBe(10000);
    expect(completeReadiness.missingItems).toHaveLength(0);
  });

  it("evaluates service-by-geography approvals matrix", () => {
    const result = evaluateServiceGeographyApprovals(
      ["hvac", "plumbing"],
      ["GTA_DOWNTOWN", "PEEL"],
      [
        { verticalSlug: "hvac", territoryCode: "GTA_DOWNTOWN", status: "APPROVED" },
        { verticalSlug: "hvac", territoryCode: "PEEL", status: "CONDITIONALLY_APPROVED" },
        { verticalSlug: "plumbing", territoryCode: "GTA_DOWNTOWN", status: "REJECTED" },
      ],
    );

    expect(result.approvedPairs).toEqual([
      { verticalSlug: "hvac", territoryCode: "GTA_DOWNTOWN" },
    ]);
    expect(result.pendingPairs).toContainEqual({
      verticalSlug: "hvac",
      territoryCode: "PEEL",
    });
    expect(result.pendingPairs).toContainEqual({
      verticalSlug: "plumbing",
      territoryCode: "PEEL",
    });
    expect(result.rejectedPairs).toEqual([
      { verticalSlug: "plumbing", territoryCode: "GTA_DOWNTOWN" },
    ]);
  });
});
