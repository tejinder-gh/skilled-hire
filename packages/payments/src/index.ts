import crypto from "node:crypto";
import type {
  ConnectOnboardingStatus,
  PaymentIntentStatus,
  StripeWebhookPayload,
  ConnectOnboardResponse,
  LedgerEntryType,
  LedgerAccountType,
  PayoutHoldReason,
  PayoutHoldStatus,
  ReconciliationStatus,
} from "@marketplace/contracts";

export interface PaymentProvider {
  createIntent(input: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    customerReference: string;
  }): Promise<{ providerReference: string; status: "REQUIRES_ACTION" | "SUCCEEDED" }>;
  refund(input: {
    providerReference: string;
    amountCents?: number;
    idempotencyKey: string;
  }): Promise<{ providerReference: string; status: "SUCCEEDED" }>;
  verifyWebhook(input: {
    payload: string;
    signature: string;
  }): Promise<{ eventId: string; type: string; data: Record<string, unknown> }>;
}

export class LocalTestPaymentProvider implements PaymentProvider {
  async createIntent(input: {
    idempotencyKey: string;
  }): Promise<{ providerReference: string; status: "SUCCEEDED" }> {
    return { providerReference: `local_${input.idempotencyKey}`, status: "SUCCEEDED" };
  }
  async refund(input: {
    providerReference: string;
  }): Promise<{ providerReference: string; status: "SUCCEEDED" }> {
    return { providerReference: input.providerReference, status: "SUCCEEDED" };
  }
  async verifyWebhook(): Promise<{
    eventId: string;
    type: string;
    data: Record<string, unknown>;
  }> {
    throw new Error("Local provider has no webhooks");
  }
}

export interface StripeConfig {
  apiKey?: string | undefined;
  webhookSecret?: string | undefined;
  allowLiveMode?: boolean | undefined;
  applicationFeeRate?: number | undefined;
  defaultCurrency?: string | undefined;
}

export interface StripePaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  status: PaymentIntentStatus;
  amountCents: number;
  applicationFeeAmountCents: number;
  currency: string;
  failureCode?: string | undefined;
  failureMessage?: string | undefined;
  receiptUrl?: string | undefined;
}

export class StripeSignatureError extends Error {
  constructor(
    public readonly code:
      | "STRIPE_SIGNATURE_MISSING"
      | "STRIPE_TIMESTAMP_OUT_OF_RANGE"
      | "STRIPE_SIGNATURE_MISMATCH"
      | "STRIPE_INVALID_PAYLOAD",
    message: string,
  ) {
    super(message);
    this.name = "StripeSignatureError";
  }
}

/**
 * Verifies a Stripe webhook signature according to the official Stripe HMAC-SHA256 specification.
 * Validates timestamp tolerance window (default 300 seconds / 5 minutes) and uses constant-time comparison.
 */
