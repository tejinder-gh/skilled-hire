import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hasRole, requireRole } from "@marketplace/auth";
import {
  db,
  eq,
  desc,
  notifications,
  serviceRequests,
  jobs,
  supportTickets,
  disputes,
  disputeEvidence,
  payouts,
} from "@marketplace/database";
import { supportTicketSchema } from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit, emit } from "../common/events.js";

export const supportRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/v1/notifications",
    { preHandler: authenticate },
    async (request) =>
      await db
        .select({
          id: notifications.id,
          event_type: notifications.eventType,
          title: notifications.title,
          body: notifications.body,
          payload: notifications.payload,
          read_at: notifications.readAt,
          created_at: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.recipientUserId, actor(request).id))
        .orderBy(desc(notifications.createdAt))
        .limit(100),
  );

  app.post(
    "/v1/support-tickets",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = parse(supportTicketSchema, request.body);
      let linked: { customer_id: string; contractor_id: string } | undefined;
      if (body.jobId) {
        const [job] = await db
          .select({
            customer_id: serviceRequests.customerId,
            contractor_id: jobs.contractorId,
          })
          .from(jobs)
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(jobs.id, body.jobId))
          .limit(1);
        linked = job;
      }

      if (
        body.jobId &&
        (!linked ||
          (linked.customer_id !== actor(request).id && !isOps(actor(request))))
      )
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted" });

      const [ticket] = await db
        .insert(supportTickets)
        .values({
          customerId: hasRole(actor(request), "CUSTOMER")
            ? actor(request).id
            : null,
          contractorId: linked?.contractor_id ?? null,
          jobId: body.jobId ?? null,
          subject: body.subject,
          description: body.description,
        })
        .returning({ id: supportTickets.id });

      const ticketId = ticket?.id;
      if (!ticketId) throw new Error("INSERT_FAILED");

      let disputeId: string | undefined;
      if (
        body.dispute &&
        body.jobId &&
        linked &&
        linked.contractor_id &&
        hasRole(actor(request), "CUSTOMER")
      ) {
        const [dispute] = await db
          .insert(disputes)
          .values({
            supportTicketId: ticketId,
            jobId: body.jobId,
            customerId: actor(request).id,
            contractorId: linked.contractor_id,
          })
          .returning({ id: disputes.id });

        disputeId = dispute?.id;
        if (disputeId && body.evidenceKeys) {
          for (const key of body.evidenceKeys) {
            await db.insert(disputeEvidence).values({
              disputeId,
              submittedBy: actor(request).id,
              attachmentKey: key,
            });
          }
        }
      }

      await audit(
        actor(request).id,
        body.dispute ? "DISPUTE_OPENED" : "SUPPORT_TICKET_OPENED",
        body.dispute ? "DISPUTE" : "SUPPORT_TICKET",
        disputeId ?? ticketId,
        null,
        { jobId: body.jobId },
      );
      return reply.code(201).send({ ticketId, disputeId });
    },
  );

  app.post(
    "/v1/disputes/:id/resolve",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "SUPPORT_AGENT",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const disputeId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(
        z.object({
          resolution: z.enum([
            "RELEASE_TO_CONTRACTOR",
            "REFUND_TO_CUSTOMER",
            "SPLIT_EQUAL",
          ]),
          refundCents: z.number().int().nonnegative().optional(),
          notes: z.string().min(3).max(1000),
        }),
        request.body,
      );

      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            id: disputes.id,
            job_id: disputes.jobId,
            support_ticket_id: disputes.supportTicketId,
            customer_id: disputes.customerId,
            contractor_id: disputes.contractorId,
            status: disputes.status,
          })
          .from(disputes)
          .where(eq(disputes.id, disputeId))
          .for("update", { of: disputes });

        if (!row) throw new Error("NOT_FOUND");
        if (row.status === "RESOLVED" || row.status === "CLOSED")
          return reply.code(409).send({
            code: "DISPUTE_ALREADY_RESOLVED",
            message: "Dispute already resolved",
          });

        const [payoutRow] = await tx
          .select({
            id: payouts.id,
            amount_cents: payouts.amountCents,
            status: payouts.status,
          })
          .from(payouts)
          .where(eq(payouts.jobId, row.job_id))
          .for("update", { of: payouts });

        const totalPayoutCents = payoutRow ? Number(payoutRow.amount_cents) : 0;
        let refundDecisionCents = 0;

        if (body.resolution === "RELEASE_TO_CONTRACTOR") {
          if (payoutRow) {
            await tx
              .update(payouts)
              .set({ status: "ELIGIBLE", eligibleAt: new Date() })
              .where(eq(payouts.id, payoutRow.id));
          }
        } else if (body.resolution === "REFUND_TO_CUSTOMER") {
          refundDecisionCents = body.refundCents ?? totalPayoutCents;
          if (payoutRow) {
            await tx
              .update(payouts)
              .set({ status: "REVERSED" })
              .where(eq(payouts.id, payoutRow.id));
          }
        } else if (body.resolution === "SPLIT_EQUAL") {
          const half = Math.floor(totalPayoutCents / 2);
          refundDecisionCents = half;
          if (payoutRow) {
            await tx
              .update(payouts)
              .set({
                amountCents: totalPayoutCents - half,
                status: "ELIGIBLE",
                eligibleAt: new Date(),
              })
              .where(eq(payouts.id, payoutRow.id));
          }
        }

        await tx
          .update(disputes)
          .set({
            status: "RESOLVED",
            resolution: `${body.resolution}: ${body.notes}`,
            refundDecisionCents,
            resolvedBy: actor(request).id,
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(disputes.id, disputeId));

        await tx
          .update(supportTickets)
          .set({
            status: "RESOLVED",
            closedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(supportTickets.id, row.support_ticket_id));

        await tx
          .update(jobs)
          .set({ status: "CLOSED", updatedAt: new Date() })
          .where(eq(jobs.id, row.job_id));

        return {
          disputeId,
          resolution: body.resolution,
          refundDecisionCents,
          status: "RESOLVED",
        };
      });

      if (!result) return;
      await audit(
        actor(request).id,
        "DISPUTE_RESOLVED",
        "DISPUTE",
        disputeId,
        null,
        result,
      );
      await emit("DISPUTE", disputeId, "DisputeResolved", result);
      return reply.code(200).send(result);
    },
  );
};
