export type CoverageStatus =
  | "OPTIMAL"
  | "ADEQUATE"
  | "CONSTRAINED"
  | "DEFICIENT";

export type AnalyticsTimeWindow = "24H" | "7D" | "30D" | "90D" | "ALL";

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export type AlertCategory =
  | "SUPPLY_DEFICIT"
  | "SLA_BREACH"
  | "WARRANTY_SPIKE"
  | "FRAUD_SIGNAL"
  | "FAIRNESS_SKEW";

export type AlertStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

export interface SupplyCoverageNeighbourhood {
  neighbourhood: string;
  verticalSlug: string;
  verticalName: string;
  registeredProviders: number;
  verifiedProviders: number;
  activeDispatchedProviders: number;
  capacitySaturationBps: number;
  coverageStatus: CoverageStatus;
  estimatedWaitMinutes: number;
}

export interface CustomerAcquisitionFunnel {
  searchesCount: number;
  intakesStarted: number;
  requestsCreated: number;
  dispatchedCount: number;
  completedCount: number;
  bookingConversionBps: number;
}

export interface DispatchAndSlaMetrics {
  totalOffersSent: number;
  totalOffersAccepted: number;
  totalOffersDeclined: number;
  totalOffersTimedOut: number;
  acceptanceRateBps: number;
  averageResponseMinutes: number;
  slaComplianceRateBps: number;
}

export interface FairnessDispersionMetrics {
  totalActiveContractors: number;
  giniCoefficient: number;
  topDecileVolumeShareBps: number;
  maxJobsPerContractor: number;
  minJobsPerContractor: number;
}

export interface MarketplaceFinancialMetrics {
  grossMerchandiseValueCents: number;
  contractorEarningsCents: number;
  marketplaceTakeRevenueCents: number;
  averageTakeRateBps: number;
  protectionInsuranceRevenueCents: number;
  averageJobValueCents: number;
}

export interface QualityAndTrustMetrics {
  completedJobsCount: number;
  warrantyIssuedCount: number;
  warrantyClaimsCount: number;
  warrantyClaimRateBps: number;
  curedCallbacksCount: number;
  chargebackLiabilityCents: number;
  customerDisputeRateBps: number;
  averageCustomerRating: number;
  surveyConversionRateBps: number;
  surveyRewardsCostCents: number;
  repeatCustomerBookingRateBps: number;
}

export interface FraudAndIntegritySignals {
  flaggedCircumventionAlerts: number;
  workerIdentityMismatchAttempts: number;
  expiredCredentialBlocks: number;
  unauthorizedSubstitutionBlocks: number;
}

export interface MarketplaceOperationalAlert {
  id: string;
  alertType: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  verticalSlug?: string | undefined;
  neighbourhood?: string | undefined;
  metricsPayload?: Record<string, unknown> | undefined;
  createdAt: string;
  acknowledgedAt?: string | undefined;
  resolvedAt?: string | undefined;
  resolutionNotes?: string | undefined;
}

export interface MarketplaceAnalyticsResponse {
  generatedAt: string;
  timeWindow: AnalyticsTimeWindow;
  verticalSlug?: string | undefined;
  neighbourhood?: string | undefined;
  funnel: CustomerAcquisitionFunnel;
  dispatchAndSla: DispatchAndSlaMetrics;
  fairness: FairnessDispersionMetrics;
  financial: MarketplaceFinancialMetrics;
  qualityAndTrust: QualityAndTrustMetrics;
  fraudSignals: FraudAndIntegritySignals;
  supplyCoverage: SupplyCoverageNeighbourhood[];
  operationalAlerts: MarketplaceOperationalAlert[];
}
