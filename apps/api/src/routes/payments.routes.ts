import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import {
  db,
  eq,
  and,
  sql,
  desc,
  paymentTransactions,
  paymentMilestones,
  paymentSchedules,
  quotes,
  jobs,
  serviceRequests,
  refunds,
  contractors,
  users,
  stripeConnectAccounts,
  customerPaymentMethods,
  paymentIntents,
  stripeWebhookEvents,
  paymentDisputes,
  marketplaceFinancialLedger,
  payoutHolds,
  contractorPayoutBalances,
  financialReconciliationReports,
} from "@marketplace/database";
import {
  StripeSandboxService,
  verifyStripeWebhookSignature,
  calculateApplicationFee,
  StripeSignatureError,
  generateCustomerPaymentLedgerEntries,
  generatePayoutHoldLedgerEntries,
  generatePayoutReleaseLedgerEntries,
  generateContractorPayoutLedgerEntries,
  generateRefundLedgerEntries,
  applyLedgerToContractorBalance,
  evaluateMilestonePayoutEligibility,
  computeFinancialReconciliation,
  type DoubleEntryTransaction,
} from "@marketplace/payments";
import {
  connectOnboardInitiateSchema,
  createPaymentIntentSchema,
  confirmPaymentIntentSchema,
  attachPaymentMethodSchema,
  processRefundSchema,
  payoutHoldPlaceSchema,
  payoutHoldReleaseSchema,
  reconciliationRunSchema,
  contractorPayoutTransferSchema,
} from "@marketplace/validation";
import { enqueueTransactionalNotification } from "./notifications.routes.js";
import { generateOutboxIdempotencyKey } from "@marketplace/messaging";
import { actor, authenticate, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

const stripeService = new StripeSandboxService();

/**
 * Gets or initializes a contractor's payout balance record.
 */
async function getOrCreateContractorBalance(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  contractorId: string,
) {
  const [existing] = await tx
    .select()
    .from(contractorPayoutBalances)
    .where(eq(contractorPayoutBalances.contractorId, contractorId))
    .limit(1);

  if (existing) {
    return {
      availableBalanceCents: Number(existing.availableBalanceCents),
      heldBalanceCents: Number(existing.heldBalanceCents),
      lifetimeEarningsCents: Number(existing.lifetimeEarningsCents),
      lifetimePayoutsCents: Number(existing.lifetimePayoutsCents),
      isNegative: existing.isNegative,
    };
  }

  await tx.insert(contractorPayoutBalances).values({
    contractorId,
    availableBalanceCents: 0,
    heldBalanceCents: 0,
    lifetimeEarningsCents: 0,
    lifetimePayoutsCents: 0,
    isNegative: false,
    currency: "CAD",
  });

  return {
    availableBalanceCents: 0,
    heldBalanceCents: 0,
    lifetimeEarningsCents: 0,
    lifetimePayoutsCents: 0,
    isNegative: false,
  };
}

/**
 * Inserts immutable double-entry ledger records into marketplace_financial_ledger.
 */
async function recordLedgerEntriesInDb(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  transaction: DoubleEntryTransaction,
) {
  for (const entry of transaction.entries) {
    await tx.insert(marketplaceFinancialLedger).values({
      entryType: transaction.entryType,
      accountType: entry.accountType,
      direction: entry.direction,
      amountCents: entry.amountCents,
      currency: "CAD",
      contractorId: entry.contractorId ?? null,
      customerId: entry.customerId ?? null,
      jobId: entry.jobId ?? null,
      milestoneId: entry.milestoneId ?? null,
      transactionId: entry.transactionId ?? null,
      refundId: entry.refundId ?? null,
      description: entry.description,
      runningBalanceCents: 0,
    });
  }
}

/**
 * Core settlement logic: Records payment transaction, updates milestone,
 * logs append-only double entries to the financial ledger, evaluates milestone evidence
 * gates, places automated holds if evidence is missing, and updates contractor balances.
 */
async function processSuccessfulPaymentSettlement(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    milestoneId: string;
    paymentIntentId: string;
    contractorId?: string | null | undefined;
    customerId: string;
    amountCents: number;
    provider: string;
    idempotencyKey: string;
  },
) {
  // 1. Insert transaction
  const [savedTx] = await tx
    .insert(paymentTransactions)
    .values({
      milestoneId: input.milestoneId,
      provider: input.provider,
      providerReference: input.paymentIntentId,
      idempotencyKey: input.idempotencyKey,
      amountCents: input.amountCents,
      currency: "CAD",
      status: "PAID",
    })
    .onConflictDoNothing({ target: paymentTransactions.idempotencyKey })
    .returning();

  // 2. Update milestone
  await tx
    .update(paymentMilestones)
    .set({ status: "PAID", paidAt: new Date() })
    .where(eq(paymentMilestones.id, input.milestoneId));

  // 3. Resolve contractor ID if not directly provided
  let contractorId = input.contractorId;
  let milestoneTitle = "Milestone Payment";
  let isFinal = false;
  let evidenceRequired = false;

  const [msRow] = await tx
    .select({
      triggerName: paymentMilestones.triggerName,
      sequence: paymentMilestones.sequence,
      evidenceRequired: paymentMilestones.evidenceRequired,
      contractorId: jobs.contractorId,
      jobId: jobs.id,
    })
    .from(paymentMilestones)
    .innerJoin(paymentSchedules, eq(paymentSchedules.id, paymentMilestones.scheduleId))
    .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
    .innerJoin(jobs, eq(jobs.id, quotes.jobId))
    .where(eq(paymentMilestones.id, input.milestoneId))
    .limit(1);

  if (msRow) {
    contractorId = contractorId ?? msRow.contractorId;
    milestoneTitle = msRow.triggerName;
    evidenceRequired = msRow.evidenceRequired;
    isFinal = msRow.sequence === 3 || msRow.triggerName.toLowerCase().includes("final");
  }

  if (contractorId) {
    // 4. Generate double-entry financial ledger records
    const ledgerTx = generateCustomerPaymentLedgerEntries({
      transactionId: savedTx?.id ?? input.paymentIntentId,
      milestoneId: input.milestoneId,
      jobId: msRow?.jobId,
      contractorId,
      customerId: input.customerId,
      grossAmountCents: input.amountCents,
    });
    await recordLedgerEntriesInDb(tx, ledgerTx);

    // 5. Update contractor balance with net earnings
    const appFee = calculateApplicationFee(input.amountCents);
    const netEarnings = input.amountCents - appFee;
    const currentBal = await getOrCreateContractorBalance(tx, contractorId);

    let updatedBal = applyLedgerToContractorBalance(currentBal, {
      type: "EARNING",
      amountCents: netEarnings,
    });

    // 6. Milestone evidence payout eligibility evaluation
    const eligibility = evaluateMilestonePayoutEligibility({
      milestoneTitle,
      isFinalMilestone: isFinal,
      requiresPermit: evidenceRequired,
      customerAccepted: false,
      completionReportStatus: "SUBMITTED",
      hasOpenDispute: false,
      isContractorNegativeBalance: updatedBal.isNegative,
    });

    if (eligibility.holdRequired) {
      // Place hold in payout_holds
      await tx.insert(payoutHolds).values({
        contractorId,
        milestoneId: input.milestoneId,
        amountCents: netEarnings,
        currency: "CAD",
        holdReason: eligibility.holdReason ?? "MISSING_COMPLETION_EVIDENCE",
        holdStatus: "ACTIVE",
        requiredEvidenceType: eligibility.requiredEvidenceType ?? "COMPLETION_SIGN_OFF",
      });

      // Double-entry: Lock funds in PAYOUT_ESCROW_HOLD
      const holdLedger = generatePayoutHoldLedgerEntries({
        contractorId,
        milestoneId: input.milestoneId,
        amountCents: netEarnings,
        holdReason: eligibility.holdReason ?? "MISSING_COMPLETION_EVIDENCE",
      });
      await recordLedgerEntriesInDb(tx, holdLedger);

      // Deduct from available, shift into held
      updatedBal = applyLedgerToContractorBalance(updatedBal, {
        type: "HOLD",
        amountCents: netEarnings,
      });

      // SH-09: Atomic Outbox Notification to contractor regarding payout hold
      await enqueueTransactionalNotification(tx, {
        aggregateType: "MILESTONE",
        aggregateId: input.milestoneId,
        eventType: "PAYOUT_HOLD_PLACED",
        idempotencyKey: generateOutboxIdempotencyKey(
          "MILESTONE",
          input.milestoneId,
          "PAYOUT_HOLD_PLACED",
          "EMAIL",
          contractorId,
        ),
        recipientUserId: contractorId,
        channel: "EMAIL",
        destination: "contractor@example.test",
        templateSlug: "ontario_hvac_payout_hold_placed_v1",
        payload: {
          contractorName: "Partner Contractor",
          milestoneName: milestoneTitle,
          amountDollars: (netEarnings / 100).toFixed(2),
          holdReason: eligibility.holdReason ?? "MISSING_COMPLETION_EVIDENCE",
          requiredEvidenceType: eligibility.requiredEvidenceType ?? "ESA_CERTIFICATE",
        },
      });
    }

    // SH-09: Atomic Outbox Notification to customer for statutory payment receipt
    const resolvedJobId = msRow?.jobId ?? input.milestoneId;
    await enqueueTransactionalNotification(tx, {
      aggregateType: "JOB",
      aggregateId: resolvedJobId,
      eventType: "PAYMENT_CONFIRMED",
      idempotencyKey: generateOutboxIdempotencyKey(
        "JOB",
        resolvedJobId,
        "PAYMENT_CONFIRMED",
        "EMAIL",
        input.customerId,
      ),
      recipientUserId: input.customerId,
      channel: "EMAIL",
      destination: "customer@example.test",
      templateSlug: "ontario_hvac_payment_confirmed_v1",
      payload: {
        customerName: "Valued Customer",
        milestoneName: milestoneTitle,
        amountDollars: (input.amountCents / 100).toFixed(2),
        jobId: resolvedJobId,
        stripeReference: input.paymentIntentId,
      },
    });

    // Persist updated contractor payout balance
    await tx
      .update(contractorPayoutBalances)
      .set({
        availableBalanceCents: updatedBal.availableBalanceCents,
        heldBalanceCents: updatedBal.heldBalanceCents,
        lifetimeEarningsCents: updatedBal.lifetimeEarningsCents,
        lifetimePayoutsCents: updatedBal.lifetimePayoutsCents,
        isNegative: updatedBal.isNegative,
        updatedAt: new Date(),
      })
      .where(eq(contractorPayoutBalances.contractorId, contractorId));
  }
}

