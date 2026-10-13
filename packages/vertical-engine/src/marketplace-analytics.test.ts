import { describe, expect, it } from "vitest";
import {
  calculateGiniCoefficient,
  computeMarketplaceAnalytics,
  determineCoverageStatus,
  generateOperationalAlerts,
  type RawMarketplaceData,
} from "./marketplace-analytics.js";

describe("Marketplace Analytics & Supply Coverage Engine (#54)", () => {
  it("calculates Gini coefficient accurately for dispatch fairness", () => {
    // Perfect equality
    expect(calculateGiniCoefficient([10, 10, 10, 10])).toBe(0);

    // Single contractor (monopoly or trivial)
    expect(calculateGiniCoefficient([10])).toBe(0);

    // Concentrated distribution
    const skewedGini = calculateGiniCoefficient([1, 1, 2, 20]);
    expect(skewedGini).toBeGreaterThan(0.5);

    // Highly concentrated
    const extremeGini = calculateGiniCoefficient([0, 0, 0, 100]);
    expect(extremeGini).toBeGreaterThan(0.7);
  });

  it("determines coverage status based on verified providers and capacity saturation", () => {
    // Deficient: zero verified providers
    expect(determineCoverageStatus(0, 0)).toBe("DEFICIENT");

    // Constrained: >= 90% capacity saturation
    expect(determineCoverageStatus(4, 9500)).toBe("CONSTRAINED");

    // Adequate: 70% - 89% capacity saturation
    expect(determineCoverageStatus(5, 7500)).toBe("ADEQUATE");

    // Optimal: < 70% capacity saturation
    expect(determineCoverageStatus(6, 4500)).toBe("OPTIMAL");
  });

  it("generates proactive operational alerts for supply, SLA, and warranty anomalies", () => {
    const supply = [
      {
        neighbourhood: "Scarborough",
        verticalSlug: "hvac",
        verticalName: "HVAC",
        registeredProviders: 2,
        verifiedProviders: 0,
        activeDispatchedProviders: 0,
        capacitySaturationBps: 0,
        coverageStatus: "DEFICIENT" as const,
        estimatedWaitMinutes: 240,
      },
      {
        neighbourhood: "Downtown Toronto",
        verticalSlug: "hvac",
        verticalName: "HVAC",
        registeredProviders: 6,
        verifiedProviders: 5,
        activeDispatchedProviders: 5,
        capacitySaturationBps: 10000,
        coverageStatus: "CONSTRAINED" as const,
        estimatedWaitMinutes: 120,
      },
    ];

    const dispatch = {
      totalOffersSent: 10,
      totalOffersAccepted: 6,
      totalOffersDeclined: 2,
      totalOffersTimedOut: 2,
      acceptanceRateBps: 6000,
      averageResponseMinutes: 22.4,
      slaComplianceRateBps: 6000, // Below 8500
    };

    const quality = {
      completedJobsCount: 20,
      warrantyIssuedCount: 20,
      warrantyClaimsCount: 3,
      warrantyClaimRateBps: 1500, // 15% > 5% threshold
      curedCallbacksCount: 1,
      chargebackLiabilityCents: 50000,
      customerDisputeRateBps: 600,
      averageCustomerRating: 4.2,
      surveyConversionRateBps: 8000,
      surveyRewardsCostCents: 60000,
      repeatCustomerBookingRateBps: 2500,
    };

    const fairness = {
      totalActiveContractors: 5,
      giniCoefficient: 0.72, // Skewed
      topDecileVolumeShareBps: 7500,
      maxJobsPerContractor: 15,
      minJobsPerContractor: 1,
    };

    const fraud = {
      flaggedCircumventionAlerts: 1,
      workerIdentityMismatchAttempts: 2,
      expiredCredentialBlocks: 1,
      unauthorizedSubstitutionBlocks: 1,
    };

    const alerts = generateOperationalAlerts(supply, dispatch, quality, fairness, fraud);

    expect(alerts.length).toBeGreaterThanOrEqual(5);

    const alertTypes = alerts.map((a) => a.alertType);
    expect(alertTypes).toContain("SUPPLY_DEFICIT");
    expect(alertTypes).toContain("SLA_BREACH");
    expect(alertTypes).toContain("WARRANTY_SPIKE");
    expect(alertTypes).toContain("FAIRNESS_SKEW");
    expect(alertTypes).toContain("FRAUD_SIGNAL");

    const criticalAlerts = alerts.filter((a) => a.severity === "CRITICAL");
    expect(criticalAlerts.length).toBeGreaterThanOrEqual(3);
  });

  it("computes comprehensive end-to-end marketplace analytics from raw source data", () => {
    const rawData: RawMarketplaceData = {
      timeWindow: "30D",
      verticalSlug: "hvac",
      searchesCount: 100,
      intakesStarted: 40,
      requests: [
        { id: "r1", status: "COMPLETED", createdAt: "2026-10-01", verticalSlug: "hvac" },
        { id: "r2", status: "COMPLETED", createdAt: "2026-10-02", verticalSlug: "hvac" },
        { id: "r3", status: "COMPLETED", createdAt: "2026-10-03", verticalSlug: "hvac" },
        { id: "r4", status: "IN_PROGRESS", createdAt: "2026-10-04", verticalSlug: "hvac" },
      ],
      jobs: [
        {
          id: "j1",
          status: "COMPLETED",
          contractorId: "c1",
          createdAt: "2026-10-01",
          customerTotalCents: 24000,
          customerInsuranceCents: 1900,
        },
        {
          id: "j2",
          status: "COMPLETED",
          contractorId: "c1",
          createdAt: "2026-10-02",
          customerTotalCents: 35000,
          customerInsuranceCents: 1900,
        },
        {
          id: "j3",
          status: "COMPLETED",
          contractorId: "c2",
          createdAt: "2026-10-03",
          customerTotalCents: 18000,
          customerInsuranceCents: 0,
        },
      ],
      offers: [
        { id: "o1", status: "ACCEPTED", responseMinutes: 8 },
        { id: "o2", status: "ACCEPTED", responseMinutes: 12 },
        { id: "o3", status: "ACCEPTED", responseMinutes: 14 },
      ],
      warrantiesCount: 3,
      claims: [
        { id: "cl1", status: "RESOLVED", cured: true },
      ],
      surveys: [
        { id: "s1", rating: 5, status: "COMPLETED" },
        { id: "s2", rating: 4, status: "COMPLETED" },
      ],
      rewardsIssuedCents: 6000,
      repeatCustomersCount: 1,
      uniqueCustomersCount: 3,
      fraudAlerts: {
        circumventionCount: 0,
        workerMismatchCount: 0,
        expiredCredentialCount: 0,
        unauthorizedSubstitutionsCount: 0,
      },
      supplyGrid: [
        {
          neighbourhood: "Downtown Toronto",
          verticalSlug: "hvac",
          verticalName: "Heating & Cooling",
          registeredProviders: 5,
          verifiedProviders: 4,
          activeDispatchedProviders: 2,
          capacitySaturationBps: 5000,
        },
      ],
    };

    const analytics = computeMarketplaceAnalytics(rawData);

    // 1. Funnel
    expect(analytics.funnel.searchesCount).toBe(100);
    expect(analytics.funnel.completedCount).toBe(3);
    expect(analytics.funnel.bookingConversionBps).toBe(300); // 3%

    // 2. Dispatch
    expect(analytics.dispatchAndSla.totalOffersSent).toBe(3);
    expect(analytics.dispatchAndSla.acceptanceRateBps).toBe(10000); // 100%
    expect(analytics.dispatchAndSla.slaComplianceRateBps).toBe(10000);

    // 3. Financial
    expect(analytics.financial.grossMerchandiseValueCents).toBe(77000); // 24000 + 35000 + 18000
    expect(analytics.financial.marketplaceTakeRevenueCents).toBe(11550); // 15% of 77000
    expect(analytics.financial.protectionInsuranceRevenueCents).toBe(3800); // 1900 + 1900

    // 4. Quality
    expect(analytics.qualityAndTrust.completedJobsCount).toBe(3);
    expect(analytics.qualityAndTrust.warrantyIssuedCount).toBe(3);
    expect(analytics.qualityAndTrust.warrantyClaimsCount).toBe(1);
    expect(analytics.qualityAndTrust.curedCallbacksCount).toBe(1);
    expect(analytics.qualityAndTrust.averageCustomerRating).toBe(4.5);

    // 5. Supply Coverage
    expect(analytics.supplyCoverage[0]?.coverageStatus).toBe("OPTIMAL");
  });
});
