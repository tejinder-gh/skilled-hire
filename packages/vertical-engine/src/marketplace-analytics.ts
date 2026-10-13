import type {
  AlertCategory,
  AlertSeverity,
  AnalyticsTimeWindow,
  CoverageStatus,
  CustomerAcquisitionFunnel,
  DispatchAndSlaMetrics,
  FairnessDispersionMetrics,
  FraudAndIntegritySignals,
  MarketplaceAnalyticsResponse,
  MarketplaceFinancialMetrics,
  MarketplaceOperationalAlert,
  QualityAndTrustMetrics,
  SupplyCoverageNeighbourhood,
} from "@marketplace/contracts";

export interface RawMarketplaceData {
  timeWindow?: AnalyticsTimeWindow | undefined;
  verticalSlug?: string | undefined;
  neighbourhood?: string | undefined;
  searchesCount: number;
  intakesStarted: number;
  requests: Array<{
    id: string;
    status: string;
    createdAt: string;
    verticalSlug: string;
  }>;
  jobs: Array<{
    id: string;
    status: string;
    contractorId: string;
    createdAt: string;
    scheduledStart?: string | null | undefined;
    completedAt?: string | null | undefined;
    customerTotalCents?: number | null | undefined;
    customerInsuranceCents?: number | null | undefined;
    takeRateBps?: number | null | undefined;
  }>;
  offers: Array<{
    id: string;
    status: "ACCEPTED" | "DECLINED" | "TIMED_OUT";
    responseMinutes: number;
  }>;
  warrantiesCount: number;
  claims: Array<{
    id: string;
    status: string;
    cured: boolean;
  }>;
  surveys: Array<{
    id: string;
    rating: number;
    status: string;
  }>;
  rewardsIssuedCents: number;
  repeatCustomersCount: number;
  uniqueCustomersCount: number;
  fraudAlerts: {
    circumventionCount: number;
    workerMismatchCount: number;
    expiredCredentialCount: number;
    unauthorizedSubstitutionsCount: number;
  };
  supplyGrid: Array<{
    neighbourhood: string;
    verticalSlug: string;
    verticalName: string;
    registeredProviders: number;
    verifiedProviders: number;
    activeDispatchedProviders: number;
    capacitySaturationBps: number;
  }>;
}

/**
 * Calculates Gini coefficient of job distribution among contractors (0 = perfect equality, 1 = absolute concentration)
 */
export function calculateGiniCoefficient(jobCounts: number[]): number {
  if (jobCounts.length <= 1) return 0;
  const sorted = [...jobCounts].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  if (sum === 0) return 0;

  let cumulativeSum = 0;
  for (let i = 0; i < n; i++) {
    const val = sorted[i];
    if (val !== undefined) {
      cumulativeSum += (2 * (i + 1) - n - 1) * val;
    }
  }

  const gini = cumulativeSum / (n * sum);
  return Math.max(0, Math.min(1, Math.round(gini * 100) / 100));
}

/**
 * Determines coverage status from verified providers and capacity saturation
 */
export function determineCoverageStatus(
  verifiedCount: number,
  capacitySaturationBps: number,
): CoverageStatus {
  if (verifiedCount === 0) return "DEFICIENT";
  if (capacitySaturationBps >= 9000) return "CONSTRAINED";
  if (capacitySaturationBps >= 7000) return "ADEQUATE";
  return "OPTIMAL";
}

/**
 * Evaluates operational conditions and generates proactive operational alerts
 */
