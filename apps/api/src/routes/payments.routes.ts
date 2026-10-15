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
} from "@marketplace/database";
import {
  StripeSandboxService,
  verifyStripeWebhookSignature,
  calculateApplicationFee,
  StripeSignatureError,
} from "@marketplace/payments";
import {
  connectOnboardInitiateSchema,
  createPaymentIntentSchema,
  confirmPaymentIntentSchema,
  attachPaymentMethodSchema,
  processRefundSchema,
} from "@marketplace/validation";
import { actor, authenticate, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

const stripeService = new StripeSandboxService();

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

          // Record payment transaction
          await tx
            .insert(paymentTransactions)
            .values({
              milestoneId: intent.milestoneId,
              provider: "STRIPE_CONNECT",
              providerReference: confirmResult.paymentIntentId,
              idempotencyKey: `tx_${confirmResult.paymentIntentId}`,
              amountCents: Number(intent.amountCents),
              currency: intent.currency,
              status: "PAID",
            })
            .onConflictDoNothing({ target: paymentTransactions.idempotencyKey });

          // Update milestone
          await tx
            .update(paymentMilestones)
            .set({ status: "PAID", paidAt: new Date() })
            .where(eq(paymentMilestones.id, intent.milestoneId));
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

            await tx
              .insert(paymentTransactions)
              .values({
                milestoneId: intentRecord.milestoneId,
                provider: "STRIPE_CONNECT",
                providerReference: stripePiId,
                idempotencyKey: `wh_tx_${stripePiId}`,
                amountCents: Number(intentRecord.amountCents),
                currency: intentRecord.currency,
                status: "PAID",
              })
              .onConflictDoNothing({ target: paymentTransactions.idempotencyKey });

            await tx
              .update(paymentMilestones)
              .set({ status: "PAID", paidAt: new Date() })
              .where(eq(paymentMilestones.id, intentRecord.milestoneId));
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
};
