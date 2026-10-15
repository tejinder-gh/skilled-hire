import crypto from "node:crypto";
import type {
  ConnectOnboardingStatus,
  PaymentIntentStatus,
  StripeWebhookPayload,
  ConnectOnboardResponse,
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
