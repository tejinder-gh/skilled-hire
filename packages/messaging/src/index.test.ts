import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  evaluateNotificationPreference,
  computeExponentialBackoff,
  generateOutboxIdempotencyKey,
  SandboxMessagingProvider,
  evaluateAndDispatchOutboxItem,
  CANONICAL_TEMPLATES,
} from "./index.js";

describe("Transactional Outbox & Reliable Messaging Engine (#10, SH-09)", () => {
  describe("Template Engine & Canonical Templates", () => {
    it("interpolates variables into template strings accurately", () => {
      const template = "Hello {{customerName}}, your HVAC appointment is on {{date}} at {{time}}.";
      const vars = { customerName: "Eleanor", date: "2026-10-16", time: "10:00 AM" };
      const result = renderTemplate(template, vars);
      expect(result).toBe("Hello Eleanor, your HVAC appointment is on 2026-10-16 at 10:00 AM.");
    });

    it("handles missing variables gracefully without crashing", () => {
      const template = "Job #{{jobId}} assigned to {{techName}} (notes: {{notes}}).";
      const vars = { jobId: "job-101", techName: "Alex" };
      const result = renderTemplate(template, vars);
      expect(result).toBe("Job #job-101 assigned to Alex (notes: ).");
    });

    it("contains valid Ontario HVAC canonical templates", () => {
      expect(CANONICAL_TEMPLATES["ontario_hvac_emergency_dispatch_v1:SMS"]).toBeDefined();
      expect(CANONICAL_TEMPLATES["ontario_hvac_payment_confirmed_v1:EMAIL"]).toBeDefined();
      expect(CANONICAL_TEMPLATES["ontario_hvac_payout_hold_placed_v1:EMAIL"]).toBeDefined();
      expect(CANONICAL_TEMPLATES["ontario_hvac_payout_hold_released_v1:EMAIL"]).toBeDefined();
    });
  });

  describe("User Notification Preference Evaluator", () => {
    it("allows marketing notifications when user is opted in", () => {
      const result = evaluateNotificationPreference("MARKETING_PROMOTIONS", true);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("USER_OPTED_IN");
    });

    it("blocks marketing notifications when user has opted out", () => {
      const result = evaluateNotificationPreference("MARKETING_PROMOTIONS", false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("USER_OPTED_OUT_OF_CATEGORY");
    });

    it("NEVER blocks safety & emergency notifications even if marked opted out", () => {
      const result = evaluateNotificationPreference("SAFETY_EMERGENCY", false);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("MANDATORY_SAFETY_COMMUNICATION_CANNOT_BE_OPTED_OUT");
    });

    it("NEVER blocks transactional receipts even if marked opted out", () => {
      const result = evaluateNotificationPreference("TRANSACTIONAL_RECEIPTS", false);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("MANDATORY_TRANSACTIONAL_RECEIPT_CANNOT_BE_OPTED_OUT");
    });
  });

  describe("Exponential Backoff & Jitter Calculator", () => {
    it("computes exponential increases with attempt number", () => {
      // With fixed jitter 0.5 (no deviation)
      const b1 = computeExponentialBackoff(1, { baseDelayMs: 1000, fixedJitterValue: 0.5 });
      const b2 = computeExponentialBackoff(2, { baseDelayMs: 1000, fixedJitterValue: 0.5 });
      const b3 = computeExponentialBackoff(3, { baseDelayMs: 1000, fixedJitterValue: 0.5 });
      const b4 = computeExponentialBackoff(4, { baseDelayMs: 1000, fixedJitterValue: 0.5 });

      expect(b1).toBe(1000);
      expect(b2).toBe(2000);
      expect(b3).toBe(4000);
      expect(b4).toBe(8000);
    });

    it("respects the max delay cap", () => {
      const capped = computeExponentialBackoff(10, {
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        fixedJitterValue: 0.5,
      });
      expect(capped).toBe(10000);
    });
  });

  describe("Deterministic Idempotency Key Generator", () => {
    it("generates deterministic colon-delimited idempotency keys", () => {
      const key = generateOutboxIdempotencyKey(
        "service_request",
        "req-101",
        "technician_assigned",
        "email",
        "user-55",
      );
      expect(key).toBe("SERVICE_REQUEST:req-101:TECHNICIAN_ASSIGNED:EMAIL:user-55");
    });
  });

  describe("Sandbox Messaging Provider", () => {
    it("sends mock messages and tracks history", async () => {
      const provider = new SandboxMessagingProvider();
      const res = await provider.send({
        channel: "EMAIL",
        destination: "homeowner@example.test",
        subject: "Welcome",
        body: "Welcome to Skilled Hire",
        idempotencyKey: "test-idem-1",
      });

      expect(res.success).toBe(true);
      expect(res.providerMessageId).toContain("mock-msg-");
      expect(provider.getSentMessages()).toHaveLength(1);
    });

    it("simulates transient rate limits and recovers", async () => {
      const provider = new SandboxMessagingProvider();
      provider.simulateTransientErrors(2, "RATE_LIMIT", "Upstream 429 Too Many Requests");

      const attempt1 = await provider.send({
        channel: "SMS",
        destination: "+14165550199",
        body: "Test code 1",
        idempotencyKey: "idem-sms-1",
      });
      expect(attempt1.success).toBe(false);
      expect(attempt1.errorCode).toBe("RATE_LIMIT");

      const attempt2 = await provider.send({
        channel: "SMS",
        destination: "+14165550199",
        body: "Test code 2",
        idempotencyKey: "idem-sms-2",
      });
      expect(attempt2.success).toBe(false);

      const attempt3 = await provider.send({
        channel: "SMS",
        destination: "+14165550199",
        body: "Test code 3",
        idempotencyKey: "idem-sms-3",
      });
      expect(attempt3.success).toBe(true);
    });

    it("simulates destination-specific delivery failures", async () => {
      const provider = new SandboxMessagingProvider();
      provider.simulateDestinationFailure(
        "bounced@example.test",
        "MAILBOX_UNAVAILABLE",
        "Recipient address does not exist",
      );

      const res = await provider.send({
        channel: "EMAIL",
        destination: "bounced@example.test",
        body: "Should fail",
        idempotencyKey: "idem-fail",
      });

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe("MAILBOX_UNAVAILABLE");
    });
  });

  describe("Outbox Item State Evaluation & Transitions", () => {
    const baseItem = {
      id: "outbox-test-1",
      aggregateType: "JOB",
      aggregateId: "job-test-101",
      eventType: "PAYMENT_CONFIRMED",
      idempotencyKey: "idem-outbox-test-1",
      recipientUserId: "user-cust-1",
      channel: "EMAIL" as const,
      destination: "customer@example.test",
      templateSlug: "ontario_hvac_payment_confirmed_v1",
      templateVersion: 1,
      payload: {
        customerName: "Jane Doe",
        milestoneName: "Rough-in Diagnostic",
        amountDollars: "450.00",
        jobId: "job-test-101",
        stripeReference: "ch_mock_99182",
      },
      status: "PENDING" as const,
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date().toISOString(),
    };

    it("delivers successfully on first attempt and creates audit log", async () => {
      const provider = new SandboxMessagingProvider();
      const output = await evaluateAndDispatchOutboxItem({ item: baseItem }, provider);

      expect(output.newStatus).toBe("DELIVERED");
      expect(output.newAttempts).toBe(1);
      expect(output.deliveredAt).toBeDefined();
      expect(output.deliveryLog?.status).toBe("SUCCESS");
      expect(output.deliveryLog?.providerName).toBe("SANDBOX_MOCK_PROVIDER");
    });

    it("transitions to RETRYING with exponential backoff on transient failure", async () => {
      const provider = new SandboxMessagingProvider();
      provider.simulateTransientErrors(1);

      const output = await evaluateAndDispatchOutboxItem({ item: baseItem }, provider);

      expect(output.newStatus).toBe("RETRYING");
      expect(output.newAttempts).toBe(1);
      expect(output.nextAttemptAt).toBeDefined();
      expect(output.deliveryLog?.status).toBe("TRANSIENT_ERROR");
      expect(output.lastError).toContain("PROVIDER_RATE_LIMIT");
    });

    it("transitions to DEAD_LETTER when maximum retry attempts are exhausted", async () => {
      const provider = new SandboxMessagingProvider();
      provider.simulateTransientErrors(5);

      const failingItem = {
        ...baseItem,
        attempts: 2, // 3rd attempt will hit maxAttempts: 3
        maxAttempts: 3,
      };

      const output = await evaluateAndDispatchOutboxItem({ item: failingItem }, provider);

      expect(output.newStatus).toBe("DEAD_LETTER");
      expect(output.newAttempts).toBe(3);
      expect(output.deliveryLog?.status).toBe("FATAL_ERROR");
    });

    it("cancels delivery when non-mandatory user category is opted out", async () => {
      const provider = new SandboxMessagingProvider();
      const marketingItem = {
        ...baseItem,
        eventType: "SEASONAL_TUNEUP_PROMOTION",
      };

      const output = await evaluateAndDispatchOutboxItem(
        {
          item: marketingItem,
          userPreference: {
            category: "MARKETING_PROMOTIONS",
            enabled: false,
          },
        },
        provider,
      );

      expect(output.newStatus).toBe("CANCELLED_PREFERENCE");
      expect(output.deliveryLog?.status).toBe("SUPPRESSED");
      expect(output.deliveryLog?.errorCode).toBe("PREFERENCE_SUPPRESSED");
      expect(provider.getSentMessages()).toHaveLength(0);
    });

    it("does not suppress mandatory transactional receipts even if user preference record is false", async () => {
      const provider = new SandboxMessagingProvider();

      const output = await evaluateAndDispatchOutboxItem(
        {
          item: baseItem,
          userPreference: {
            category: "TRANSACTIONAL_RECEIPTS",
            enabled: false, // Mandatory category cannot be disabled!
          },
        },
        provider,
      );

      expect(output.newStatus).toBe("DELIVERED");
      expect(provider.getSentMessages()).toHaveLength(1);
    });
  });
});