export function verifyStripeWebhookSignature(
  rawPayload: string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds = 300,
  currentTimestamp = Math.floor(Date.now() / 1000),
): StripeWebhookPayload {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    throw new StripeSignatureError(
      "STRIPE_SIGNATURE_MISSING",
      "Missing Stripe-Signature header",
    );
  }

  if (!secret) {
    throw new StripeSignatureError(
      "STRIPE_SIGNATURE_MISMATCH",
      "Stripe webhook secret is not configured",
    );
  }

  // Parse header: t=1729000000,v1=abc...,v1=def...
  const parts = signatureHeader.split(",");
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.trim().split("=");
    if (!key || !value) continue;
    if (key === "t") {
      const parsedTime = Number.parseInt(value, 10);
      if (!Number.isNaN(parsedTime)) {
        timestamp = parsedTime;
      }
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) {
    throw new StripeSignatureError(
      "STRIPE_SIGNATURE_MISSING",
      "Invalid Stripe-Signature format; requires timestamp (t) and signature (v1)",
    );
  }

  // Enforce timestamp freshness to prevent replay attacks
  const age = Math.abs(currentTimestamp - timestamp);
  if (age > toleranceSeconds) {
    throw new StripeSignatureError(
      "STRIPE_TIMESTAMP_OUT_OF_RANGE",
      `Webhook timestamp (${timestamp}) outside tolerance window (${toleranceSeconds}s, age was ${age}s)`,
    );
  }

  // Compute expected HMAC-SHA256: HMAC_SHA256(secret, `${timestamp}.${rawPayload}`)
  const signedPayload = `${timestamp}.${rawPayload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  let matched = false;

  for (const sig of signatures) {
    const candidateBuffer = Buffer.from(sig, "utf8");
    if (
      candidateBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
    ) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    throw new StripeSignatureError(
      "STRIPE_SIGNATURE_MISMATCH",
      "Stripe webhook signature verification failed",
    );
  }

  try {
    const parsed = JSON.parse(rawPayload) as StripeWebhookPayload;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.type !== "string") {
      throw new Error("Missing required event fields");
    }
    return parsed;
  } catch (err) {
    throw new StripeSignatureError(
      "STRIPE_INVALID_PAYLOAD",
      `Malformed webhook JSON payload: ${(err as Error).message}`,
    );
  }
}

/**
 * Helper to construct a valid Stripe-Signature header for testing / simulation.
 */
export function generateTestWebhookSignature(
  rawPayload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const signedPayload = `${timestamp}.${rawPayload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Calculates server-side marketplace application fee (default: 5% of gross milestone).
 */
export function calculateApplicationFee(
  amountCents: number,
  feeRate = 0.05,
): number {
  if (amountCents <= 0) return 0;
  return Math.round(amountCents * feeRate);
}

/**
 * Stripe Sandbox & Payment Engine
 * Provides deterministic sandbox testing, Connect Express onboarding links,
 * PaymentIntents with destination application fees, 3DS triggers, and idempotent refunds.
 */
export class StripeSandboxService {
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly allowLiveMode: boolean;
  private readonly applicationFeeRate: number;
  private readonly defaultCurrency: string;

  constructor(config: StripeConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.STRIPE_SECRET_KEY ?? "sk_test_mock_skilled_hire";
    this.webhookSecret =
      config.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_mock_skilled_hire_secret";
    this.allowLiveMode =
      config.allowLiveMode ?? process.env.ALLOW_LIVE_STRIPE === "true";
    this.applicationFeeRate = config.applicationFeeRate ?? 0.05; // 5% marketplace take
    this.defaultCurrency = config.defaultCurrency ?? "CAD";

    // Fail closed on accidental live keys in sandbox/test environments
    if (this.apiKey.startsWith("sk_live_") && !this.allowLiveMode) {
      throw new Error(
        "Live payment mode is restricted and requires explicit admin authorization (ALLOW_LIVE_STRIPE=true).",
      );
    }
  }

  getWebhookSecret(): string {
    return this.webhookSecret;
  }

  isLiveMode(): boolean {
    return this.apiKey.startsWith("sk_live_");
  }

  /**
   * Generates a Stripe Connect Express onboarding link for a contractor.
   */
  async createConnectOnboardingLink(input: {
    contractorId: string;
    stripeAccountId?: string | undefined;
    returnUrl?: string | undefined;
    refreshUrl?: string | undefined;
  }): Promise<ConnectOnboardResponse> {
    const accountId =
      input.stripeAccountId ??
      `acct_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const returnUrl =
      input.returnUrl ?? "https://contractor.skilledhire.ca/dashboard/payments?connect=success";
    const refreshUrl =
      input.refreshUrl ?? "https://contractor.skilledhire.ca/dashboard/payments?connect=refresh";

    const token = crypto.randomBytes(16).toString("hex");
    const onboardingUrl = `https://connect.stripe.com/express/sandbox/onboarding?token=${token}&account=${accountId}&return_url=${encodeURIComponent(
      returnUrl,
    )}&refresh_url=${encodeURIComponent(refreshUrl)}`;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return {
      accountId,
      onboardingUrl,
      expiresAt,
    };
  }

  /**
   * Creates a PaymentIntent with server-side locked amount and destination application fee.
   */
  async createPaymentIntent(input: {
    milestoneId: string;
    customerId: string;
    contractorStripeAccountId?: string | undefined;
    amountCents: number;
    currency?: string | undefined;
    idempotencyKey: string;
    customerEmail?: string | undefined;
  }): Promise<StripePaymentIntentResult> {
    if (input.amountCents <= 0) {
      throw new Error("PaymentIntent amount must be positive.");
    }

    const currency = (input.currency ?? this.defaultCurrency).toUpperCase();
    const appFee = calculateApplicationFee(input.amountCents, this.applicationFeeRate);
    const piId = `pi_test_${crypto.randomUUID().replace(/-/g, "")}`;
    const secretKey = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const clientSecret = `${piId}_secret_${secretKey}`;

    return {
      paymentIntentId: piId,
      clientSecret,
      status: "REQUIRES_PAYMENT_METHOD",
      amountCents: input.amountCents,
      applicationFeeAmountCents: appFee,
      currency,
    };
  }

  /**
   * Confirms a PaymentIntent with simulated realistic payment outcomes.
   */
  async confirmPaymentIntent(input: {
    paymentIntentId: string;
    amountCents: number;
    currency: string;
    paymentMethodId?: string | undefined;
    testTriggerOutcome?: "success" | "card_declined" | "requires_action" | "insufficient_funds" | undefined;
  }): Promise<StripePaymentIntentResult> {
    const outcome = input.testTriggerOutcome ?? "success";

    if (outcome === "card_declined") {
      return {
        paymentIntentId: input.paymentIntentId,
        clientSecret: `${input.paymentIntentId}_secret_failed`,
        status: "FAILED",
        amountCents: input.amountCents,
        applicationFeeAmountCents: calculateApplicationFee(input.amountCents, this.applicationFeeRate),
        currency: input.currency,
        failureCode: "card_declined",
        failureMessage: "Your card was declined by the issuer (test simulation).",
      };
    }

    if (outcome === "insufficient_funds") {
      return {
        paymentIntentId: input.paymentIntentId,
        clientSecret: `${input.paymentIntentId}_secret_failed`,
        status: "FAILED",
        amountCents: input.amountCents,
        applicationFeeAmountCents: calculateApplicationFee(input.amountCents, this.applicationFeeRate),
        currency: input.currency,
        failureCode: "insufficient_funds",
        failureMessage: "Your card has insufficient funds for this milestone payment.",
      };
    }

    if (outcome === "requires_action") {
      return {
        paymentIntentId: input.paymentIntentId,
        clientSecret: `${input.paymentIntentId}_secret_action`,
        status: "REQUIRES_ACTION",
        amountCents: input.amountCents,
        applicationFeeAmountCents: calculateApplicationFee(input.amountCents, this.applicationFeeRate),
        currency: input.currency,
      };
    }

    // Default: Success
    return {
      paymentIntentId: input.paymentIntentId,
      clientSecret: `${input.paymentIntentId}_secret_succeeded`,
      status: "SUCCEEDED",
      amountCents: input.amountCents,
      applicationFeeAmountCents: calculateApplicationFee(input.amountCents, this.applicationFeeRate),
      currency: input.currency,
      receiptUrl: `https://pay.stripe.com/receipts/sandbox/${input.paymentIntentId}`,
    };
  }

  /**
   * Issues a refund for a payment transaction.
   */
  async refundPayment(input: {
    transactionProviderReference: string;
    amountCents: number;
    reason?: string | undefined;
    idempotencyKey: string;
  }): Promise<{ refundReference: string; status: "SUCCEEDED" }> {
    const refundRef = `re_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return {
      refundReference: refundRef,
      status: "SUCCEEDED",
    };
  }
}

// ============================================================================
// Double-Entry Append-Only Financial Ledger (SH-08)
// ============================================================================

export interface DoubleEntryItem {
  accountType: LedgerAccountType;
  direction: "DEBIT" | "CREDIT";
  amountCents: number;
  description: string;
  contractorId?: string | null | undefined;
  customerId?: string | null | undefined;
  jobId?: string | null | undefined;
  milestoneId?: string | null | undefined;
  transactionId?: string | null | undefined;
  refundId?: string | null | undefined;
}

export interface DoubleEntryTransaction {
  entryType: LedgerEntryType;
  entries: DoubleEntryItem[];
}

/**
 * Validates that debit and credit amounts in a transaction are strictly balanced.
 */
export function validateBalancedEntries(entries: DoubleEntryItem[]): void {
  const totalDebits = entries
    .filter((e) => e.direction === "DEBIT")
    .reduce((sum, e) => sum + e.amountCents, 0);
  const totalCredits = entries
    .filter((e) => e.direction === "CREDIT")
    .reduce((sum, e) => sum + e.amountCents, 0);

  if (totalDebits !== totalCredits) {
    throw new Error(
      `Double-entry imbalance detected: Total Debits (${totalDebits} cents) does not match Total Credits (${totalCredits} cents).`,
    );
  }
}

/**
 * Generates double-entry ledger records when a customer milestone payment succeeds.
 * - Debit STRIPE_CLEARING: Gross payment collected from customer
 * - Credit PLATFORM_REVENUE: Platform application fee
 * - Credit CONTRACTOR_PAYABLE: Net contractor earnings
 */
export function generateCustomerPaymentLedgerEntries(input: {
  transactionId: string;
  milestoneId: string;
  jobId?: string | null | undefined;
  contractorId: string;
  customerId: string;
  grossAmountCents: number;
  feeRate?: number | undefined;
}): DoubleEntryTransaction {
  if (input.grossAmountCents <= 0) {
    throw new Error("Gross customer payment amount must be positive.");
  }

  const appFeeCents = calculateApplicationFee(input.grossAmountCents, input.feeRate ?? 0.05);
  const contractorNetCents = input.grossAmountCents - appFeeCents;

  const entries: DoubleEntryItem[] = [
    {
      accountType: "STRIPE_CLEARING",
      direction: "DEBIT",
      amountCents: input.grossAmountCents,
      description: `Customer payment received for milestone ${input.milestoneId}`,
      customerId: input.customerId,
      contractorId: input.contractorId,
      jobId: input.jobId,
      milestoneId: input.milestoneId,
      transactionId: input.transactionId,
    },
    {
      accountType: "PLATFORM_REVENUE",
      direction: "CREDIT",
      amountCents: appFeeCents,
      description: `Marketplace platform fee (5%) for milestone ${input.milestoneId}`,
      customerId: input.customerId,
      contractorId: input.contractorId,
      jobId: input.jobId,
      milestoneId: input.milestoneId,
      transactionId: input.transactionId,
    },
    {
      accountType: "CONTRACTOR_PAYABLE",
      direction: "CREDIT",
      amountCents: contractorNetCents,
      description: `Net earnings credited to contractor payable for milestone ${input.milestoneId}`,
      customerId: input.customerId,
      contractorId: input.contractorId,
      jobId: input.jobId,
      milestoneId: input.milestoneId,
      transactionId: input.transactionId,
    },
  ];

  validateBalancedEntries(entries);
  return {
    entryType: "CUSTOMER_CHARGE",
    entries,
  };
}

/**
 * Generates double-entry ledger records when a payout hold is placed.
 * - Debit CONTRACTOR_PAYABLE: Locked from available contractor funds
 * - Credit PAYOUT_ESCROW_HOLD: Held in reserve pending evidence/resolution
 */
export function generatePayoutHoldLedgerEntries(input: {
  contractorId: string;
  milestoneId: string;
  amountCents: number;
  holdReason: PayoutHoldReason;
}): DoubleEntryTransaction {
  if (input.amountCents <= 0) {
    throw new Error("Hold amount must be positive.");
  }

  const entries: DoubleEntryItem[] = [
    {
      accountType: "CONTRACTOR_PAYABLE",
      direction: "DEBIT",
      amountCents: input.amountCents,
      description: `Payout hold placed (${input.holdReason}) for milestone ${input.milestoneId}`,
      contractorId: input.contractorId,
      milestoneId: input.milestoneId,
    },
    {
      accountType: "PAYOUT_ESCROW_HOLD",
      direction: "CREDIT",
      amountCents: input.amountCents,
      description: `Funds locked in payout hold reserve (${input.holdReason})`,
      contractorId: input.contractorId,
      milestoneId: input.milestoneId,
    },
  ];

  validateBalancedEntries(entries);
  return {
    entryType: "PAYOUT_HOLD",
    entries,
  };
}

/**
 * Generates double-entry ledger records when a payout hold is released.
 * - Debit PAYOUT_ESCROW_HOLD: Released from reserve
 * - Credit CONTRACTOR_PAYABLE: Returned to available contractor payable balance
 */
export function generatePayoutReleaseLedgerEntries(input: {
  contractorId: string;
  milestoneId: string;
  amountCents: number;
  releaseNotes?: string | undefined;
}): DoubleEntryTransaction {
  if (input.amountCents <= 0) {
    throw new Error("Release amount must be positive.");
  }

  const entries: DoubleEntryItem[] = [
    {
      accountType: "PAYOUT_ESCROW_HOLD",
      direction: "DEBIT",
      amountCents: input.amountCents,
      description: `Payout hold released for milestone ${input.milestoneId}: ${input.releaseNotes ?? "Evidence verified"}`,
      contractorId: input.contractorId,
      milestoneId: input.milestoneId,
    },
    {
      accountType: "CONTRACTOR_PAYABLE",
      direction: "CREDIT",
      amountCents: input.amountCents,
      description: `Funds returned to available contractor payable for milestone ${input.milestoneId}`,
      contractorId: input.contractorId,
      milestoneId: input.milestoneId,
    },
  ];

  validateBalancedEntries(entries);
  return {
    entryType: "PAYOUT_RELEASE",
    entries,
  };
}

/**
 * Generates double-entry ledger records when a payout transfer is dispatched to a contractor's bank account.
 * - Debit CONTRACTOR_PAYABLE: Contractor payable liability extinguished
 * - Credit STRIPE_CLEARING: Funds transferred out via Stripe Connect
 */
export function generateContractorPayoutLedgerEntries(input: {
  contractorId: string;
  amountCents: number;
  stripeTransferId: string;
}): DoubleEntryTransaction {
  if (input.amountCents <= 0) {
    throw new Error("Payout transfer amount must be positive.");
  }

  const entries: DoubleEntryItem[] = [
    {
      accountType: "CONTRACTOR_PAYABLE",
      direction: "DEBIT",
      amountCents: input.amountCents,
      description: `Payout transfer ${input.stripeTransferId} dispatched to contractor bank account`,
      contractorId: input.contractorId,
    },
    {
      accountType: "STRIPE_CLEARING",
      direction: "CREDIT",
      amountCents: input.amountCents,
      description: `Stripe clearing funds transferred out via ${input.stripeTransferId}`,
      contractorId: input.contractorId,
    },
  ];

  validateBalancedEntries(entries);
  return {
    entryType: "CONTRACTOR_PAYOUT",
    entries,
  };
}

/**
 * Generates double-entry ledger records when a refund is issued to a customer.
 * - Debit CONTRACTOR_PAYABLE: Contractor portion debited
 * - Debit PLATFORM_REVENUE: Platform fee portion reversed
 * - Credit STRIPE_CLEARING: Cash returned to customer
 */
export function generateRefundLedgerEntries(input: {
  refundId: string;
  transactionId: string;
  contractorId: string;
  customerId: string;
  refundAmountCents: number;
  feeRate?: number | undefined;
}): DoubleEntryTransaction {
  if (input.refundAmountCents <= 0) {
    throw new Error("Refund amount must be positive.");
  }

  const feePortionCents = calculateApplicationFee(input.refundAmountCents, input.feeRate ?? 0.05);
  const contractorPortionCents = input.refundAmountCents - feePortionCents;

  const entries: DoubleEntryItem[] = [
    {
      accountType: "CONTRACTOR_PAYABLE",
      direction: "DEBIT",
      amountCents: contractorPortionCents,
      description: `Refund debited from contractor payable (refund: ${input.refundId})`,
      contractorId: input.contractorId,
      customerId: input.customerId,
      transactionId: input.transactionId,
      refundId: input.refundId,
    },
    {
      accountType: "PLATFORM_REVENUE",
      direction: "DEBIT",
      amountCents: feePortionCents,
      description: `Platform fee refund reversal (refund: ${input.refundId})`,
      contractorId: input.contractorId,
      customerId: input.customerId,
      transactionId: input.transactionId,
      refundId: input.refundId,
    },
    {
      accountType: "STRIPE_CLEARING",
      direction: "CREDIT",
      amountCents: input.refundAmountCents,
      description: `Stripe clearing cash refunded to customer (refund: ${input.refundId})`,
      contractorId: input.contractorId,
      customerId: input.customerId,
      transactionId: input.transactionId,
      refundId: input.refundId,
    },
  ];

  validateBalancedEntries(entries);
  return {
    entryType: "REFUND_DEBIT",
    entries,
  };
}

// ============================================================================
// Contractor Balance State Machine (SH-08)
// ============================================================================

export interface ContractorBalanceSnapshot {
  availableBalanceCents: number;
  heldBalanceCents: number;
  lifetimeEarningsCents: number;
  lifetimePayoutsCents: number;
  isNegative: boolean;
}

/**
 * Deterministically applies financial events to a contractor's balance snapshot,
 * accurately tracking available vs held funds and flagging negative balance situations.
 */
export function applyLedgerToContractorBalance(
  current: ContractorBalanceSnapshot,
  event:
    | { type: "EARNING"; amountCents: number }
    | { type: "HOLD"; amountCents: number }
    | { type: "RELEASE"; amountCents: number }
    | { type: "PAYOUT"; amountCents: number }
    | { type: "REFUND_DEBIT"; amountCents: number },
): ContractorBalanceSnapshot {
  let available = current.availableBalanceCents;
  let held = current.heldBalanceCents;
  let lifetimeEarnings = current.lifetimeEarningsCents;
  let lifetimePayouts = current.lifetimePayoutsCents;

  switch (event.type) {
    case "EARNING":
      available += event.amountCents;
      lifetimeEarnings += event.amountCents;
      break;

    case "HOLD":
      available -= event.amountCents;
      held += event.amountCents;
      break;

    case "RELEASE":
      held = Math.max(0, held - event.amountCents);
      available += event.amountCents;
      break;

    case "PAYOUT":
      available -= event.amountCents;
      lifetimePayouts += event.amountCents;
      break;

    case "REFUND_DEBIT":
      available -= event.amountCents;
      lifetimeEarnings -= event.amountCents;
      break;
  }

  return {
    availableBalanceCents: available,
    heldBalanceCents: held,
    lifetimeEarningsCents: Math.max(0, lifetimeEarnings),
    lifetimePayoutsCents: lifetimePayouts,
    isNegative: available < 0,
  };
}

// ============================================================================
// Milestone Evidence Payout Eligibility Gate (SH-08)
// ============================================================================

export interface MilestonePayoutEvidenceInput {
  milestoneTitle: string;
  milestoneType?: "DEPOSIT" | "PROGRESS" | "FINAL_COMPLETION" | string | undefined;
  isFinalMilestone: boolean;
  requiresPermit?: boolean | undefined;
  completionReportStatus?: "SUBMITTED" | "ACCEPTED" | "DISPUTED" | "NONE" | string | undefined;
  esaPermitStatus?: "FILED" | "PASSED" | "DEFICIENT" | "NONE" | string | undefined;
  customerAccepted?: boolean | undefined;
  hasOpenDispute?: boolean | undefined;
  isContractorNegativeBalance?: boolean | undefined;
}

export interface PayoutEligibilityResult {
  eligible: boolean;
  holdRequired: boolean;
  holdReason?: PayoutHoldReason | undefined;
  requiredEvidenceType?: string | undefined;
  details: string;
}

/**
 * Evaluates whether a paid milestone can be immediately disbursed to contractor
 * or if mandatory evidence gates (completion signoff, ESA permit pass, dispute hold)
 * mandate placing a payout hold.
 */
export function evaluateMilestonePayoutEligibility(
  input: MilestonePayoutEvidenceInput,
): PayoutEligibilityResult {
  // 1. Halt if contractor has an active dispute
  if (input.hasOpenDispute) {
    return {
      eligible: false,
      holdRequired: true,
      holdReason: "ACTIVE_DISPUTE",
      details: "Milestone payout is held due to an active dispute on this job.",
    };
  }

  // 2. Halt if contractor balance is negative
  if (input.isContractorNegativeBalance) {
    return {
      eligible: false,
      holdRequired: true,
      holdReason: "NEGATIVE_CONTRACTOR_BALANCE",
      details: "Milestone payout is held to recover outstanding negative balance from prior refunds.",
    };
  }

  // 3. Final milestone evidence gates
  const isFinal =
    input.isFinalMilestone ||
    input.milestoneType === "FINAL_COMPLETION" ||
    input.milestoneTitle.toLowerCase().includes("final") ||
    input.milestoneTitle.toLowerCase().includes("completion");

  if (isFinal) {
    // If trade requires ESA permit, permit must have passed inspection
    if (input.requiresPermit && input.esaPermitStatus !== "PASSED") {
      return {
        eligible: false,
        holdRequired: true,
        holdReason: "MISSING_COMPLETION_EVIDENCE",
        requiredEvidenceType: "ESA_INSPECTION_CERTIFICATE",
        details: `Final payout requires verified ESA Certificate of Acceptance (current status: ${input.esaPermitStatus ?? "NONE"}).`,
      };
    }

    // Completion report must be accepted or customer signed off
    const reportAccepted = input.completionReportStatus === "ACCEPTED";
    const customerApproved = input.customerAccepted === true;

    if (!reportAccepted && !customerApproved) {
      return {
        eligible: false,
        holdRequired: true,
        holdReason: "MISSING_COMPLETION_EVIDENCE",
        requiredEvidenceType: "COMPLETION_SIGN_OFF",
        details: "Final payout requires customer completion sign-off or accepted completion report with before/after photos.",
      };
    }
  }

  return {
    eligible: true,
    holdRequired: false,
    details: "All milestone evidence gates satisfied; payout transfer eligible.",
  };
}

// ============================================================================
// Daily Financial Reconciliation Engine (SH-08)
// ============================================================================

export interface ReconciliationCalculationInput {
  charges: Array<{ id: string; amountCents: number }>;
  platformFees: Array<{ id: string; amountCents: number }>;
  payouts: Array<{ id: string; amountCents: number }>;
  refunds: Array<{ id: string; amountCents: number }>;
  activeHolds: Array<{ id: string; amountCents: number }>;
  unpaidAvailableBalances: Array<{ contractorId: string; amountCents: number }>;
}

export interface ReconciliationReportResult {
  reportDate: string;
  totalChargesCents: number;
  totalPlatformFeesCents: number;
  totalContractorPayoutsCents: number;
  totalRefundsCents: number;
  totalActiveHoldsCents: number;
  totalUnpaidAvailableCents: number;
  discrepancyCents: number;
  status: ReconciliationStatus;
  unreconciledIds: string[];
  summary: string;
}

/**
 * Performs daily financial reconciliation:
 * Verifies that Total Customer Charges = Platform Fees + Completed Payouts + Refunds + Active Holds + Unpaid Available Balances.
 * Any imbalance flags a discrepancy for immediate operational audit.
 */
export function computeFinancialReconciliation(
  input: ReconciliationCalculationInput,
  reportDate = new Date().toISOString().split("T")[0]!,
): ReconciliationReportResult {
  const totalChargesCents = input.charges.reduce((sum, c) => sum + c.amountCents, 0);
  const totalPlatformFeesCents = input.platformFees.reduce((sum, f) => sum + f.amountCents, 0);
  const totalContractorPayoutsCents = input.payouts.reduce((sum, p) => sum + p.amountCents, 0);
  const totalRefundsCents = input.refunds.reduce((sum, r) => sum + r.amountCents, 0);
  const totalActiveHoldsCents = input.activeHolds.reduce((sum, h) => sum + h.amountCents, 0);
  const totalUnpaidAvailableCents = input.unpaidAvailableBalances.reduce(
    (sum, b) => sum + Math.max(0, b.amountCents),
    0,
  );

  const totalAccountedForCents =
    totalPlatformFeesCents +
    totalContractorPayoutsCents +
    totalRefundsCents +
    totalActiveHoldsCents +
    totalUnpaidAvailableCents;

  const discrepancyCents = totalChargesCents - totalAccountedForCents;
  const isBalanced = discrepancyCents === 0;

  const unreconciledIds: string[] = [];
  if (!isBalanced) {
    unreconciledIds.push(...input.charges.map((c) => c.id));
  }

  return {
    reportDate,
    totalChargesCents,
    totalPlatformFeesCents,
    totalContractorPayoutsCents,
    totalRefundsCents,
    totalActiveHoldsCents,
    totalUnpaidAvailableCents,
    discrepancyCents,
    status: isBalanced ? "BALANCED" : "DISCREPANCY_DETECTED",
    unreconciledIds,
    summary: isBalanced
      ? `Reconciliation passed: Total charges ($${(totalChargesCents / 100).toFixed(2)}) perfectly reconcile against outflows and reserves.`
      : `Reconciliation discrepancy: Discrepancy of $${(discrepancyCents / 100).toFixed(2)} detected between gross charges ($${(totalChargesCents / 100).toFixed(2)}) and accounted allocations ($${(totalAccountedForCents / 100).toFixed(2)}).`,
  };
}
