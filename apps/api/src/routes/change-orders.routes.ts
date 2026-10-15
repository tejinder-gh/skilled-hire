import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import { ONTARIO_LABOUR_ONLY_DISCLAIMER } from "@marketplace/contracts";
import { itemizedQuoteTotals } from "@marketplace/core";
import {
  db,
  eq,
  and,
  sql,
  jobs,
  technicians,
  serviceRequests,
  changeOrders,
  changeOrderItems,
  idempotencyKeys,
  paymentSchedules,
  paymentMilestones,
  quotes,
} from "@marketplace/database";
import {
  changeOrderSchema,
  declineChangeOrderSchema,
} from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit, emit, notify } from "../common/events.js";

export const changeOrdersRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/jobs/:id/change-orders",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "TECHNICIAN");
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(changeOrderSchema, request.body);

      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            status: jobs.status,
            technician_user_id: technicians.userId,
            customer_id: serviceRequests.customerId,
          })
          .from(jobs)
          .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!row) throw new Error("NOT_FOUND");
        if (row.technician_user_id !== actor(request).id)
          throw new Error("FORBIDDEN");
        if (row.status !== "WORK_IN_PROGRESS")
          throw new Error("CHANGE_ORDER_NOT_ALLOWED");

        const [open] = await tx
          .select({ id: changeOrders.id })
          .from(changeOrders)
          .where(
            and(
              eq(changeOrders.jobId, jobId),
              eq(changeOrders.status, "SUBMITTED"),
            ),
          )
          .limit(1);

        if (open) throw new Error("CHANGE_ORDER_ALREADY_PENDING");

        const totals = itemizedQuoteTotals(
          body.items,
          body.platformFeeCents,
          0,
          body.taxCents,
          body.diagnosticFeeCents ?? 0,
        );

        const [versionRow] = await tx
          .select({
            version: sql<number>`COALESCE(MAX(${changeOrders.version}),0)+1`,
          })
          .from(changeOrders)
          .where(eq(changeOrders.jobId, jobId));

        const version = Number(versionRow?.version ?? 1);

        const customerSuppliedPartsCaveat =
          totals.customerSuppliedCount > 0
            ? (body.customerSuppliedPartsCaveat ?? ONTARIO_LABOUR_ONLY_DISCLAIMER)
            : null;

        const [created] = await tx
          .insert(changeOrders)
          .values({
            jobId,
            version,
            status: "SUBMITTED",
            reason: body.reason,
            explanation: body.explanation,
            attachmentKeys: body.attachmentKeys,
            contractorSubtotalCents: totals.contractorSubtotalCents,
            diagnosticFeeCents: totals.diagnosticFeeCents,
            laborSubtotalCents: totals.laborSubtotalCents,
            materialsSubtotalCents: totals.materialsSubtotalCents,
            disposalSubtotalCents: totals.disposalSubtotalCents,
            permitsSubtotalCents: totals.permitsSubtotalCents,
            customerSuppliedPartsCaveat,
            customerSuppliedAcknowledged: false,
            platformFeeCents: body.platformFeeCents,
            taxCents: body.taxCents,
            customerTotalCents: totals.customerTotalCents,
            expiresAt: new Date(body.expiresAt),
          })
          .returning({ id: changeOrders.id });

        const changeOrderId = created?.id;
        if (!changeOrderId) throw new Error("INSERT_FAILED");

        for (const [index, item] of body.items.entries()) {
          const subtotal = totals.itemSubtotals[index];
          if (subtotal === undefined)
            throw new Error("QUOTE_CALCULATION_FAILED");
          await tx.insert(changeOrderItems).values({
            changeOrderId,
            type: item.type,
            title: item.title,
            description: item.description ?? null,
            quantity: item.quantity,
            unitPriceCents: item.isCustomerSupplied ? 0 : item.unitPriceCents,
            subtotalCents: subtotal,
            isCustomerSupplied: item.isCustomerSupplied ?? false,
            warrantyCaveat: item.isCustomerSupplied
              ? (item.warrantyCaveat ?? "Labour only warranty; customer assumes part defect risk under Ontario CPA")
              : (item.warrantyCaveat ?? null),
            materialMetadata: item.materialMetadata
              ? (item.materialMetadata as any)
              : null,
          });
        }

        await tx
          .update(jobs)
          .set({ status: "CHANGE_ORDER_PENDING", updatedAt: new Date() })
          .where(eq(jobs.id, jobId));

        const [jobRecord] = await tx
          .select({ serviceRequestId: jobs.serviceRequestId })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (jobRecord) {
          await tx
            .update(serviceRequests)
            .set({ status: "CHANGE_ORDER_PENDING", updatedAt: new Date() })
            .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
        }

        return {
          changeOrderId,
          customerId: row.customer_id,
          totalCents: totals.customerTotalCents,
        };
      });

      await audit(
        actor(request).id,
        "CHANGE_ORDER_SUBMITTED",
        "CHANGE_ORDER",
        result.changeOrderId,
        null,
        { jobId, totalCents: result.totalCents },
      );
      await emit("CHANGE_ORDER", result.changeOrderId, "ChangeOrderSubmitted", {
        jobId,
      });
      await notify(
        result.customerId,
        "CHANGE_ORDER_SUBMITTED",
        "Approval needed",
        "Your professional found additional work that needs your approval.",
        { jobId, changeOrderId: result.changeOrderId },
      );
      return reply.code(201).send({
        changeOrderId: result.changeOrderId,
        totalCents: result.totalCents,
      });
    },
  );

  app.get(
    "/v1/jobs/:id/change-orders",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const result = await db
        .select({
          customer_id: serviceRequests.customerId,
          technician_user_id: technicians.userId,
          contractor_id: jobs.contractorId,
          id: changeOrders.id,
          status: changeOrders.status,
          customer_total_cents: changeOrders.customerTotalCents,
          items: sql<unknown>`COALESCE(json_agg(json_build_object('type',${changeOrderItems.type},'title',${changeOrderItems.title},'quantity',${changeOrderItems.quantity},'unitPriceCents',${changeOrderItems.unitPriceCents},'subtotalCents',${changeOrderItems.subtotalCents})) FILTER(WHERE ${changeOrderItems.id} IS NOT NULL),'[]')`,
        })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(changeOrders, eq(changeOrders.jobId, jobs.id))
        .leftJoin(
          changeOrderItems,
          eq(changeOrderItems.changeOrderId, changeOrders.id),
        )
        .where(eq(jobs.id, jobId))
        .groupBy(
          serviceRequests.customerId,
          technicians.userId,
          jobs.contractorId,
          changeOrders.id,
        );

      const first = result[0];
      if (!first) return [];
      if (
        !isOps(actor(request)) &&
        first.customer_id !== actor(request).id &&
        first.technician_user_id !== actor(request).id &&
        first.contractor_id !== actor(request).contractorId
      )
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted" });
      return result;
    },
  );

  app.post(
    "/v1/change-orders/:id/accept",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const changeOrderId = parse(z.object({ id: uuid }), request.params).id;
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)
        return reply
          .code(400)
          .send({
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "A sufficiently random Idempotency-Key is required",
          });

      const response = await db.transaction(async (tx) => {
        const requestHash = `change-order:${changeOrderId}`;
        const [duplicate] = await tx
          .select({
            actor_id: idempotencyKeys.actorId,
            request_hash: idempotencyKeys.requestHash,
            response: idempotencyKeys.response,
          })
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.key, idempotencyKey))
          .limit(1);

        if (
          duplicate &&
          (duplicate.actor_id !== actor(request).id ||
            duplicate.request_hash !== requestHash)
        )
          throw new Error("IDEMPOTENCY_KEY_REUSED");
        if (duplicate?.response)
          return duplicate.response as {
            changeOrderId: string;
            milestoneId: string;
          };

        await tx.insert(idempotencyKeys).values({
          key: idempotencyKey,
          actorId: actor(request).id,
          requestHash,
        });

        const [row] = await tx
          .select({
            job_id: changeOrders.jobId,
            customer_id: serviceRequests.customerId,
            status: changeOrders.status,
            expires_at: changeOrders.expiresAt,
            customer_total_cents: changeOrders.customerTotalCents,
          })
          .from(changeOrders)
          .innerJoin(jobs, eq(jobs.id, changeOrders.jobId))
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(changeOrders.id, changeOrderId))
          .for("update", { of: changeOrders });

        if (!row) throw new Error("NOT_FOUND");
        if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
        if (
          row.status !== "SUBMITTED" ||
          (row.expires_at && row.expires_at <= new Date())
        )
          throw new Error("CHANGE_ORDER_UNAVAILABLE");

        const [schedule] = await tx
          .select({ id: paymentSchedules.id })
          .from(paymentSchedules)
          .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
          .where(
            and(eq(quotes.jobId, row.job_id), eq(quotes.status, "ACCEPTED")),
          )
          .for("update", { of: paymentSchedules });

        const scheduleId = schedule?.id;
        if (!scheduleId) throw new Error("MISSING_PAYMENT_SCHEDULE");

        const [nextRow] = await tx
          .select({
            sequence: sql<number>`COALESCE(MAX(${paymentMilestones.sequence}),0)+1`,
          })
          .from(paymentMilestones)
          .where(eq(paymentMilestones.scheduleId, scheduleId));

        const sequence = Number(nextRow?.sequence ?? 1);

        const [milestone] = await tx
          .insert(paymentMilestones)
          .values({
            scheduleId,
            sequence,
            triggerName: "CHANGE_ORDER_ACCEPTED",
            amountCents: Number(row.customer_total_cents),
            evidenceRequired: false,
          })
          .returning({ id: paymentMilestones.id });

        const milestoneId = milestone?.id;
        if (!milestoneId) throw new Error("INSERT_FAILED");

        await tx
          .update(changeOrders)
          .set({
            status: "ACCEPTED",
            acceptedAt: new Date(),
            acceptedBy: actor(request).id,
            customerSuppliedAcknowledged: true,
            customerAcknowledgedAt: new Date(),
          })
          .where(eq(changeOrders.id, changeOrderId));

        await tx
          .update(jobs)
          .set({ status: "WORK_IN_PROGRESS", updatedAt: new Date() })
          .where(eq(jobs.id, row.job_id));

        const [jobRecord] = await tx
          .select({ serviceRequestId: jobs.serviceRequestId })
          .from(jobs)
          .where(eq(jobs.id, row.job_id))
          .limit(1);

        if (jobRecord) {
          await tx
            .update(serviceRequests)
            .set({ status: "WORK_IN_PROGRESS", updatedAt: new Date() })
            .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
        }

        const output = { changeOrderId, milestoneId };
        await tx
          .update(idempotencyKeys)
          .set({ response: output })
          .where(eq(idempotencyKeys.key, idempotencyKey));

        return output;
      });

      await audit(
        actor(request).id,
        "CHANGE_ORDER_ACCEPTED",
        "CHANGE_ORDER",
        changeOrderId,
        { status: "SUBMITTED" },
        { status: "ACCEPTED" },
      );
      await emit(
        "CHANGE_ORDER",
        changeOrderId,
        "ChangeOrderApproved",
        response,
      );
      return response;
    },
  );

  app.post(
    "/v1/change-orders/:id/decline",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const changeOrderId = parse(z.object({ id: uuid }), request.params).id;
      const body = request.body
        ? parse(declineChangeOrderSchema, request.body)
        : { reason: "Customer declined change order scope adjustment" };

      const [changed] = await db
        .select({
          job_id: changeOrders.jobId,
          customer_id: serviceRequests.customerId,
          status: changeOrders.status,
        })
        .from(changeOrders)
        .innerJoin(jobs, eq(jobs.id, changeOrders.jobId))
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(
          and(
            eq(changeOrders.id, changeOrderId),
            eq(serviceRequests.customerId, actor(request).id),
            eq(changeOrders.status, "SUBMITTED"),
          ),
        )
        .limit(1);

      if (!changed)
        return reply
          .code(409)
          .send({
            code: "CHANGE_ORDER_UNAVAILABLE",
            message: "Change order cannot be declined",
          });

      const fullReason = body.reason + (body.notes ? `: ${body.notes}` : "");

      await db
        .update(changeOrders)
        .set({
          status: "DECLINED",
          declineReason: fullReason,
          declinedAt: new Date(),
          declinedBy: actor(request).id,
        })
        .where(eq(changeOrders.id, changeOrderId));

      const jobId = changed.job_id;
      await db
        .update(jobs)
        .set({ status: "WORK_IN_PROGRESS" })
        .where(eq(jobs.id, jobId));

      const [jobRecord] = await db
        .select({ serviceRequestId: jobs.serviceRequestId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (jobRecord) {
        await db
          .update(serviceRequests)
          .set({ status: "WORK_IN_PROGRESS" })
          .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
      }

      await audit(
        actor(request).id,
        "CHANGE_ORDER_DECLINED",
        "CHANGE_ORDER",
        changeOrderId,
        { status: "SUBMITTED" },
        { status: "DECLINED" },
      );
      return { changeOrderId, status: "DECLINED" };
    },
  );
};
