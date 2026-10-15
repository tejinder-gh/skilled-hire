import { describe, expect, it } from "vitest";
import {
  calculateApplicationFee,
  generateTestWebhookSignature,
  StripeSandboxService,
  StripeSignatureError,
  verifyStripeWebhookSignature,
  validateBalancedEntries,
  generateCustomerPaymentLedgerEntries,
  generatePayoutHoldLedgerEntries,
  generatePayoutReleaseLedgerEntries,
  generateContractorPayoutLedgerEntries,
  generateRefundLedgerEntries,
  applyLedgerToContractorBalance,
  evaluateMilestonePayoutEligibility,
  computeFinancialReconciliation,
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

describe("Financial Ledger Double-Entry Engine (SH-08)", () => {
  it("generates perfectly balanced entries for customer milestone payments", () => {
    const tx = generateCustomerPaymentLedgerEntries({
      transactionId: "tx-100",
      milestoneId: "ms-100",
      contractorId: "ct-100",
      customerId: "cu-100",
      grossAmountCents: 100000, // $1,000 CAD
    });

    expect(tx.entryType).toBe("CUSTOMER_CHARGE");
    expect(tx.entries).toHaveLength(3);

    const debits = tx.entries.filter((e) => e.direction === "DEBIT");
    const credits = tx.entries.filter((e) => e.direction === "CREDIT");

    expect(debits).toHaveLength(1);
    expect(debits[0]?.accountType).toBe("STRIPE_CLEARING");
    expect(debits[0]?.amountCents).toBe(100000);

    expect(credits).toHaveLength(2);
    const fee = credits.find((e) => e.accountType === "PLATFORM_REVENUE");
    const payable = credits.find((e) => e.accountType === "CONTRACTOR_PAYABLE");

    expect(fee?.amountCents).toBe(5000); // 5%
    expect(payable?.amountCents).toBe(95000); // 95%
    expect((fee?.amountCents ?? 0) + (payable?.amountCents ?? 0)).toBe(100000);
  });

  it("throws double-entry imbalance error when debit does not equal credit", () => {
    expect(() => {
      validateBalancedEntries([
        {
          accountType: "STRIPE_CLEARING",
          direction: "DEBIT",
          amountCents: 50000,
          description: "Test",
        },
        {
          accountType: "CONTRACTOR_PAYABLE",
          direction: "CREDIT",
          amountCents: 49000,
          description: "Imbalanced credit",
        },
      ]);
    }).toThrow("Double-entry imbalance detected");
  });

  it("generates balanced entries for payout holds and releases", () => {
    const holdTx = generatePayoutHoldLedgerEntries({
      contractorId: "ct-100",
      milestoneId: "ms-100",
      amountCents: 95000,
      holdReason: "MISSING_COMPLETION_EVIDENCE",
    });

    expect(holdTx.entryType).toBe("PAYOUT_HOLD");
    expect(holdTx.entries[0]?.accountType).toBe("CONTRACTOR_PAYABLE");
    expect(holdTx.entries[0]?.direction).toBe("DEBIT");
    expect(holdTx.entries[1]?.accountType).toBe("PAYOUT_ESCROW_HOLD");
    expect(holdTx.entries[1]?.direction).toBe("CREDIT");

    const releaseTx = generatePayoutReleaseLedgerEntries({
      contractorId: "ct-100",
      milestoneId: "ms-100",
      amountCents: 95000,
      releaseNotes: "Inspection passed",
    });

    expect(releaseTx.entryType).toBe("PAYOUT_RELEASE");
    expect(releaseTx.entries[0]?.accountType).toBe("PAYOUT_ESCROW_HOLD");
    expect(releaseTx.entries[0]?.direction).toBe("DEBIT");
    expect(releaseTx.entries[1]?.accountType).toBe("CONTRACTOR_PAYABLE");
    expect(releaseTx.entries[1]?.direction).toBe("CREDIT");
  });

  it("generates balanced entries for contractor payouts and refunds", () => {
    const payoutTx = generateContractorPayoutLedgerEntries({
      contractorId: "ct-100",
      amountCents: 95000,
      stripeTransferId: "tr_12345",
    });

    expect(payoutTx.entryType).toBe("CONTRACTOR_PAYOUT");
    expect(payoutTx.entries[0]?.accountType).toBe("CONTRACTOR_PAYABLE");
    expect(payoutTx.entries[0]?.direction).toBe("DEBIT");
    expect(payoutTx.entries[1]?.accountType).toBe("STRIPE_CLEARING");
    expect(payoutTx.entries[1]?.direction).toBe("CREDIT");

    const refundTx = generateRefundLedgerEntries({
      refundId: "ref-100",
      transactionId: "tx-100",
      contractorId: "ct-100",
      customerId: "cu-100",
      refundAmountCents: 20000, // $200 refund
    });

    expect(refundTx.entryType).toBe("REFUND_DEBIT");
    expect(refundTx.entries).toHaveLength(3);
    const contractorDebit = refundTx.entries.find((e) => e.accountType === "CONTRACTOR_PAYABLE");
    const feeReversal = refundTx.entries.find((e) => e.accountType === "PLATFORM_REVENUE");
    const clearingCredit = refundTx.entries.find((e) => e.accountType === "STRIPE_CLEARING");

    expect(contractorDebit?.amountCents).toBe(19000); // 95% of 20000
    expect(feeReversal?.amountCents).toBe(1000); // 5% fee reversal
    expect(clearingCredit?.amountCents).toBe(20000);
  });
});

describe("Contractor Balance Transitions & Negative Handling (SH-08)", () => {
  it("tracks available, held, and lifetime balances across events", () => {
    let balance = {
      availableBalanceCents: 0,
      heldBalanceCents: 0,
      lifetimeEarningsCents: 0,
      lifetimePayoutsCents: 0,
      isNegative: false,
    };

    // 1. Earning
    balance = applyLedgerToContractorBalance(balance, { type: "EARNING", amountCents: 95000 });
    expect(balance.availableBalanceCents).toBe(95000);
    expect(balance.lifetimeEarningsCents).toBe(95000);
    expect(balance.isNegative).toBe(false);

    // 2. Hold placed due to missing evidence
    balance = applyLedgerToContractorBalance(balance, { type: "HOLD", amountCents: 95000 });
    expect(balance.availableBalanceCents).toBe(0);
    expect(balance.heldBalanceCents).toBe(95000);
    expect(balance.isNegative).toBe(false);

    // 3. Hold released
    balance = applyLedgerToContractorBalance(balance, { type: "RELEASE", amountCents: 95000 });
    expect(balance.availableBalanceCents).toBe(95000);
    expect(balance.heldBalanceCents).toBe(0);

    // 4. Contractor Payout
    balance = applyLedgerToContractorBalance(balance, { type: "PAYOUT", amountCents: 95000 });
    expect(balance.availableBalanceCents).toBe(0);
    expect(balance.lifetimePayoutsCents).toBe(95000);

    // 5. Subsequent refund occurs after payout -> turns negative!
    balance = applyLedgerToContractorBalance(balance, { type: "REFUND_DEBIT", amountCents: 20000 });
    expect(balance.availableBalanceCents).toBe(-20000);
    expect(balance.isNegative).toBe(true);

    // 6. Next job earning recovers negative balance
    balance = applyLedgerToContractorBalance(balance, { type: "EARNING", amountCents: 50000 });
    expect(balance.availableBalanceCents).toBe(30000);
    expect(balance.isNegative).toBe(false);
  });
});

describe("Milestone Evidence Payout Eligibility Gates (SH-08)", () => {
  it("permits deposit milestone without holds", () => {
    const result = evaluateMilestonePayoutEligibility({
      milestoneTitle: "Initial Deposit",
      milestoneType: "DEPOSIT",
      isFinalMilestone: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.holdRequired).toBe(false);
  });

  it("places hold if active dispute exists", () => {
    const result = evaluateMilestonePayoutEligibility({
      milestoneTitle: "Rough-in Payment",
      isFinalMilestone: false,
      hasOpenDispute: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.holdRequired).toBe(true);
    expect(result.holdReason).toBe("ACTIVE_DISPUTE");
  });

  it("places hold if contractor balance is negative", () => {
    const result = evaluateMilestonePayoutEligibility({
      milestoneTitle: "Rough-in Payment",
      isFinalMilestone: false,
      isContractorNegativeBalance: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.holdRequired).toBe(true);
    expect(result.holdReason).toBe("NEGATIVE_CONTRACTOR_BALANCE");
  });

  it("places hold on final milestone if required ESA permit has not passed", () => {
    const result = evaluateMilestonePayoutEligibility({
      milestoneTitle: "Final Completion & Commissioning",
      isFinalMilestone: true,
      requiresPermit: true,
      esaPermitStatus: "FILED",
      customerAccepted: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.holdRequired).toBe(true);
    expect(result.holdReason).toBe("MISSING_COMPLETION_EVIDENCE");
    expect(result.requiredEvidenceType).toBe("ESA_INSPECTION_CERTIFICATE");
  });

  it("places hold on final milestone if customer completion sign-off is missing", () => {
    const result = evaluateMilestonePayoutEligibility({
      milestoneTitle: "Final Completion",
      isFinalMilestone: true,
      requiresPermit: false,
      customerAccepted: false,
      completionReportStatus: "SUBMITTED",
    });
    expect(result.eligible).toBe(false);
    expect(result.holdRequired).toBe(true);
    expect(result.holdReason).toBe("MISSING_COMPLETION_EVIDENCE");
    expect(result.requiredEvidenceType).toBe("COMPLETION_SIGN_OFF");
  });

  it("permits final milestone payout when ESA permit passed and customer accepted", () => {
    const result = evaluateMilestonePayoutEligibility({
      milestoneTitle: "Final Completion",
      isFinalMilestone: true,
      requiresPermit: true,
      esaPermitStatus: "PASSED",
      customerAccepted: true,
      completionReportStatus: "ACCEPTED",
    });
    expect(result.eligible).toBe(true);
    expect(result.holdRequired).toBe(false);
  });
});

describe("Daily Financial Reconciliation Engine (SH-08)", () => {
  it("reconciles perfectly when gross charges match all allocations and reserves", () => {
    // 1 customer charge: $1,000 (100,000 cents)
    // Allocations:
    // Platform fee: 5,000 cents
    // Completed Payout: 60,000 cents
    // Active hold: 20,000 cents
    // Unpaid available: 15,000 cents
    // Total: 100,000 cents
    const report = computeFinancialReconciliation({
      charges: [{ id: "ch-1", amountCents: 100000 }],
      platformFees: [{ id: "fee-1", amountCents: 5000 }],
      payouts: [{ id: "po-1", amountCents: 60000 }],
      refunds: [],
      activeHolds: [{ id: "h-1", amountCents: 20000 }],
      unpaidAvailableBalances: [{ contractorId: "c-1", amountCents: 15000 }],
    });

    expect(report.status).toBe("BALANCED");
    expect(report.discrepancyCents).toBe(0);
    expect(report.unreconciledIds).toHaveLength(0);
    expect(report.summary).toContain("Reconciliation passed");
  });

  it("flags discrepancy when allocations do not balance with customer charges", () => {
    const report = computeFinancialReconciliation({
      charges: [{ id: "ch-1", amountCents: 100000 }],
      platformFees: [{ id: "fee-1", amountCents: 5000 }],
      payouts: [{ id: "po-1", amountCents: 50000 }], // 45,000 missing!
      refunds: [],
      activeHolds: [],
      unpaidAvailableBalances: [],
    });

    expect(report.status).toBe("DISCREPANCY_DETECTED");
    expect(report.discrepancyCents).toBe(45000);
    expect(report.unreconciledIds).toContain("ch-1");
    expect(report.summary).toContain("Discrepancy of $450.00 detected");
  });
});