export const paymentsRoutes: FastifyPluginAsync = async (app) => {

  // ---------------------------------------------------------------------------
  // 1. Stripe Connect Sandbox Onboarding (Contractors)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/connect/onboard",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CONTRACTOR_OWNER", "CONTRACTOR_MANAGER", "ADMIN", "SUPER_ADMIN");
      const currentActor = actor(request);
      const body = parse(connectOnboardInitiateSchema, request.body ?? {});

      // Locate contractor record associated with current actor or default contractor
      let contractorId: string | undefined;
      const [contractorRecord] = await db
        .select({ id: contractors.id })
        .from(contractors)
        .limit(1);

      if (contractorRecord) {
        contractorId = contractorRecord.id;
      }

      if (!contractorId) {
        return reply.code(400).send({
          code: "CONTRACTOR_REQUIRED",
          message: "Contractor record is required to initiate Stripe Connect onboarding",
        });
      }

      // Check existing Connect account
      const [existingAccount] = await db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.contractorId, contractorId))
        .limit(1);

      const linkResult = await stripeService.createConnectOnboardingLink({
        contractorId,
        stripeAccountId: existingAccount?.stripeAccountId,
        returnUrl: body.returnUrl,
        refreshUrl: body.refreshUrl,
      });

      if (!existingAccount) {
        await db.insert(stripeConnectAccounts).values({
          contractorId,
          stripeAccountId: linkResult.accountId,
          accountType: "express",
          onboardingStatus: "IN_PROGRESS",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          country: "CA",
          defaultCurrency: "CAD",
        });
      } else {
        await db
          .update(stripeConnectAccounts)
          .set({
            onboardingStatus: "IN_PROGRESS",
            updatedAt: new Date(),
          })
          .where(eq(stripeConnectAccounts.id, existingAccount.id));
      }

      await audit(
        currentActor.id,
        "CONNECT_ONBOARDING_INITIATED",
        "STRIPE_CONNECT_ACCOUNT",
        linkResult.accountId,
        null,
        { contractorId },
      );

      return reply.code(200).send(linkResult);
    },
  );

  app.get(
    "/v1/connect/status",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CONTRACTOR_OWNER", "CONTRACTOR_MANAGER", "ADMIN", "SUPER_ADMIN");

      const [account] = await db
        .select()
        .from(stripeConnectAccounts)
        .limit(1);

      if (!account) {
        return reply.code(200).send({
          onboardingStatus: "NOT_STARTED",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          country: "CA",
          defaultCurrency: "CAD",
          requirementsDue: [],
        });
      }

      return reply.code(200).send({
        id: account.id,
        contractorId: account.contractorId,
        stripeAccountId: account.stripeAccountId,
        accountType: account.accountType,
        onboardingStatus: account.onboardingStatus,
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        detailsSubmitted: account.detailsSubmitted,
        country: account.country,
        defaultCurrency: account.defaultCurrency,
        requirementsDue: account.requirementsDue,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 2. Customer Saved Payment Methods
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/payments/methods",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER", "ADMIN", "SUPER_ADMIN");
      const currentActor = actor(request);

      const methods = await db
        .select()
        .from(customerPaymentMethods)
        .where(eq(customerPaymentMethods.customerId, currentActor.id))
        .orderBy(desc(customerPaymentMethods.createdAt));

      return reply.code(200).send({
        paymentMethods: methods.map((m) => ({
          id: m.id,
          customerId: m.customerId,
          stripePaymentMethodId: m.stripePaymentMethodId,
          brand: m.brand,
          last4: m.last4,
          expMonth: m.expMonth,
          expYear: m.expYear,
          isDefault: m.isDefault,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    },
  );

  app.post(
    "/v1/payments/methods",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const currentActor = actor(request);
      const body = parse(attachPaymentMethodSchema, request.body);

      const [created] = await db
        .insert(customerPaymentMethods)
        .values({
          customerId: currentActor.id,
          stripePaymentMethodId: body.stripePaymentMethodId,
          brand: body.brand,
          last4: body.last4,
          expMonth: body.expMonth,
          expYear: body.expYear,
          isDefault: body.isDefault,
        })
        .returning();

      return reply.code(201).send(created);
    },
  );

  // ---------------------------------------------------------------------------
  // 3. Payment Intents & Server-Side Amount Locking
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/payments/intent",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const currentActor = actor(request);
      const body = parse(createPaymentIntentSchema, request.body);
      const idempotencyKey =
        (request.headers["idempotency-key"] as string) ??
        `idemp_pi_${crypto.randomUUID()}`;

      // Check existing payment intent for idempotency
      const [existingIntent] = await db
        .select()
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.milestoneId, body.milestoneId),
            eq(paymentIntents.customerId, currentActor.id),
          ),
        )
        .limit(1);

      if (existingIntent && existingIntent.status !== "FAILED") {
        return reply.code(200).send({
          id: existingIntent.id,
          milestoneId: existingIntent.milestoneId,
          customerId: existingIntent.customerId,
          contractorId: existingIntent.contractorId,
          stripePaymentIntentId: existingIntent.stripePaymentIntentId,
          stripeClientSecret: existingIntent.stripeClientSecret,
          amountCents: Number(existingIntent.amountCents),
          currency: existingIntent.currency,
          applicationFeeAmountCents: Number(existingIntent.applicationFeeAmountCents),
          status: existingIntent.status,
          idempotencyKey: existingIntent.idempotencyKey,
          createdAt: existingIntent.createdAt.toISOString(),
        });
      }

      // Fetch milestone strictly server-side to prevent client price tampering
      const [milestoneRow] = await db
        .select({
          amountCents: paymentMilestones.amountCents,
          status: paymentMilestones.status,
          sequence: paymentMilestones.sequence,
          scheduleId: paymentMilestones.scheduleId,
          currency: paymentSchedules.currency,
          customerId: serviceRequests.customerId,
          contractorId: jobs.contractorId,
        })
        .from(paymentMilestones)
        .innerJoin(
          paymentSchedules,
          eq(paymentSchedules.id, paymentMilestones.scheduleId),
        )
        .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
        .innerJoin(jobs, eq(jobs.id, quotes.jobId))
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(eq(paymentMilestones.id, body.milestoneId))
        .limit(1);

      if (!milestoneRow) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Payment milestone not found",
        });
      }

      if (milestoneRow.customerId !== currentActor.id) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You do not have access to pay this milestone",
        });
      }

      if (milestoneRow.status === "PAID") {
        return reply.code(422).send({
          code: "ALREADY_PAID",
          message: "Milestone has already been paid",
        });
      }

      // Ensure prior sequence milestones are paid
      const [priorUnpaid] = await db
        .select({ id: paymentMilestones.id })
        .from(paymentMilestones)
        .where(
          and(
            eq(paymentMilestones.scheduleId, milestoneRow.scheduleId),
            sql`${paymentMilestones.sequence} < ${milestoneRow.sequence}`,
            sql`${paymentMilestones.status} NOT IN ('PAID', 'WAIVED')`,
          ),
        )
        .limit(1);

      if (priorUnpaid) {
        return reply.code(422).send({
          code: "PRIOR_MILESTONE_REQUIRED",
          message: "Prior milestone in the schedule must be paid first",
        });
      }

      // Create PaymentIntent via Stripe Sandbox Engine
      const amountCents = Number(milestoneRow.amountCents);
      const stripeResult = await stripeService.createPaymentIntent({
        milestoneId: body.milestoneId,
        customerId: currentActor.id,
        amountCents,
        currency: milestoneRow.currency,
        idempotencyKey,
      });

      const [saved] = await db
        .insert(paymentIntents)
        .values({
          milestoneId: body.milestoneId,
          customerId: currentActor.id,
          contractorId: milestoneRow.contractorId,
          stripePaymentIntentId: stripeResult.paymentIntentId,
          stripeClientSecret: stripeResult.clientSecret,
          amountCents: stripeResult.amountCents,
          currency: stripeResult.currency,
          applicationFeeAmountCents: stripeResult.applicationFeeAmountCents,
          status: stripeResult.status,
          idempotencyKey,
        })
        .returning();

      if (!saved) {
        throw new Error("Failed to save payment intent");
      }

      return reply.code(201).send({
        id: saved.id,
        milestoneId: saved.milestoneId,
        customerId: saved.customerId,
        contractorId: saved.contractorId,
        stripePaymentIntentId: saved.stripePaymentIntentId,
        stripeClientSecret: saved.stripeClientSecret,
        amountCents: Number(saved.amountCents),
        currency: saved.currency,
        applicationFeeAmountCents: Number(saved.applicationFeeAmountCents),
        status: saved.status,
        idempotencyKey: saved.idempotencyKey,
        createdAt: saved.createdAt.toISOString(),
      });
    },
  );

  app.post(
    "/v1/payments/intent/:id/confirm",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const currentActor = actor(request);
      const intentId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(confirmPaymentIntentSchema, request.body ?? {});

      const [intent] = await db
        .select()
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.id, intentId),
            eq(paymentIntents.customerId, currentActor.id),
          ),
        )
        .limit(1);

      if (!intent) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Payment intent not found",
        });
      }

      if (intent.status === "SUCCEEDED") {
        return reply.code(200).send({
          id: intent.id,
          status: "SUCCEEDED",
          amountCents: Number(intent.amountCents),
          receiptUrl: intent.receiptUrl,
        });
      }

      const confirmResult = await stripeService.confirmPaymentIntent({
        paymentIntentId: intent.stripePaymentIntentId,
        amountCents: Number(intent.amountCents),
        currency: intent.currency,
        paymentMethodId: body.paymentMethodId,
        testTriggerOutcome: body.testTriggerOutcome,
      });

      if (confirmResult.status === "SUCCEEDED") {
        await db.transaction(async (tx) => {
          // Update intent
          await tx
            .update(paymentIntents)
            .set({
              status: "SUCCEEDED",
              receiptUrl: confirmResult.receiptUrl,
              updatedAt: new Date(),
            })
            .where(eq(paymentIntents.id, intent.id));

          await processSuccessfulPaymentSettlement(tx, {
            milestoneId: intent.milestoneId,
            paymentIntentId: confirmResult.paymentIntentId,
            contractorId: intent.contractorId,
            customerId: intent.customerId,
            amountCents: Number(intent.amountCents),
            provider: "STRIPE_CONNECT",
            idempotencyKey: `tx_${confirmResult.paymentIntentId}`,
          });
        });

        await audit(
          currentActor.id,
          "PAYMENT_SUCCEEDED",
          "PAYMENT_INTENT",
          intent.id,
          { previousStatus: intent.status },
          { status: "SUCCEEDED", amountCents: Number(intent.amountCents) },
        );

        return reply.code(200).send({
          id: intent.id,
          status: "SUCCEEDED",
          amountCents: Number(intent.amountCents),
          receiptUrl: confirmResult.receiptUrl,
        });
      }

      // If failed
      await db
        .update(paymentIntents)
        .set({
          status: confirmResult.status,
          failureCode: confirmResult.failureCode,
          failureMessage: confirmResult.failureMessage,
          updatedAt: new Date(),
        })
        .where(eq(paymentIntents.id, intent.id));

      await audit(
        currentActor.id,
        "PAYMENT_FAILED",
        "PAYMENT_INTENT",
        intent.id,
        null,
        {
          status: confirmResult.status,
          failureCode: confirmResult.failureCode,
          failureMessage: confirmResult.failureMessage,
        },
      );

      return reply.code(confirmResult.status === "FAILED" ? 402 : 200).send({
        id: intent.id,
        status: confirmResult.status,
        failureCode: confirmResult.failureCode,
        failureMessage: confirmResult.failureMessage,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 4. Stripe Webhooks & Replay-Protected Event Ledger
  // ---------------------------------------------------------------------------
  app.post("/v1/payments/webhooks", async (request, reply) => {
    const signatureHeader = request.headers["stripe-signature"] as string | undefined;
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body ?? {});

    let event: ReturnType<typeof verifyStripeWebhookSignature>;
    try {
      event = verifyStripeWebhookSignature(
        rawBody,
        signatureHeader,
        stripeService.getWebhookSecret(),
      );
    } catch (err) {
      if (err instanceof StripeSignatureError) {
        return reply.code(400).send({
          code: err.code,
          message: err.message,
        });
      }
      return reply.code(400).send({
        code: "STRIPE_VERIFICATION_FAILED",
        message: (err as Error).message,
      });
    }

    // 1. Deduplicate webhook event
    const [existingEvent] = await db
      .select({ id: stripeWebhookEvents.id, status: stripeWebhookEvents.status })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.eventId, event.id))
      .limit(1);

    if (existingEvent && existingEvent.status === "PROCESSED") {
      return reply.code(200).send({ received: true, deduplicated: true });
    }

    if (!existingEvent) {
      await db
        .insert(stripeWebhookEvents)
        .values({
          eventId: event.id,
          eventType: event.type,
          payload: event,
          status: "PROCESSING",
        })
        .onConflictDoNothing({ target: stripeWebhookEvents.eventId });
    }

    // 2. Process event actions
    try {
      if (event.type === "payment_intent.succeeded") {
        const piData = event.data.object;
        const stripePiId = piData["id"] as string;

        const [intentRecord] = await db
          .select()
          .from(paymentIntents)
          .where(eq(paymentIntents.stripePaymentIntentId, stripePiId))
          .limit(1);

        if (intentRecord) {
          await db.transaction(async (tx) => {
            await tx
              .update(paymentIntents)
              .set({ status: "SUCCEEDED", updatedAt: new Date() })
              .where(eq(paymentIntents.id, intentRecord.id));

            await processSuccessfulPaymentSettlement(tx, {
              milestoneId: intentRecord.milestoneId,
              paymentIntentId: stripePiId,
              contractorId: intentRecord.contractorId,
              customerId: intentRecord.customerId,
              amountCents: Number(intentRecord.amountCents),
              provider: "STRIPE_CONNECT",
              idempotencyKey: `wh_tx_${stripePiId}`,
            });
          });
        }
      } else if (event.type === "payment_intent.payment_failed") {
        const piData = event.data.object;
        const stripePiId = piData["id"] as string;

        await db
          .update(paymentIntents)
          .set({
            status: "FAILED",
            failureCode: "payment_failed",
            failureMessage: "Card or payment method processing failed",
            updatedAt: new Date(),
          })
          .where(eq(paymentIntents.stripePaymentIntentId, stripePiId));
      } else if (event.type === "charge.dispute.created") {
        const disputeData = event.data.object;
        const disputeId = disputeData["id"] as string;
        const amount = Number(disputeData["amount"] ?? 0);
        const currency = String(disputeData["currency"] ?? "cad").toUpperCase();
        const reason = String(disputeData["reason"] ?? "fraudulent");

        await db
          .insert(paymentDisputes)
          .values({
            stripeDisputeId: disputeId,
            amountCents: amount,
            currency,
            status: "NEEDS_RESPONSE",
            reason,
            metadata: disputeData,
          })
          .onConflictDoNothing({ target: paymentDisputes.stripeDisputeId });
      }

      // Mark event as PROCESSED
      await db
        .update(stripeWebhookEvents)
        .set({ status: "PROCESSED", processedAt: new Date() })
        .where(eq(stripeWebhookEvents.eventId, event.id));

      return reply.code(200).send({ received: true });
    } catch (processErr) {
      await db
        .update(stripeWebhookEvents)
        .set({
          status: "FAILED",
          errorMessage: (processErr as Error).message,
        })
        .where(eq(stripeWebhookEvents.eventId, event.id));

      return reply.code(500).send({
        code: "WEBHOOK_PROCESSING_ERROR",
        message: (processErr as Error).message,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Milestone Direct Pay (Backwards Compatibility)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/payment-milestones/:id/pay",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const milestoneId = parse(z.object({ id: uuid }), request.params).id;
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)
        return reply.code(400).send({
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A sufficiently random Idempotency-Key is required",
        });

      const outcome = await db.transaction(async (tx) => {
        const [present] = await tx
          .select({
            id: paymentTransactions.id,
            status: paymentTransactions.status,
          })
          .from(paymentTransactions)
          .innerJoin(
            paymentMilestones,
            eq(paymentMilestones.id, paymentTransactions.milestoneId),
          )
          .innerJoin(
            paymentSchedules,
            eq(paymentSchedules.id, paymentMilestones.scheduleId),
          )
          .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
          .innerJoin(jobs, eq(jobs.id, quotes.jobId))
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(
            and(
              eq(paymentTransactions.idempotencyKey, idempotencyKey),
              eq(serviceRequests.customerId, actor(request).id),
            ),
          )
          .limit(1);

        if (present) return present;

        const [row] = await tx
          .select({
            amount_cents: paymentMilestones.amountCents,
            currency: paymentSchedules.currency,
            status: paymentMilestones.status,
            customer_id: serviceRequests.customerId,
            sequence: paymentMilestones.sequence,
            schedule_id: paymentMilestones.scheduleId,
          })
          .from(paymentMilestones)
          .innerJoin(
            paymentSchedules,
            eq(paymentSchedules.id, paymentMilestones.scheduleId),
          )
          .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
          .innerJoin(jobs, eq(jobs.id, quotes.jobId))
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(paymentMilestones.id, milestoneId))
          .for("update", { of: paymentMilestones });

        if (!row) throw new Error("NOT_FOUND");
        if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
        if (!["PENDING", "REQUIRES_ACTION"].includes(row.status))
          throw new Error("MILESTONE_UNAVAILABLE");

        const [prior] = await tx
          .select({ id: paymentMilestones.id })
          .from(paymentMilestones)
          .where(
            and(
              eq(paymentMilestones.scheduleId, row.schedule_id),
              sql`${paymentMilestones.sequence} < ${row.sequence}`,
              sql`${paymentMilestones.status} NOT IN ('PAID', 'WAIVED')`,
            ),
          )
          .limit(1);

        if (prior) throw new Error("PRIOR_MILESTONE_REQUIRED");

        const ref = `local_${crypto.randomUUID()}`;
        const [saved] = await tx
          .insert(paymentTransactions)
          .values({
            milestoneId,
            provider: "LOCAL_TEST",
            providerReference: ref,
            idempotencyKey,
            amountCents: Number(row.amount_cents),
            currency: row.currency,
            status: "PAID",
          })
          .returning({ id: paymentTransactions.id });

        await tx
          .update(paymentMilestones)
          .set({ status: "PAID", paidAt: new Date() })
          .where(eq(paymentMilestones.id, milestoneId));

        return {
          transactionId: saved?.id,
          status: "PAID",
          providerReference: ref,
        };
      });

      await audit(
        actor(request).id,
        "PAYMENT_SUCCEEDED",
        "PAYMENT_MILESTONE",
        milestoneId,
        null,
        outcome,
      );
      return reply.code(201).send(outcome);
    },
  );

  // ---------------------------------------------------------------------------
  // 6. Refunds with Amount Ceiling Validation
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/refunds",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN");
      const currentActor = actor(request);
      const body = parse(processRefundSchema, request.body);

      const [transactionRow] = await db
        .select({
          amount_cents: paymentTransactions.amountCents,
          status: paymentTransactions.status,
          provider: paymentTransactions.provider,
          providerReference: paymentTransactions.providerReference,
          refunded_cents: sql<number>`COALESCE(sum(${refunds.amountCents}) FILTER (WHERE ${refunds.status}='REFUNDED'),0)`,
        })
        .from(paymentTransactions)
        .leftJoin(refunds, eq(refunds.transactionId, paymentTransactions.id))
        .where(eq(paymentTransactions.id, body.transactionId))
        .groupBy(paymentTransactions.id);

      if (
        !transactionRow ||
        transactionRow.status !== "PAID" ||
        body.amountCents + Number(transactionRow.refunded_cents) >
          Number(transactionRow.amount_cents)
      ) {
        return reply.code(422).send({
          code: "REFUND_UNAVAILABLE",
          message: "Refund amount exceeds remaining refundable balance or transaction is not paid",
        });
      }

      // If provider was Stripe, issue refund through Stripe sandbox
      let refundRef = `ref_${crypto.randomUUID()}`;
      if (transactionRow.provider === "STRIPE_CONNECT") {
        const stripeRefund = await stripeService.refundPayment({
          transactionProviderReference: transactionRow.providerReference,
          amountCents: body.amountCents,
          reason: body.reason,
          idempotencyKey: body.idempotencyKey,
        });
        refundRef = stripeRefund.refundReference;
      }

      const [result] = await db
        .insert(refunds)
        .values({
          transactionId: body.transactionId,
          amountCents: body.amountCents,
          reason: body.reason,
          status: "REFUNDED",
          idempotencyKey: body.idempotencyKey,
          createdBy: currentActor.id,
        })
        .onConflictDoNothing({ target: refunds.idempotencyKey })
        .returning({ id: refunds.id });

      // Record double-entry refund ledger and update contractor payout balance
      const [txContext] = await db
        .select({
          contractorId: jobs.contractorId,
          customerId: serviceRequests.customerId,
          milestoneId: paymentTransactions.milestoneId,
        })
        .from(paymentTransactions)
        .innerJoin(paymentMilestones, eq(paymentMilestones.id, paymentTransactions.milestoneId))
        .innerJoin(paymentSchedules, eq(paymentSchedules.id, paymentMilestones.scheduleId))
        .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
        .innerJoin(jobs, eq(jobs.id, quotes.jobId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(paymentTransactions.id, body.transactionId))
        .limit(1);

      if (txContext && result?.id) {
        await db.transaction(async (tx) => {
          const refundLedger = generateRefundLedgerEntries({
            refundId: result.id,
            transactionId: body.transactionId,
            contractorId: txContext.contractorId,
            customerId: txContext.customerId,
            refundAmountCents: body.amountCents,
          });
          await recordLedgerEntriesInDb(tx, refundLedger);

          const feeReversal = calculateApplicationFee(body.amountCents);
          const contractorDebit = body.amountCents - feeReversal;
          const currentBal = await getOrCreateContractorBalance(tx, txContext.contractorId);
          const updatedBal = applyLedgerToContractorBalance(currentBal, {
            type: "REFUND_DEBIT",
            amountCents: contractorDebit,
          });

          await tx
            .update(contractorPayoutBalances)
            .set({
              availableBalanceCents: updatedBal.availableBalanceCents,
              heldBalanceCents: updatedBal.heldBalanceCents,
              lifetimeEarningsCents: updatedBal.lifetimeEarningsCents,
              isNegative: updatedBal.isNegative,
              updatedAt: new Date(),
            })
            .where(eq(contractorPayoutBalances.contractorId, txContext.contractorId));
        });
      }

      await audit(
        currentActor.id,
        "REFUND_ISSUED",
        "PAYMENT_TRANSACTION",
        body.transactionId,
        null,
        { amountCents: body.amountCents, providerReference: refundRef },
      );

      return reply.code(201).send({
        refundId: result?.id,
        status: "REFUNDED",
        amountCents: body.amountCents,
        providerReference: refundRef,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 7. Payout Holds & Evidence Gates (SH-08)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/payouts/holds",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "OPERATIONS_AGENT", "SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN");
      const currentActor = actor(request);
      const body = parse(payoutHoldPlaceSchema, request.body);

      const [hold] = await db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(payoutHolds)
          .values({
            contractorId: body.contractorId,
            milestoneId: body.milestoneId,
            amountCents: body.amountCents,
            currency: "CAD",
            holdReason: body.holdReason,
            holdStatus: "ACTIVE",
            requiredEvidenceType: body.requiredEvidenceType ?? "COMPLETION_SIGN_OFF",
            evidenceAttachmentId: body.evidenceAttachmentId,
            placedByUserId: currentActor.id,
            releaseNotes: body.releaseNotes,
          })
          .returning();

        const holdLedger = generatePayoutHoldLedgerEntries({
          contractorId: body.contractorId,
          milestoneId: body.milestoneId,
          amountCents: body.amountCents,
          holdReason: body.holdReason,
        });
        await recordLedgerEntriesInDb(tx, holdLedger);

        const currentBal = await getOrCreateContractorBalance(tx, body.contractorId);
        const updatedBal = applyLedgerToContractorBalance(currentBal, {
          type: "HOLD",
          amountCents: body.amountCents,
        });

        await tx
          .update(contractorPayoutBalances)
          .set({
            availableBalanceCents: updatedBal.availableBalanceCents,
            heldBalanceCents: updatedBal.heldBalanceCents,
            isNegative: updatedBal.isNegative,
            updatedAt: new Date(),
          })
          .where(eq(contractorPayoutBalances.contractorId, body.contractorId));

        return [saved];
      });

      await audit(
        currentActor.id,
        "PAYOUT_HOLD_PLACED",
        "PAYOUT_HOLD",
        hold!.id,
        null,
        {
          contractorId: body.contractorId,
          milestoneId: body.milestoneId,
          amountCents: body.amountCents,
          holdReason: body.holdReason,
        },
      );

      return reply.code(201).send(hold);
    },
  );

  app.post(
    "/v1/payouts/holds/:id/release",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "CONTRACTOR_OWNER",
        "OPERATIONS_AGENT",
        "SUPPORT_AGENT",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const currentActor = actor(request);
      const holdId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(payoutHoldReleaseSchema, request.body);

      const [existingHold] = await db
        .select()
        .from(payoutHolds)
        .where(eq(payoutHolds.id, holdId))
        .limit(1);

      if (!existingHold) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Payout hold not found",
        });
      }

      if (existingHold.holdStatus !== "ACTIVE") {
        return reply.code(422).send({
          code: "HOLD_NOT_ACTIVE",
          message: `Payout hold is already ${existingHold.holdStatus.toLowerCase()}`,
        });
      }

      const [released] = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(payoutHolds)
          .set({
            holdStatus: "RELEASED",
            releasedAt: new Date(),
            releasedByUserId: currentActor.id,
            releaseNotes: body.releaseNotes,
            evidenceAttachmentId: body.evidenceAttachmentId ?? existingHold.evidenceAttachmentId,
          })
          .where(eq(payoutHolds.id, holdId))
          .returning();

        const releaseLedger = generatePayoutReleaseLedgerEntries({
          contractorId: existingHold.contractorId,
          milestoneId: existingHold.milestoneId,
          amountCents: Number(existingHold.amountCents),
          releaseNotes: body.releaseNotes,
        });
        await recordLedgerEntriesInDb(tx, releaseLedger);

        const currentBal = await getOrCreateContractorBalance(tx, existingHold.contractorId);
        const updatedBal = applyLedgerToContractorBalance(currentBal, {
          type: "RELEASE",
          amountCents: Number(existingHold.amountCents),
        });

        await tx
          .update(contractorPayoutBalances)
          .set({
            availableBalanceCents: updatedBal.availableBalanceCents,
            heldBalanceCents: updatedBal.heldBalanceCents,
            isNegative: updatedBal.isNegative,
            updatedAt: new Date(),
          })
          .where(eq(contractorPayoutBalances.contractorId, existingHold.contractorId));

        // SH-09: Atomic Outbox Notification to contractor regarding funds released
        await enqueueTransactionalNotification(tx, {
          aggregateType: "MILESTONE",
          aggregateId: existingHold.milestoneId,
          eventType: "PAYOUT_HOLD_RELEASED",
          idempotencyKey: generateOutboxIdempotencyKey(
            "MILESTONE",
            existingHold.milestoneId,
            "PAYOUT_HOLD_RELEASED",
            "EMAIL",
            existingHold.contractorId,
          ),
          recipientUserId: existingHold.contractorId,
          channel: "EMAIL",
          destination: "contractor@example.test",
          templateSlug: "ontario_hvac_payout_hold_released_v1",
          payload: {
            contractorName: "Partner Contractor",
            milestoneName: existingHold.milestoneId,
            amountDollars: (Number(existingHold.amountCents) / 100).toFixed(2),
          },
        });

        return [updated];
      });

      await audit(
        currentActor.id,
        "PAYOUT_HOLD_RELEASED",
        "PAYOUT_HOLD",
        holdId,
        { previousStatus: "ACTIVE" },
        { status: "RELEASED", releaseNotes: body.releaseNotes },
      );

      return reply.code(200).send(released);
    },
  );

  app.get(
    "/v1/payouts/holds",
    { preHandler: authenticate },
    async (request, reply) => {
      const query = parse(
        z.object({
          contractorId: uuid.optional(),
          status: z.enum(["ACTIVE", "RELEASED", "FORFEITED", "ALL"]).default("ALL"),
        }),
        request.query ?? {},
      );

      const conditions = [];
      if (query.contractorId) {
        conditions.push(eq(payoutHolds.contractorId, query.contractorId));
      }
      if (
        query.status === "ACTIVE" ||
        query.status === "RELEASED" ||
        query.status === "FORFEITED"
      ) {
        conditions.push(eq(payoutHolds.holdStatus, query.status));
      }

      const holds = await db
        .select()
        .from(payoutHolds)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(payoutHolds.createdAt));

      return reply.code(200).send({
        holds: holds.map((h) => ({
          id: h.id,
          contractorId: h.contractorId,
          milestoneId: h.milestoneId,
          amountCents: Number(h.amountCents),
          currency: h.currency,
          holdReason: h.holdReason,
          holdStatus: h.holdStatus,
          requiredEvidenceType: h.requiredEvidenceType,
          evidenceAttachmentId: h.evidenceAttachmentId,
          releaseNotes: h.releaseNotes,
          createdAt: h.createdAt.toISOString(),
          releasedAt: h.releasedAt?.toISOString() ?? null,
        })),
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 8. Contractor Payout Balance & Ledger History (SH-08)
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/contractors/:id/payout-balance",
    { preHandler: authenticate },
    async (request, reply) => {
      const contractorId = parse(z.object({ id: uuid }), request.params).id;

      let [balance] = await db
        .select()
        .from(contractorPayoutBalances)
        .where(eq(contractorPayoutBalances.contractorId, contractorId))
        .limit(1);

      if (!balance) {
        [balance] = await db
          .insert(contractorPayoutBalances)
          .values({
            contractorId,
            availableBalanceCents: 0,
            heldBalanceCents: 0,
            lifetimeEarningsCents: 0,
            lifetimePayoutsCents: 0,
            isNegative: false,
            currency: "CAD",
          })
          .returning();
      }

      const activeHolds = await db
        .select()
        .from(payoutHolds)
        .where(
          and(
            eq(payoutHolds.contractorId, contractorId),
            eq(payoutHolds.holdStatus, "ACTIVE"),
          ),
        )
        .orderBy(desc(payoutHolds.createdAt));

      const ledgerEntries = await db
        .select()
        .from(marketplaceFinancialLedger)
        .where(eq(marketplaceFinancialLedger.contractorId, contractorId))
        .orderBy(desc(marketplaceFinancialLedger.createdAt))
        .limit(50);

      return reply.code(200).send({
        contractorId: balance?.contractorId,
        availableBalanceCents: Number(balance?.availableBalanceCents ?? 0),
        heldBalanceCents: Number(balance?.heldBalanceCents ?? 0),
        lifetimeEarningsCents: Number(balance?.lifetimeEarningsCents ?? 0),
        lifetimePayoutsCents: Number(balance?.lifetimePayoutsCents ?? 0),
        isNegative: balance?.isNegative ?? false,
        currency: balance?.currency ?? "CAD",
        activeHolds: activeHolds.map((h) => ({
          id: h.id,
          milestoneId: h.milestoneId,
          amountCents: Number(h.amountCents),
          holdReason: h.holdReason,
          requiredEvidenceType: h.requiredEvidenceType,
          createdAt: h.createdAt.toISOString(),
        })),
        recentLedgerEntries: ledgerEntries.map((l) => ({
          id: l.id,
          entryType: l.entryType,
          accountType: l.accountType,
          direction: l.direction,
          amountCents: Number(l.amountCents),
          description: l.description,
          createdAt: l.createdAt.toISOString(),
        })),
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 9. Contractor Payout Transfer (Bank Disbursal via Connect) (SH-08)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/payouts/transfer",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
        "OPERATIONS_AGENT",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const currentActor = actor(request);
      const body = parse(contractorPayoutTransferSchema, request.body);

      const [balance] = await db
        .select()
        .from(contractorPayoutBalances)
        .where(eq(contractorPayoutBalances.contractorId, body.contractorId))
        .limit(1);

      if (!balance || Number(balance.availableBalanceCents) <= 0 || balance.isNegative) {
        return reply.code(422).send({
          code: "INSUFFICIENT_AVAILABLE_FUNDS",
          message: "Contractor has no available positive balance for payout transfer",
        });
      }

      const transferAmount = body.amountCents ?? Number(balance.availableBalanceCents);
      if (transferAmount > Number(balance.availableBalanceCents)) {
        return reply.code(422).send({
          code: "TRANSFER_EXCEEDS_AVAILABLE",
          message: `Requested payout ($${(transferAmount / 100).toFixed(2)}) exceeds available balance ($${(Number(balance.availableBalanceCents) / 100).toFixed(2)})`,
        });
      }

      const stripeTransferId = `tr_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

      const [updatedBal] = await db.transaction(async (tx) => {
        const payoutLedger = generateContractorPayoutLedgerEntries({
          contractorId: body.contractorId,
          amountCents: transferAmount,
          stripeTransferId,
        });
        await recordLedgerEntriesInDb(tx, payoutLedger);

        const currentSnapshot = {
          availableBalanceCents: Number(balance.availableBalanceCents),
          heldBalanceCents: Number(balance.heldBalanceCents),
          lifetimeEarningsCents: Number(balance.lifetimeEarningsCents),
          lifetimePayoutsCents: Number(balance.lifetimePayoutsCents),
          isNegative: balance.isNegative,
        };

        const nextSnapshot = applyLedgerToContractorBalance(currentSnapshot, {
          type: "PAYOUT",
          amountCents: transferAmount,
        });

        const [saved] = await tx
          .update(contractorPayoutBalances)
          .set({
            availableBalanceCents: nextSnapshot.availableBalanceCents,
            lifetimePayoutsCents: nextSnapshot.lifetimePayoutsCents,
            isNegative: nextSnapshot.isNegative,
            updatedAt: new Date(),
          })
          .where(eq(contractorPayoutBalances.contractorId, body.contractorId))
          .returning();

        return [saved];
      });

      await audit(
        currentActor.id,
        "PAYOUT_TRANSFERRED",
        "CONTRACTOR_PAYOUT_BALANCE",
        body.contractorId,
        null,
        { transferAmount, stripeTransferId },
      );

      return reply.code(200).send({
        stripeTransferId,
        transferAmountCents: transferAmount,
        status: "DISPATCHED",
        remainingAvailableBalanceCents: Number(updatedBal?.availableBalanceCents ?? 0),
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 10. Daily Financial Reconciliation & Discrepancy Audits (SH-08)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/reconciliation/run",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "OPERATIONS_AGENT", "ADMIN", "SUPER_ADMIN");
      const currentActor = actor(request);
      const body = parse(reconciliationRunSchema, request.body ?? {});
      const reportDate = body.reportDate ?? new Date().toISOString().split("T")[0]!;

      // Gather financial data for reconciliation
      const charges = await db
        .select({
          id: marketplaceFinancialLedger.id,
          amountCents: marketplaceFinancialLedger.amountCents,
        })
        .from(marketplaceFinancialLedger)
        .where(
          and(
            eq(marketplaceFinancialLedger.entryType, "CUSTOMER_CHARGE"),
            eq(marketplaceFinancialLedger.accountType, "STRIPE_CLEARING"),
          ),
        );

      const platformFees = await db
        .select({
          id: marketplaceFinancialLedger.id,
          amountCents: marketplaceFinancialLedger.amountCents,
        })
        .from(marketplaceFinancialLedger)
        .where(eq(marketplaceFinancialLedger.accountType, "PLATFORM_REVENUE"));

      const payouts = await db
        .select({
          id: marketplaceFinancialLedger.id,
          amountCents: marketplaceFinancialLedger.amountCents,
        })
        .from(marketplaceFinancialLedger)
        .where(
          and(
            eq(marketplaceFinancialLedger.entryType, "CONTRACTOR_PAYOUT"),
            eq(marketplaceFinancialLedger.direction, "DEBIT"),
          ),
        );

      const refundEntries = await db
        .select({
          id: marketplaceFinancialLedger.id,
          amountCents: marketplaceFinancialLedger.amountCents,
        })
        .from(marketplaceFinancialLedger)
        .where(
          and(
            eq(marketplaceFinancialLedger.entryType, "REFUND_DEBIT"),
            eq(marketplaceFinancialLedger.accountType, "STRIPE_CLEARING"),
          ),
        );

      const activeHolds = await db
        .select({
          id: payoutHolds.id,
          amountCents: payoutHolds.amountCents,
        })
        .from(payoutHolds)
        .where(eq(payoutHolds.holdStatus, "ACTIVE"));

      const unpaidBalances = await db
        .select({
          contractorId: contractorPayoutBalances.contractorId,
          amountCents: contractorPayoutBalances.availableBalanceCents,
        })
        .from(contractorPayoutBalances);

      const recResult = computeFinancialReconciliation(
        {
          charges: charges.map((c) => ({ id: c.id, amountCents: Number(c.amountCents) })),
          platformFees: platformFees.map((f) => ({ id: f.id, amountCents: Number(f.amountCents) })),
          payouts: payouts.map((p) => ({ id: p.id, amountCents: Number(p.amountCents) })),
          refunds: refundEntries.map((r) => ({ id: r.id, amountCents: Number(r.amountCents) })),
          activeHolds: activeHolds.map((h) => ({ id: h.id, amountCents: Number(h.amountCents) })),
          unpaidAvailableBalances: unpaidBalances.map((b) => ({
            contractorId: b.contractorId,
            amountCents: Number(b.amountCents),
          })),
        },
        reportDate,
      );

      const [report] = await db
        .insert(financialReconciliationReports)
        .values({
          reportDate,
          totalChargesCents: recResult.totalChargesCents,
          totalPlatformFeesCents: recResult.totalPlatformFeesCents,
          totalContractorPayoutsCents: recResult.totalContractorPayoutsCents,
          totalRefundsCents: recResult.totalRefundsCents,
          totalActiveHoldsCents: recResult.totalActiveHoldsCents,
          discrepancyCents: recResult.discrepancyCents,
          status: recResult.status,
          unreconciledTransactionIds: recResult.unreconciledIds,
          exceptionNotes: body.notes ?? recResult.summary,
          generatedBy: currentActor.id,
        })
        .returning();

      await audit(
        currentActor.id,
        "FINANCIAL_RECONCILIATION_RUN",
        "FINANCIAL_RECONCILIATION_REPORT",
        report!.id,
        null,
        { status: recResult.status, discrepancyCents: recResult.discrepancyCents },
      );

      return reply.code(201).send(report);
    },
  );

  app.get(
    "/v1/reconciliation/reports",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "OPERATIONS_AGENT", "ADMIN", "SUPER_ADMIN");

      const reports = await db
        .select()
        .from(financialReconciliationReports)
        .orderBy(desc(financialReconciliationReports.createdAt))
        .limit(30);

      return reply.code(200).send({
        reports: reports.map((r) => ({
          id: r.id,
          reportDate: r.reportDate,
          totalChargesCents: Number(r.totalChargesCents),
          totalPlatformFeesCents: Number(r.totalPlatformFeesCents),
          totalContractorPayoutsCents: Number(r.totalContractorPayoutsCents),
          totalRefundsCents: Number(r.totalRefundsCents),
          totalActiveHoldsCents: Number(r.totalActiveHoldsCents),
          discrepancyCents: Number(r.discrepancyCents),
          status: r.status,
          unreconciledTransactionIds: r.unreconciledTransactionIds,
          exceptionNotes: r.exceptionNotes,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    },
  );
};

