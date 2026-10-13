import { computeSha256 } from "./legal.js";

export interface ProtectionProductData {
  id: string;
  slug: string;
  name: string;
  version: string;
  jurisdiction: string;
  underwriterName: string;
  underwriterPolicyRef: string;
  brokerName: string;
  brokerLicenseRef: string;
  coverageLimitCents: number;
  deductibleCents: number;
  durationMonths: number;
  baseRateBps: number;
  minPremiumCents: number;
  brokerCommissionBps: number;
  platformFeeBps: number;
  taxRateBps: number;
  termsMarkdown: string;
  disclaimers: string[];
  allowedVerticalIds?: string[];
  maxJobValueCents: number;
  active: boolean;
}

export interface UnderwritingContractorInput {
  id: string;
  status: string;
  safetyStatus?: string | null | undefined;
  activeQuarantines?: Array<{ quarantineType: string }> | undefined;
}

export interface UnderwritingServiceRequestInput {
  id: string;
  verticalId: string;
  verticalSlug?: string | undefined;
  region: string;
  urgency?: string | undefined;
}

export interface EvaluateCoverageEligibilityParams {
  product: ProtectionProductData;
  jobValueCents: number;
  serviceRequest: UnderwritingServiceRequestInput;
  contractor?: UnderwritingContractorInput | null | undefined;
  hazardFlags?: string[] | undefined;
}

export interface CoverageEligibilityResult {
  eligible: boolean;
  decision:
    | "ELIGIBLE"
    | "DECLINED_JOB_VALUE_EXCEEDED"
    | "DECLINED_JURISDICTION_MISMATCH"
    | "DECLINED_VERTICAL_NOT_COVERED"
    | "DECLINED_UNVERIFIED_STATUS"
    | "DECLINED_CONTRACTOR_QUARANTINE"
    | "DECLINED_HAZARD_EXCLUSION";
  declineReasons: string[];
}

export function evaluateCoverageEligibility(
  params: EvaluateCoverageEligibilityParams,
): CoverageEligibilityResult {
  const { product, jobValueCents, serviceRequest, contractor, hazardFlags } = params;
  const declineReasons: string[] = [];

  // 1. Max Job Value Ceiling
  if (jobValueCents > product.maxJobValueCents) {
    declineReasons.push(
      `Job value of $${(jobValueCents / 100).toFixed(2)} exceeds maximum policy ceiling of $${(product.maxJobValueCents / 100).toFixed(2)} for product '${product.name}'.`,
    );
    return {
      eligible: false,
      decision: "DECLINED_JOB_VALUE_EXCEEDED",
      declineReasons,
    };
  }

  // 2. Geographic Underwriting Jurisdiction
  if (product.jurisdiction !== serviceRequest.region) {
    declineReasons.push(
      `Product jurisdiction '${product.jurisdiction}' does not match service property region '${serviceRequest.region}'.`,
    );
    return {
      eligible: false,
      decision: "DECLINED_JURISDICTION_MISMATCH",
      declineReasons,
    };
  }

  // 3. Vertical Scope Coverage
  if (
    product.allowedVerticalIds &&
    product.allowedVerticalIds.length > 0 &&
    !product.allowedVerticalIds.includes(serviceRequest.verticalId)
  ) {
    declineReasons.push(
      `Product '${product.slug}' is not licensed or authorized for vertical ID '${serviceRequest.verticalId}'.`,
    );
    return {
      eligible: false,
      decision: "DECLINED_VERTICAL_NOT_COVERED",
      declineReasons,
    };
  }

  // 4. Contractor Standing & Safety Quarantines (if contractor is assigned)
  if (contractor) {
    if (contractor.status !== "VERIFIED") {
      declineReasons.push(
        `Assigned contractor status is '${contractor.status}'. Work is only underwritable with fully VERIFIED contractors.`,
      );
      return {
        eligible: false,
        decision: "DECLINED_UNVERIFIED_STATUS",
        declineReasons,
      };
    }

    if (contractor.safetyStatus === "SUSPENDED") {
      declineReasons.push(
        `Contractor '${contractor.id}' is under active safety suspension. Optional protection product binding prohibited.`,
      );
      return {
        eligible: false,
        decision: "DECLINED_CONTRACTOR_QUARANTINE",
        declineReasons,
      };
    }

    if (contractor.activeQuarantines && contractor.activeQuarantines.length > 0) {
      declineReasons.push(
        `Contractor '${contractor.id}' has active safety quarantine orders on file.`,
      );
      return {
        eligible: false,
        decision: "DECLINED_CONTRACTOR_QUARANTINE",
        declineReasons,
      };
    }
  }

  // 5. Excluded Hazard Flags
  const excludedHazards = ["HAZMAT_ASBESTOS", "UNPERMITTED_STRUCTURAL"];
  const matchedExclusions = (hazardFlags ?? []).filter((flag) =>
    excludedHazards.includes(flag),
  );
  if (matchedExclusions.length > 0) {
    declineReasons.push(
      `Job possesses high-risk hazard flags excluded from standard warranty backing: ${matchedExclusions.join(", ")}. Requires specialized surplus lines endorsement.`,
    );
    return {
      eligible: false,
      decision: "DECLINED_HAZARD_EXCLUSION",
      declineReasons,
    };
  }

  return {
    eligible: true,
    decision: "ELIGIBLE",
    declineReasons: [],
  };
}

