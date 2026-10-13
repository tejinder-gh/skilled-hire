export interface ProtectionProduct {
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
  maxJobValueCents: number;
  active: boolean;
}

export interface ProtectionQuote {
  id: string;
  serviceRequestId: string;
  productId: string;
  jobValueCents: number;
  coverageLimitCents: number;
  deductibleCents: number;
  grossPremiumCents: number;
  brokerCommissionCents: number;
  platformFeeCents: number;
  taxCents: number;
  totalPayableCents: number;
  eligible: boolean;
  underwritingDecision: string;
  declineReasons: string[];
  expiresAt: string;
  status: "ISSUED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "BOUND";
  createdAt: string;
}

export interface ProtectionPolicy {
  id: string;
  certificateNumber: string;
  serviceRequestId: string;
  jobId: string | null;
  productId: string;
  quoteId: string;
  customerId: string;
  contractorId: string;
  status:
    | "BOUND_ACTIVE"
    | "CANCELLED_REFUNDED"
    | "CLAIM_IN_PROGRESS"
    | "EXPIRED"
    | "TERMINATED";
  coverageLimitCents: number;
  deductibleCents: number;
  grossPremiumCents: number;
  taxCents: number;
  totalPaidCents: number;
  effectiveStartDate: string;
  effectiveEndDate: string;
  cancellationDeadline: string;
  policyChecksum: string;
  underwriterPolicyRef: string;
  brokerLicenseRef: string;
  bindingEvidenceSnapshot: Record<string, unknown>;
  createdAt: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
}

export interface ProtectionClaim {
  id: string;
  claimNumber: string;
  policyId: string;
  serviceRequestId: string;
  claimantUserId: string;
  contractorId: string;
  incidentDate: string;
  incidentDescription: string;
  claimedAmountCents: number;
  evidenceUrls: string[];
  status:
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "INSPECTION_SCHEDULED"
    | "APPROVED"
    | "PARTIALLY_APPROVED"
    | "DECLINED"
    | "PAID"
    | "CLOSED";
  adjudicatedAmountCents: number;
  deductibleAppliedCents: number;
  netPayoutCents: number;
  adjudicationNotes?: string | null;
  adjudicatedByUserId?: string | null;
  adjudicatedAt?: string | null;
  paidAt?: string | null;
  declineReasonCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProtectionLedgerEntry {
  id: string;
  transactionType:
    | "PREMIUM_COLLECTION"
    | "BROKER_COMMISSION_PAYABLE"
    | "PLATFORM_FEE_EARNED"
    | "INSURER_PREMIUM_REMITTANCE"
    | "PREMIUM_REFUND"
    | "CLAIM_PAYOUT"
    | "CLAIM_RECOVERY";
  policyId?: string | null;
  claimId?: string | null;
  amountCents: number;
  currency: string;
  direction: "CREDIT" | "DEBIT";
  sourceAccount: string;
  destinationAccount: string;
  reference: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ProtectionCertificate {
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
