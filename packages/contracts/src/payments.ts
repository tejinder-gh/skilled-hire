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
