import { describe, expect, it } from "vitest";
import {
  calculateApplicationFee,
  generateTestWebhookSignature,
  StripeSandboxService,
  StripeSignatureError,
  verifyStripeWebhookSignature,
} from "./index.js";

describe("Stripe Webhook Signature Verification (#8, SH-07)", () => {
  const secret = "whsec_test_secret_for_skilled_hire_ontario_hvac";
  const payload = JSON.stringify({
    id: "evt_test_123456789",
    type: "payment_intent.succeeded",
    created: 1729000000,
    data: {
      object: {
        id: "pi_test_987654321",
        amount: 25000,
        currency: "cad",
        status: "succeeded",
      },
    },
  });

  it("successfully verifies valid signature and parses payload", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = generateTestWebhookSignature(payload, secret, now);
    const event = verifyStripeWebhookSignature(payload, header, secret, 300, now);

    expect(event.id).toBe("evt_test_123456789");
    expect(event.type).toBe("payment_intent.succeeded");
    expect(event.data.object["amount"]).toBe(25000);
  });

  it("fails closed when signature header is missing or empty", () => {
    expect(() =>
      verifyStripeWebhookSignature(payload, undefined as unknown as string, secret),
    ).toThrowError(StripeSignatureError);

    try {
      verifyStripeWebhookSignature(payload, "", secret);
    } catch (err) {
      expect((err as StripeSignatureError).code).toBe("STRIPE_SIGNATURE_MISSING");
    }
  });

  it("fails closed when webhook secret is mismatched", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = generateTestWebhookSignature(payload, "whsec_wrong_secret", now);

    expect(() =>
      verifyStripeWebhookSignature(payload, header, secret, 300, now),
    ).toThrowError(StripeSignatureError);

    try {
      verifyStripeWebhookSignature(payload, header, secret, 300, now);
    } catch (err) {
      expect((err as StripeSignatureError).code).toBe("STRIPE_SIGNATURE_MISMATCH");
    }
  });

  it("fails closed when payload is tampered", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = generateTestWebhookSignature(payload, secret, now);
    const tamperedPayload = payload.replace("25000", "5000");

    expect(() =>
      verifyStripeWebhookSignature(tamperedPayload, header, secret, 300, now),
    ).toThrowError(StripeSignatureError);

    try {
      verifyStripeWebhookSignature(tamperedPayload, header, secret, 300, now);
    } catch (err) {
      expect((err as StripeSignatureError).code).toBe("STRIPE_SIGNATURE_MISMATCH");
    }
  });

  it("enforces timestamp tolerance window against replay attacks (> 300s)", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const header = generateTestWebhookSignature(payload, secret, oldTimestamp);
    const currentTimestamp = Math.floor(Date.now() / 1000);

    try {
      verifyStripeWebhookSignature(payload, header, secret, 300, currentTimestamp);
      expect.unreachable();
    } catch (err) {
      expect((err as StripeSignatureError).code).toBe("STRIPE_TIMESTAMP_OUT_OF_RANGE");
    }
  });

  it("handles malformed JSON payload cleanly", () => {
    const now = Math.floor(Date.now() / 1000);
    const badJson = "not_json_payload";
    const header = generateTestWebhookSignature(badJson, secret, now);

    try {
      verifyStripeWebhookSignature(badJson, header, secret, 300, now);
      expect.unreachable();
    } catch (err) {
      expect((err as StripeSignatureError).code).toBe("STRIPE_INVALID_PAYLOAD");
    }
  });
});

describe("Application Fee Calculation (#8)", () => {
  it("calculates standard 5% platform fee correctly", () => {
    expect(calculateApplicationFee(10000)).toBe(500); // $100 -> $5
    expect(calculateApplicationFee(49900)).toBe(2495); // $499 -> $24.95
    expect(calculateApplicationFee(0)).toBe(0);
    expect(calculateApplicationFee(-100)).toBe(0);
  });
});

describe("Stripe Sandbox Service (#8, SH-07)", () => {
  it("prevents accidental live mode execution without authorization", () => {
    expect(() => {
      new StripeSandboxService({
        apiKey: "sk_live_1234567890",
        allowLiveMode: false,
      });
    }).toThrow("Live payment mode is restricted and requires explicit admin authorization");
  });

  it("generates Connect Express onboarding links in sandbox mode", async () => {
    const service = new StripeSandboxService();
    const result = await service.createConnectOnboardingLink({
      contractorId: "contractor-uuid-123",
      returnUrl: "https://contractor.skilledhire.ca/success",
    });

    expect(result.accountId).toMatch(/^acct_test_/);
    expect(result.onboardingUrl).toContain("connect.stripe.com/express/sandbox/onboarding");
    expect(result.onboardingUrl).toContain(encodeURIComponent("https://contractor.skilledhire.ca/success"));
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("creates PaymentIntents with destination application fees and client secret", async () => {
    const service = new StripeSandboxService();
    const result = await service.createPaymentIntent({
      milestoneId: "milestone-123",
      customerId: "cust-123",
      amountCents: 35000, // $350 CAD
      currency: "cad",
      idempotencyKey: "idemp-key-unique-test-1",
    });

    expect(result.paymentIntentId).toMatch(/^pi_test_/);
    expect(result.clientSecret).toContain("_secret_");
    expect(result.amountCents).toBe(35000);
    expect(result.applicationFeeAmountCents).toBe(1750); // 5% of 35000
    expect(result.status).toBe("REQUIRES_PAYMENT_METHOD");
    expect(result.currency).toBe("CAD");
  });

  it("confirms PaymentIntent with success outcome", async () => {
    const service = new StripeSandboxService();
    const result = await service.confirmPaymentIntent({
      paymentIntentId: "pi_test_abc123",
      amountCents: 35000,
      currency: "CAD",
      testTriggerOutcome: "success",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.receiptUrl).toContain("pay.stripe.com/receipts/sandbox/");
  });

  it("simulates card decline gracefully", async () => {
    const service = new StripeSandboxService();
    const result = await service.confirmPaymentIntent({
      paymentIntentId: "pi_test_declined",
      amountCents: 35000,
      currency: "CAD",
      testTriggerOutcome: "card_declined",
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("card_declined");
    expect(result.failureMessage).toBeDefined();
  });

  it("simulates insufficient funds gracefully", async () => {
    const service = new StripeSandboxService();
    const result = await service.confirmPaymentIntent({
      paymentIntentId: "pi_test_nsf",
      amountCents: 35000,
      currency: "CAD",
      testTriggerOutcome: "insufficient_funds",
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("insufficient_funds");
  });

  it("simulates 3D Secure / SCA requires action gracefully", async () => {
    const service = new StripeSandboxService();
    const result = await service.confirmPaymentIntent({
      paymentIntentId: "pi_test_3ds",
      amountCents: 35000,
      currency: "CAD",
      testTriggerOutcome: "requires_action",
    });

    expect(result.status).toBe("REQUIRES_ACTION");
  });

  it("processes refunds in sandbox mode", async () => {
    const service = new StripeSandboxService();
    const refund = await service.refundPayment({
      transactionProviderReference: "pi_test_abc123",
      amountCents: 10000,
      reason: "Requested by customer",
      idempotencyKey: "refund-idemp-12345",
    });

    expect(refund.refundReference).toMatch(/^re_test_/);
    expect(refund.status).toBe("SUCCEEDED");
  });
});