export function generateOperationalAlerts(
  supply: SupplyCoverageNeighbourhood[],
  dispatch: DispatchAndSlaMetrics,
  quality: QualityAndTrustMetrics,
  fairness: FairnessDispersionMetrics,
  fraud: FraudAndIntegritySignals,
): MarketplaceOperationalAlert[] {
  const alerts: MarketplaceOperationalAlert[] = [];
  const now = new Date().toISOString();

  // 1. Supply Deficit / Capacity Saturation Checks
  for (const s of supply) {
    if (s.coverageStatus === "DEFICIENT") {
      alerts.push({
        id: `ALT-SUPPLY-${s.neighbourhood.replace(/\s+/g, "_").toUpperCase()}-${Date.now()}`,
        alertType: "SUPPLY_DEFICIT",
        severity: "CRITICAL",
        status: "ACTIVE",
        title: `Zero Verified Supply in ${s.neighbourhood}`,
        description: `No licensed and verified ${s.verticalName} providers available in ${s.neighbourhood}. Onboarding outreach needed immediately.`,
        neighbourhood: s.neighbourhood,
        verticalSlug: s.verticalSlug,
        metricsPayload: { verifiedProviders: s.verifiedProviders },
        createdAt: now,
      });
    } else if (s.coverageStatus === "CONSTRAINED") {
      alerts.push({
        id: `ALT-CAPACITY-${s.neighbourhood.replace(/\s+/g, "_").toUpperCase()}-${Date.now()}`,
        alertType: "SUPPLY_DEFICIT",
        severity: "WARNING",
        status: "ACTIVE",
        title: `High Capacity Saturation (${s.capacitySaturationBps / 100}%) in ${s.neighbourhood}`,
        description: `Active dispatches are consuming ${s.capacitySaturationBps / 100}% of available certified capacity in ${s.neighbourhood}.`,
        neighbourhood: s.neighbourhood,
        verticalSlug: s.verticalSlug,
        metricsPayload: { capacitySaturationBps: s.capacitySaturationBps },
        createdAt: now,
      });
    }
  }

  // 2. Dispatch SLA Breach
  if (dispatch.slaComplianceRateBps < 8500 && dispatch.totalOffersSent >= 5) {
    alerts.push({
      id: `ALT-SLA-${Date.now()}`,
      alertType: "SLA_BREACH",
      severity: "WARNING",
      status: "ACTIVE",
      title: `Dispatch SLA Breach (${dispatch.slaComplianceRateBps / 100}%)`,
      description: `Contractor offer acceptance or response times are underperforming the 85% SLA benchmark. Average response: ${dispatch.averageResponseMinutes} mins.`,
      metricsPayload: {
        slaComplianceRateBps: dispatch.slaComplianceRateBps,
        averageResponseMinutes: dispatch.averageResponseMinutes,
      },
      createdAt: now,
    });
  }

  // 3. Warranty Spike Alert
  if (quality.warrantyClaimRateBps > 500 && quality.completedJobsCount >= 5) {
    alerts.push({
      id: `ALT-WARRANTY-${Date.now()}`,
      alertType: "WARRANTY_SPIKE",
      severity: "CRITICAL",
      status: "ACTIVE",
      title: `Elevated Workmanship Warranty Claim Rate (${quality.warrantyClaimRateBps / 100}%)`,
      description: `Warranty claims exceed 5.0% threshold (${quality.warrantyClaimsCount} claims on ${quality.completedJobsCount} completed jobs). Quality review mandated.`,
      metricsPayload: {
        warrantyClaimRateBps: quality.warrantyClaimRateBps,
        warrantyClaimsCount: quality.warrantyClaimsCount,
      },
      createdAt: now,
    });
  }

  // 4. Fairness Skew Alert
  if (fairness.giniCoefficient > 0.65 && fairness.totalActiveContractors >= 4) {
    alerts.push({
      id: `ALT-FAIRNESS-${Date.now()}`,
      alertType: "FAIRNESS_SKEW",
      severity: "WARNING",
      status: "ACTIVE",
      title: `Dispatch Allocation Skew (Gini: ${fairness.giniCoefficient})`,
      description: `Dispatch algorithm volume is concentrating among top providers (Top decile share: ${fairness.topDecileVolumeShareBps / 100}%). Review fair rotation parameters.`,
      metricsPayload: {
        giniCoefficient: fairness.giniCoefficient,
        topDecileVolumeShareBps: fairness.topDecileVolumeShareBps,
      },
      createdAt: now,
    });
  }

  // 5. Fraud & Integrity Signals
  if (fraud.workerIdentityMismatchAttempts > 0 || fraud.flaggedCircumventionAlerts > 0) {
    alerts.push({
      id: `ALT-FRAUD-${Date.now()}`,
      alertType: "FRAUD_SIGNAL",
      severity: "CRITICAL",
      status: "ACTIVE",
      title: `Platform Integrity & Worker Verification Anomaly`,
      description: `Detected ${fraud.workerIdentityMismatchAttempts} worker substitution attempts and ${fraud.flaggedCircumventionAlerts} circumvention flags.`,
      metricsPayload: {
        workerMismatch: fraud.workerIdentityMismatchAttempts,
        circumvention: fraud.flaggedCircumventionAlerts,
      },
      createdAt: now,
    });
  }

  return alerts;
}