export interface PremiumCalculationParams {
  product: ProtectionProductData;
  jobValueCents: number;
}

export interface PremiumCalculationResult {
  grossPremiumCents: number;
  brokerCommissionCents: number;
  platformFeeCents: number;
  taxCents: number;
  totalPayableCents: number;
}

export function calculateProtectionPremium(
  params: PremiumCalculationParams,
): PremiumCalculationResult {
  const { product, jobValueCents } = params;

  const rawPremiumCents = Math.round((jobValueCents * product.baseRateBps) / 10000);
  const grossPremiumCents = Math.max(product.minPremiumCents, rawPremiumCents);

  const brokerCommissionCents = Math.round(
    (grossPremiumCents * product.brokerCommissionBps) / 10000,
  );
  const platformFeeCents = Math.round(
    (grossPremiumCents * product.platformFeeBps) / 10000,
  );

  // Ontario insurance premium tax (8%) applies to insurance premium and related platform service fees
  const taxCents = Math.round(
    ((grossPremiumCents + platformFeeCents) * product.taxRateBps) / 10000,
  );
  const totalPayableCents = grossPremiumCents + platformFeeCents + taxCents;

  return {
    grossPremiumCents,
    brokerCommissionCents,
    platformFeeCents,
    taxCents,
    totalPayableCents,
  };
}

export interface BuildCoverageCertificateParams {
  certificateNumber: string;
  policyId: string;
  jurisdiction: string;
  customerId: string;
  customerName: string;
  contractorId: string;
  contractorName: string;
  underwriterName: string;
  underwriterPolicyRef: string;
  brokerName: string;
  brokerLicenseRef: string;
  coverageLimitCents: number;
  deductibleCents: number;
  durationMonths: number;
  effectiveStartDate: string;
  effectiveEndDate: string;
  cancellationDeadline: string;
  statutoryDisclosures?: string[] | undefined;
}

export interface CoverageCertificate {
  certificateNumber: string;
  policyId: string;
  jurisdiction: string;
  status: string;
  policyChecksum: string;
  insuredCustomer: {
    id: string;
    name: string;
  };
  registeredContractor: {
    id: string;
    name: string;
  };
  underwriter: {
    name: string;
    policyRef: string;
  };
  licensedBroker: {
    name: string;
    licenseRef: string;
  };
  coverage: {
    limitCents: number;
    deductibleCents: number;
    durationMonths: number;
  };
  validity: {
    effectiveStart: string;
    effectiveEnd: string;
    cancellationDeadline: string;
  };
  statutoryDisclosures: string[];
}

export function buildCoverageCertificate(
  params: BuildCoverageCertificateParams,
): CoverageCertificate {
  const canonicalString = [
    params.certificateNumber,
    params.policyId,
    params.jurisdiction,
    params.customerId,
    params.contractorId,
    params.underwriterPolicyRef,
    params.brokerLicenseRef,
    String(params.coverageLimitCents),
    String(params.deductibleCents),
    params.effectiveStartDate,
    params.effectiveEndDate,
  ].join("|");

  const policyChecksum = computeSha256(canonicalString);

  return {
    certificateNumber: params.certificateNumber,
    policyId: params.policyId,
    jurisdiction: params.jurisdiction,
    status: "BOUND_ACTIVE",
    policyChecksum,
    insuredCustomer: {
      id: params.customerId,
      name: params.customerName,
    },
    registeredContractor: {
      id: params.contractorId,
      name: params.contractorName,
    },
    underwriter: {
      name: params.underwriterName,
      policyRef: params.underwriterPolicyRef,
    },
    licensedBroker: {
      name: params.brokerName,
      licenseRef: params.brokerLicenseRef,
    },
    coverage: {
      limitCents: params.coverageLimitCents,
      deductibleCents: params.deductibleCents,
      durationMonths: params.durationMonths,
    },
    validity: {
      effectiveStart: params.effectiveStartDate,
      effectiveEnd: params.effectiveEndDate,
      cancellationDeadline: params.cancellationDeadline,
    },
    statutoryDisclosures: params.statutoryDisclosures ?? [
      "Distributed by Licensed Insurance Broker (RIBO / FSRA Compliance).",
      "No unsupported 100% guarantee language. Direct underwriter privity.",
      "10-Day Statutory Cancellation Cooling-Off Right with Full Premium Refund prior to trade work commencement.",
    ],
  };
}

