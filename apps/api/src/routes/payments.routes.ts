import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import {
  db,
  eq,
  and,
  sql,
  paymentTransactions,
  paymentMilestones,
  paymentSchedules,
  quotes,
  jobs,
  serviceRequests,
  refunds,
} from "@marketplace/database";
import { actor, authenticate, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const paymentsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/payment-milestones/:id/pay",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const milestoneId = parse(z.object({ id: uuid }), request.params).id;
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)
        return reply
          .code(400)
          .send({
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

  app.post(
    "/v1/refunds",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN");
      const body = parse(
        z.object({
          transactionId: uuid,
          amountCents: z.number().int().positive(),
          reason: z.string().min(3).max(1000),
          idempotencyKey: z.string().min(16).max(255),
        }),
        request.body,
      );

      const [transactionRow] = await db
        .select({
          amount_cents: paymentTransactions.amountCents,
          status: paymentTransactions.status,
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
      )
        return reply
          .code(422)
          .send({
            code: "REFUND_UNAVAILABLE",
            message: "Refund is not valid for this transaction",
          });

      const [result] = await db
        .insert(refunds)
        .values({
          transactionId: body.transactionId,
          amountCents: body.amountCents,
          reason: body.reason,
          status: "REFUNDED",
          idempotencyKey: body.idempotencyKey,
          createdBy: actor(request).id,
        })
        .onConflictDoNothing({ target: refunds.idempotencyKey })
        .returning({ id: refunds.id });

      await audit(
        actor(request).id,
        "REFUND_ISSUED",
        "PAYMENT_TRANSACTION",
        body.transactionId,
        null,
        { amountCents: body.amountCents },
      );
      return reply
        .code(201)
        .send({ refundId: result?.id, status: "REFUNDED" });
    },
  );
};