/**
 * Computes complete marketplace analytics and supply coverage
 */
export function computeMarketplaceAnalytics(
  data: RawMarketplaceData,
): MarketplaceAnalyticsResponse {
  const window: AnalyticsTimeWindow = data.timeWindow ?? "30D";

  // 1. Funnel
  const requestsCreated = data.requests.length;
  const dispatchedCount = data.jobs.length;
  const completedCount = data.jobs.filter((j) => j.status === "COMPLETED").length;
  const bookingConversionBps =
    data.searchesCount > 0
      ? Math.round((completedCount / data.searchesCount) * 10000)
      : requestsCreated > 0
        ? Math.round((completedCount / requestsCreated) * 10000)
        : 0;

  const funnel: CustomerAcquisitionFunnel = {
    searchesCount: data.searchesCount,
    intakesStarted: data.intakesStarted,
    requestsCreated,
    dispatchedCount,
    completedCount,
    bookingConversionBps,
  };

  // 2. Dispatch & SLA
  const totalOffersSent = data.offers.length;
  const totalOffersAccepted = data.offers.filter(
    (o) => o.status === "ACCEPTED",
  ).length;
  const totalOffersDeclined = data.offers.filter(
    (o) => o.status === "DECLINED",
  ).length;
  const totalOffersTimedOut = data.offers.filter(
    (o) => o.status === "TIMED_OUT",
  ).length;

  const acceptanceRateBps =
    totalOffersSent > 0
      ? Math.round((totalOffersAccepted / totalOffersSent) * 10000)
      : 10000;

  const avgResponse =
    totalOffersSent > 0
      ? Math.round(
          (data.offers.reduce((acc, o) => acc + o.responseMinutes, 0) /
            totalOffersSent) *
            10,
        ) / 10
      : 8.5;

  const withinSla = data.offers.filter((o) => o.responseMinutes <= 15).length;
  const slaComplianceRateBps =
    totalOffersSent > 0
      ? Math.round((withinSla / totalOffersSent) * 10000)
      : 9500;

  const dispatchAndSla: DispatchAndSlaMetrics = {
    totalOffersSent,
    totalOffersAccepted,
    totalOffersDeclined,
    totalOffersTimedOut,
    acceptanceRateBps,
    averageResponseMinutes: avgResponse,
    slaComplianceRateBps,
  };

  // 3. Fairness Dispersion
  const contractorJobMap: Record<string, number> = {};
  for (const j of data.jobs) {
    if (j.contractorId) {
      contractorJobMap[j.contractorId] =
        (contractorJobMap[j.contractorId] ?? 0) + 1;
    }
  }
  const jobCounts = Object.values(contractorJobMap);
  const totalActiveContractors = jobCounts.length;
  const gini = calculateGiniCoefficient(jobCounts);
  const maxJobs = jobCounts.length > 0 ? Math.max(...jobCounts) : 0;
  const minJobs = jobCounts.length > 0 ? Math.min(...jobCounts) : 0;
  const totalJobSum = jobCounts.reduce((a, b) => a + b, 0);

  const topDecileCount = Math.max(1, Math.ceil(jobCounts.length * 0.1));
  const sortedDesc = [...jobCounts].sort((a, b) => b - a);
  const topDecileSum = sortedDesc
    .slice(0, topDecileCount)
    .reduce((a, b) => a + b, 0);
  const topDecileVolumeShareBps =
    totalJobSum > 0 ? Math.round((topDecileSum / totalJobSum) * 10000) : 0;

  const fairness: FairnessDispersionMetrics = {
    totalActiveContractors,
    giniCoefficient: gini,
    topDecileVolumeShareBps,
    maxJobsPerContractor: maxJobs,
    minJobsPerContractor: minJobs,
  };

  // 4. Financial & Revenue
  let gmvCents = 0;
  let insuranceRevenueCents = 0;
  for (const j of data.jobs) {
    gmvCents += j.customerTotalCents ?? 0;
    insuranceRevenueCents += j.customerInsuranceCents ?? 0;
  }
  const takeRateBps = 1500; // 15% platform take rate
  const marketplaceTakeRevenueCents = Math.round((gmvCents * takeRateBps) / 10000);
  const contractorEarningsCents = gmvCents - marketplaceTakeRevenueCents;
  const avgJobValue =
    data.jobs.length > 0 ? Math.round(gmvCents / data.jobs.length) : 0;

  const financial: MarketplaceFinancialMetrics = {
    grossMerchandiseValueCents: gmvCents,
    contractorEarningsCents,
    marketplaceTakeRevenueCents,
    averageTakeRateBps: takeRateBps,
    protectionInsuranceRevenueCents: insuranceRevenueCents,
    averageJobValueCents: avgJobValue,
  };

  // 5. Quality & Trust
  const warrantyClaimsCount = data.claims.length;
  const warrantyClaimRateBps =
    completedCount > 0
      ? Math.round((warrantyClaimsCount / completedCount) * 10000)
      : 0;

  const curedCallbacksCount = data.claims.filter((c) => c.cured).length;
  const uncuredClaims = data.claims.filter(
    (c) => !c.cured && c.status === "ESCALATED_TO_PLATFORM",
  ).length;
  const chargebackLiabilityCents = uncuredClaims * 25000;

  const surveyRatings = data.surveys.map((s) => s.rating);
  const avgRating =
    surveyRatings.length > 0
      ? Math.round(
          (surveyRatings.reduce((a, b) => a + b, 0) / surveyRatings.length) * 10,
        ) / 10
      : 4.8;

  const surveyConversionRateBps =
    completedCount > 0
      ? Math.round((data.surveys.length / completedCount) * 10000)
      : 0;

  const repeatBookingRateBps =
    data.uniqueCustomersCount > 0
      ? Math.round(
          (data.repeatCustomersCount / data.uniqueCustomersCount) * 10000,
        )
      : 0;

  const qualityAndTrust: QualityAndTrustMetrics = {
    completedJobsCount: completedCount,
    warrantyIssuedCount: data.warrantiesCount,
    warrantyClaimsCount,
    warrantyClaimRateBps,
    curedCallbacksCount,
    chargebackLiabilityCents,
    customerDisputeRateBps: Math.round(warrantyClaimRateBps * 0.4),
    averageCustomerRating: avgRating,
    surveyConversionRateBps,
    surveyRewardsCostCents: data.rewardsIssuedCents,
    repeatCustomerBookingRateBps: repeatBookingRateBps,
  };

  // 6. Fraud Signals
  const fraudSignals: FraudAndIntegritySignals = {
    flaggedCircumventionAlerts: data.fraudAlerts.circumventionCount,
    workerIdentityMismatchAttempts: data.fraudAlerts.workerMismatchCount,
    expiredCredentialBlocks: data.fraudAlerts.expiredCredentialCount,
    unauthorizedSubstitutionBlocks:
      data.fraudAlerts.unauthorizedSubstitutionsCount,
  };

  // 7. Supply Coverage Grid
  const supplyCoverage: SupplyCoverageNeighbourhood[] = data.supplyGrid.map(
    (g) => {
      const status = determineCoverageStatus(
        g.verifiedProviders,
        g.capacitySaturationBps,
      );
      const estWait =
        status === "CONSTRAINED"
          ? 120
          : status === "DEFICIENT"
            ? 240
            : status === "ADEQUATE"
              ? 45
              : 20;

      return {
        neighbourhood: g.neighbourhood,
        verticalSlug: g.verticalSlug,
        verticalName: g.verticalName,
        registeredProviders: g.registeredProviders,
        verifiedProviders: g.verifiedProviders,
        activeDispatchedProviders: g.activeDispatchedProviders,
        capacitySaturationBps: g.capacitySaturationBps,
        coverageStatus: status,
        estimatedWaitMinutes: estWait,
      };
    },
  );

  // 8. Generate Operational Alerts
  const operationalAlerts = generateOperationalAlerts(
    supplyCoverage,
    dispatchAndSla,
    qualityAndTrust,
    fairness,
    fraudSignals,
  );

  return {
    generatedAt: new Date().toISOString(),
    timeWindow: window,
    verticalSlug: data.verticalSlug,
    neighbourhood: data.neighbourhood,
    funnel,
    dispatchAndSla,
    fairness,
    financial,
    qualityAndTrust,
    fraudSignals,
    supplyCoverage,
    operationalAlerts,
  };
}