export function verifyCoverageCertificate(
  certificate: CoverageCertificate,
): boolean {
  const canonicalString = [
    certificate.certificateNumber,
    certificate.policyId,
    certificate.jurisdiction,
    certificate.insuredCustomer.id,
    certificate.registeredContractor.id,
    certificate.underwriter.policyRef,
    certificate.licensedBroker.licenseRef,
    String(certificate.coverage.limitCents),
    String(certificate.coverage.deductibleCents),
    certificate.validity.effectiveStart,
    certificate.validity.effectiveEnd,
  ].join("|");

  const expectedChecksum = computeSha256(canonicalString);
  return expectedChecksum === certificate.policyChecksum;
}

export interface AdjudicateClaimParams {
  claim: {
    claimedAmountCents: number;
    incidentDate: Date | string;
    evidenceUrls: string[];
  };
  policy: {
    coverageLimitCents: number;
    deductibleCents: number;
    effectiveStartDate: Date | string;
    effectiveEndDate: Date | string;
    status: string;
  };
  decision: "APPROVED" | "PARTIALLY_APPROVED" | "DECLINED";
  approvedAmountCents?: number | undefined;
  deductibleCents?: number | undefined;
  adjudicationNotes: string;
  declineReasonCode?: string | undefined;
  now?: Date | undefined;
}

export interface AdjudicateClaimResult {
  status: "APPROVED" | "PARTIALLY_APPROVED" | "DECLINED";
  adjudicatedAmountCents: number;
  deductibleAppliedCents: number;
  netPayoutCents: number;
  declineReasonCode?: string | null;
  adjudicationNotes: string;
}

export function adjudicateProtectionClaim(
  params: AdjudicateClaimParams,
): AdjudicateClaimResult {
  const { claim, policy, decision, approvedAmountCents, deductibleCents, declineReasonCode, adjudicationNotes } = params;
  const incidentTime = new Date(claim.incidentDate).getTime();
  const startTime = new Date(policy.effectiveStartDate).getTime();
  const endTime = new Date(policy.effectiveEndDate).getTime();

  // 1. Boundary check: Incident date must fall within coverage period
  if (incidentTime < startTime || incidentTime > endTime) {
    return {
      status: "DECLINED",
      adjudicatedAmountCents: 0,
      deductibleAppliedCents: 0,
      netPayoutCents: 0,
      declineReasonCode: "CLAIM_EXCEEDS_POLICY_PERIOD",
      adjudicationNotes: `Incident date (${new Date(claim.incidentDate).toISOString()}) falls outside policy active period (${new Date(policy.effectiveStartDate).toISOString()} to ${new Date(policy.effectiveEndDate).toISOString()}).`,
    };
  }

  // 2. Policy state check
  if (!["BOUND_ACTIVE", "CLAIM_IN_PROGRESS"].includes(policy.status)) {
    return {
      status: "DECLINED",
      adjudicatedAmountCents: 0,
      deductibleAppliedCents: 0,
      netPayoutCents: 0,
      declineReasonCode: "OUTSIDE_COVERAGE_SCOPE",
      adjudicationNotes: `Policy status is '${policy.status}'; active coverage is required to adjudicate claims.`,
    };
  }

  // 3. Process decline
  if (decision === "DECLINED") {
    return {
      status: "DECLINED",
      adjudicatedAmountCents: 0,
      deductibleAppliedCents: 0,
      netPayoutCents: 0,
      declineReasonCode: declineReasonCode ?? "OUTSIDE_COVERAGE_SCOPE",
      adjudicationNotes,
    };
  }

  // 4. Process approval / partial approval
  const grossApproved = approvedAmountCents ?? claim.claimedAmountCents;
  const appliedDeductible = deductibleCents ?? policy.deductibleCents;
  const netBeforeLimit = Math.max(0, grossApproved - appliedDeductible);
  const netPayoutCents = Math.min(netBeforeLimit, policy.coverageLimitCents);

  return {
    status: decision,
    adjudicatedAmountCents: grossApproved,
    deductibleAppliedCents: appliedDeductible,
    netPayoutCents,
    declineReasonCode: null,
    adjudicationNotes,
  };
}
