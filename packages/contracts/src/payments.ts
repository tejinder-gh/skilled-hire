export type ConnectOnboardingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PENDING_VERIFICATION"
  | "COMPLETED"
  | "RESTRICTED";

export type PaymentIntentStatus =
  | "REQUIRES_PAYMENT_METHOD"
  | "REQUIRES_CONFIRMATION"
  | "REQUIRES_ACTION"
  | "PROCESSING"
  | "SUCCEEDED"
  | "CANCELED"
  | "FAILED";

export type WebhookEventStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "PROCESSED"
  | "FAILED"
  | "IGNORED";

export type DisputeStatus =
  | "NEEDS_RESPONSE"
  | "UNDER_REVIEW"
  | "WON"
  | "LOST";

export interface StripeConnectAccountDTO {
  id: string;
  contractorId: string;
  stripeAccountId: string;
  accountType: string;
  onboardingStatus: ConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string;
  defaultCurrency: string;
  requirementsDue: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConnectOnboardRequest {
  returnUrl?: string;
  refreshUrl?: string;
}

export interface ConnectOnboardResponse {
  accountId: string;
  onboardingUrl: string;
  expiresAt: string;
}

export interface PaymentIntentDTO {
  id: string;
  milestoneId: string;
  customerId: string;
  contractorId: string;
  stripePaymentIntentId: string;
  stripeClientSecret: string;
  amountCents: number;
  currency: string;
  applicationFeeAmountCents: number;
  status: PaymentIntentStatus;
  idempotencyKey: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  receiptUrl?: string | null;
  createdAt: string;
}

export interface CreatePaymentIntentRequest {
  milestoneId: string;
  savePaymentMethod?: boolean;
}

export interface ConfirmPaymentIntentRequest {
  paymentMethodId?: string;
  testTriggerOutcome?: "success" | "card_declined" | "requires_action" | "insufficient_funds";
}

export interface CustomerPaymentMethodDTO {
  id: string;
  customerId: string;
  stripePaymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  createdAt: string;
}

export interface StripeWebhookPayload {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
}

export interface ProcessRefundRequest {
  transactionId: string;
  amountCents: number;
  reason: string;
}

export interface ProcessRefundResponse {
  refundId: string;
  status: "REFUNDED";
  amountCents: number;
  providerReference: string;
}

// Append-Only Financial Ledger & Payout Holds (SH-08)
export type LedgerEntryType =
  | "CUSTOMER_CHARGE"
  | "APPLICATION_FEE"
  | "CONTRACTOR_PAYOUT"
  | "REFUND_DEBIT"
  | "DISPUTE_HOLD"
  | "PAYOUT_HOLD"
  | "PAYOUT_RELEASE"
  | "NEGATIVE_BALANCE_RECOVERY"
  | "MANUAL_ADJUSTMENT";

export type LedgerAccountType =
  | "CUSTOMER_RECEIVABLE"
  | "PLATFORM_REVENUE"
  | "CONTRACTOR_PAYABLE"
  | "STRIPE_CLEARING"
  | "DISPUTE_RESERVE"
  | "PAYOUT_ESCROW_HOLD";

export type PayoutHoldReason =
  | "MISSING_COMPLETION_EVIDENCE"
  | "ACTIVE_DISPUTE"
  | "COMPLIANCE_RESTRICTION"
  | "QUALITY_AUDIT_SAMPLE"
  | "NEGATIVE_CONTRACTOR_BALANCE"
  | "MANUAL_RISK_HOLD";

export type PayoutHoldStatus = "ACTIVE" | "RELEASED" | "FORFEITED";

export type ReconciliationStatus =
  | "BALANCED"
  | "DISCREPANCY_DETECTED"
  | "INVESTIGATING"
  | "RESOLVED";

export interface LedgerEntryDTO {
  id: string;
  entryType: LedgerEntryType;
  accountType: LedgerAccountType;
  direction: "DEBIT" | "CREDIT";
  amountCents: number;
  currency: string;
  contractorId?: string | null;
  customerId?: string | null;
  jobId?: string | null;
  milestoneId?: string | null;
  description: string;
  runningBalanceCents: number;
  createdAt: string;
}

export interface PayoutHoldDTO {
  id: string;
  contractorId: string;
  milestoneId: string;
  amountCents: number;
  currency: string;
  holdReason: PayoutHoldReason;
  holdStatus: PayoutHoldStatus;
  requiredEvidenceType?: string | null;
  evidenceAttachmentId?: string | null;
  releaseNotes?: string | null;
  createdAt: string;
  releasedAt?: string | null;
}

export interface ContractorPayoutBalanceDTO {
  contractorId: string;
  availableBalanceCents: number;
  heldBalanceCents: number;
  lifetimeEarningsCents: number;
  lifetimePayoutsCents: number;
  isNegative: boolean;
  currency: string;
}

export interface FinancialReconciliationReportDTO {
  id: string;
  reportDate: string;
  totalChargesCents: number;
  totalPlatformFeesCents: number;
  totalContractorPayoutsCents: number;
  totalRefundsCents: number;
  totalActiveHoldsCents: number;
  discrepancyCents: number;
  status: ReconciliationStatus;
  unreconciledTransactionIds: string[];
  createdAt: string;
}

