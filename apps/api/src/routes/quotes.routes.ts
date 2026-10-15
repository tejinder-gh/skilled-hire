import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import type { PaymentRule } from "@marketplace/contracts";
import { ONTARIO_LABOUR_ONLY_DISCLAIMER } from "@marketplace/contracts";
import {
  createPaymentMilestones,
  itemizedQuoteTotals,
} from "@marketplace/core";
import {
  db,
  eq,
  and,
  sql,
  desc,
  jobs,
  technicians,
  quotes,
  quoteItems,
  serviceRequests,
  idempotencyKeys,
  paymentRules,
  paymentSchedules,
  paymentMilestones,
} from "@marketplace/database";
import {
  createQuoteSchema,
  acceptQuoteSchema,
  declineQuoteSchema,
} from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const quotesRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // 1. Submit Itemized Quote (Technician)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/jobs/:id/quotes",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "TECHNICIAN");
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createQuoteSchema, request.body);

      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            id: jobs.id,
            technician_user_id: technicians.userId,
            status: jobs.status,
          })
          .from(jobs)
          .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!row) throw new Error("NOT_FOUND");
        if (row.technician_user_id !== actor(request).id)
          throw new Error("FORBIDDEN");
        if (
          ![
            "QUOTE_PENDING",
            "ASSESSMENT_IN_PROGRESS",
            "QUOTE_REJECTED",
          ].includes(row.status)
        )
          throw new Error("QUOTE_NOT_ALLOWED");

        const discountCents = body.discountCents ?? 0;
        const totals = itemizedQuoteTotals(
          body.items,
          body.platformFeeCents,
          discountCents,
          body.taxCents,
          body.diagnosticFeeCents ?? 0,
        );

        const [versionRow] = await tx
          .select({
            version: sql<number>`COALESCE(MAX(${quotes.version}),0)+1`,
          })
          .from(quotes)
          .where(eq(quotes.jobId, jobId));

        const version = Number(versionRow?.version ?? 1);

        const customerSuppliedPartsCaveat =
          totals.customerSuppliedCount > 0
            ? (body.customerSuppliedPartsCaveat ?? ONTARIO_LABOUR_ONLY_DISCLAIMER)
            : null;

        const [quote] = await tx
          .insert(quotes)
          .values({
            jobId,
            version,
            status: "SUBMITTED",
            contractorSubtotalCents: totals.contractorSubtotalCents,
            diagnosticFeeCents: totals.diagnosticFeeCents,
            laborSubtotalCents: totals.laborSubtotalCents,
            materialsSubtotalCents: totals.materialsSubtotalCents,
            disposalSubtotalCents: totals.disposalSubtotalCents,
            permitsSubtotalCents: totals.permitsSubtotalCents,
            customerSuppliedPartsCaveat,
            customerSuppliedAcknowledged: false,
            platformFeeCents: body.platformFeeCents,
            discountCents,
            taxCents: body.taxCents,
            customerTotalCents: totals.customerTotalCents,
            notes: body.notes ?? null,
            expiresAt: new Date(body.expiresAt),
          })
          .returning({ id: quotes.id });

        const quoteId = quote?.id;
        if (!quoteId) throw new Error("INSERT_FAILED");

        for (const [index, item] of body.items.entries()) {
          const itemSubtotal = totals.itemSubtotals[index];
          if (itemSubtotal === undefined)
            throw new Error("QUOTE_CALCULATION_FAILED");
          await tx.insert(quoteItems).values({
            quoteId,
            type: item.type,
            title: item.title,
            description: item.description ?? null,
            quantity: item.quantity,
            unitPriceCents: item.isCustomerSupplied ? 0 : item.unitPriceCents,
            subtotalCents: itemSubtotal,
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
          .set({ status: "QUOTE_SUBMITTED", updatedAt: new Date() })
          .where(eq(jobs.id, jobId));

        const [jobRecord] = await tx
          .select({ serviceRequestId: jobs.serviceRequestId })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (jobRecord) {
          await tx
            .update(serviceRequests)
            .set({ status: "QUOTE_SUBMITTED", updatedAt: new Date() })
            .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
        }

        return {
          quoteId,
          version,
          diagnosticFeeCents: totals.diagnosticFeeCents,
          laborSubtotalCents: totals.laborSubtotalCents,
          materialsSubtotalCents: totals.materialsSubtotalCents,
          disposalSubtotalCents: totals.disposalSubtotalCents,
          permitsSubtotalCents: totals.permitsSubtotalCents,
          totalCents: totals.customerTotalCents,
        };
      });

      await audit(
        actor(request).id,
        "QUOTE_SUBMITTED",
        "QUOTE",
        result.quoteId,
        null,
        result,
      );
      return reply.code(201).send(result);
    },
  );

  // ---------------------------------------------------------------------------
  // 2. List Quotes for a Job (Customer / Technician / Ops)
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/jobs/:id/quotes",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const rows = await db
        .select({
          customer_id: serviceRequests.customerId,
          technician_user_id: technicians.userId,
          quote_id: quotes.id,
          status: quotes.status,
          version: quotes.version,
          diagnostic_fee_cents: quotes.diagnosticFeeCents,
          labor_subtotal_cents: quotes.laborSubtotalCents,
          materials_subtotal_cents: quotes.materialsSubtotalCents,
          disposal_subtotal_cents: quotes.disposalSubtotalCents,
          permits_subtotal_cents: quotes.permitsSubtotalCents,
          customer_supplied_parts_caveat: quotes.customerSuppliedPartsCaveat,
          customer_supplied_acknowledged: quotes.customerSuppliedAcknowledged,
          contractor_subtotal_cents: quotes.contractorSubtotalCents,
          platform_fee_cents: quotes.platformFeeCents,
          discount_cents: quotes.discountCents,
          tax_cents: quotes.taxCents,
          customer_total_cents: quotes.customerTotalCents,
          currency: quotes.currency,
          notes: quotes.notes,
          expires_at: quotes.expiresAt,
          accepted_at: quotes.acceptedAt,
          accepted_by: quotes.acceptedBy,
          decline_reason: quotes.declineReason,
          declined_at: quotes.declinedAt,
          declined_by: quotes.declinedBy,
          created_at: quotes.createdAt,
          items: sql<unknown>`COALESCE(json_agg(json_build_object(
            'id', ${quoteItems.id},
            'type', ${quoteItems.type},
            'title', ${quoteItems.title},
            'description', ${quoteItems.description},
            'quantity', ${quoteItems.quantity},
            'unitPriceCents', ${quoteItems.unitPriceCents},
            'subtotalCents', ${quoteItems.subtotalCents},
            'isCustomerSupplied', ${quoteItems.isCustomerSupplied},
            'warrantyCaveat', ${quoteItems.warrantyCaveat},
            'materialMetadata', ${quoteItems.materialMetadata}
          )) FILTER(WHERE ${quoteItems.id} IS NOT NULL),'[]')`,
        })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(quotes, eq(quotes.jobId, jobs.id))
        .leftJoin(quoteItems, eq(quoteItems.quoteId, quotes.id))
        .where(eq(jobs.id, jobId))
        .groupBy(serviceRequests.customerId, technicians.userId, quotes.id)
        .orderBy(desc(quotes.version));

      if (rows.length === 0)
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "No quotes found" });
      const owns =
        rows[0]?.customer_id === actor(request).id ||
        rows[0]?.technician_user_id === actor(request).id ||
        isOps(actor(request));
      if (!owns)
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted" });
      return rows;
    },
  );

  // ---------------------------------------------------------------------------
  // 3. Get Single Quote by ID
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/quotes/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const quoteId = parse(z.object({ id: uuid }), request.params).id;
      const [quote] = await db
        .select({
          id: quotes.id,
          jobId: quotes.jobId,
          version: quotes.version,
          status: quotes.status,
          diagnosticFeeCents: quotes.diagnosticFeeCents,
          laborSubtotalCents: quotes.laborSubtotalCents,
          materialsSubtotalCents: quotes.materialsSubtotalCents,
          disposalSubtotalCents: quotes.disposalSubtotalCents,
          permitsSubtotalCents: quotes.permitsSubtotalCents,
          customerSuppliedPartsCaveat: quotes.customerSuppliedPartsCaveat,
          customerSuppliedAcknowledged: quotes.customerSuppliedAcknowledged,
          contractorSubtotalCents: quotes.contractorSubtotalCents,
          platformFeeCents: quotes.platformFeeCents,
          discountCents: quotes.discountCents,
          taxCents: quotes.taxCents,
          customerTotalCents: quotes.customerTotalCents,
          currency: quotes.currency,
          notes: quotes.notes,
          expiresAt: quotes.expiresAt,
          acceptedAt: quotes.acceptedAt,
          acceptedBy: quotes.acceptedBy,
          declineReason: quotes.declineReason,
          declinedAt: quotes.declinedAt,
          declinedBy: quotes.declinedBy,
          createdAt: quotes.createdAt,
          customerId: serviceRequests.customerId,
          technicianUserId: technicians.userId,
        })
        .from(quotes)
        .innerJoin(jobs, eq(jobs.id, quotes.jobId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .where(eq(quotes.id, quoteId))
        .limit(1);

      if (!quote) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Quote not found" });
      }

      const user = actor(request);
      if (
        quote.customerId !== user.id &&
        quote.technicianUserId !== user.id &&
        !isOps(user)
      ) {
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted to view quote" });
      }

      const items = await db
        .select({
          id: quoteItems.id,
          type: quoteItems.type,
          title: quoteItems.title,
          description: quoteItems.description,
          quantity: quoteItems.quantity,
          unitPriceCents: quoteItems.unitPriceCents,
          subtotalCents: quoteItems.subtotalCents,
          isCustomerSupplied: quoteItems.isCustomerSupplied,
          warrantyCaveat: quoteItems.warrantyCaveat,
          materialMetadata: quoteItems.materialMetadata,
        })
        .from(quoteItems)
        .where(eq(quoteItems.quoteId, quoteId));

      return {
        ...quote,
        items,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 4. Accept Quote & Schedule Payment Milestones (Customer)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/quotes/:id/accept",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const quoteId = parse(z.object({ id: uuid }), request.params).id;
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)
        return reply
          .code(400)
          .send({
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "A sufficiently random Idempotency-Key is required",
          });

      const body = request.body
        ? parse(acceptQuoteSchema, request.body)
        : { customerSuppliedAcknowledged: false };

      const outcome = await db.transaction(async (tx) => {
        const requestHash = `quote:${quoteId}`;
        const [existing] = await tx
          .select({
            actor_id: idempotencyKeys.actorId,
            request_hash: idempotencyKeys.requestHash,
            response: idempotencyKeys.response,
          })
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.key, idempotencyKey))
          .limit(1);

        if (
          existing &&
          (existing.actor_id !== actor(request).id ||
            existing.request_hash !== requestHash)
        )
          throw new Error("IDEMPOTENCY_KEY_REUSED");
        if (existing?.response)
          return existing.response as {
            quoteId: string;
            scheduleId: string;
            milestones: unknown[];
          };

        await tx.insert(idempotencyKeys).values({
          key: idempotencyKey,
          actorId: actor(request).id,
          requestHash,
        });

        const [row] = await tx
          .select({
            job_id: quotes.jobId,
            customer_id: serviceRequests.customerId,
            vertical_id: serviceRequests.verticalId,
            status: quotes.status,
            expires_at: quotes.expiresAt,
            customer_total_cents: quotes.customerTotalCents,
            customer_supplied_parts_caveat: quotes.customerSuppliedPartsCaveat,
            currency: quotes.currency,
          })
          .from(quotes)
          .innerJoin(jobs, eq(jobs.id, quotes.jobId))
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(quotes.id, quoteId))
          .for("update", { of: quotes });

        if (!row) throw new Error("NOT_FOUND");
        if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
        if (
          row.status !== "SUBMITTED" ||
          (row.expires_at && row.expires_at <= new Date())
        ) {
          throw new Error("QUOTE_UNAVAILABLE");
        }

        // Guard: customer supplied parts acknowledgment under Ontario CPA
        if (row.customer_supplied_parts_caveat && !body.customerSuppliedAcknowledged) {
          throw new Error("CUSTOMER_PARTS_ACKNOWLEDGMENT_REQUIRED");
        }

        const rules = await tx
          .select({
            id: paymentRules.id,
            min_amount_cents: paymentRules.minAmountCents,
            max_amount_cents: paymentRules.maxAmountCents,
            rule: paymentRules.rule,
          })
          .from(paymentRules)
          .where(
            and(
              eq(paymentRules.verticalId, row.vertical_id),
              eq(paymentRules.active, true),
            ),
          );

        const paymentRulesList: PaymentRule[] = rules.map((rule) => {
          const parsed = z
            .object({
              milestones: z.array(
                z.object({
                  trigger: z.string(),
                  percentageBps: z.number().int().min(0).max(10000),
                  evidenceRequired: z.boolean(),
                }),
              ),
            })
            .parse(rule.rule);
          return {
            id: rule.id,
            verticalId: row.vertical_id,
            minAmountCents: Number(rule.min_amount_cents),
            maxAmountCents: rule.max_amount_cents
              ? Number(rule.max_amount_cents)
              : null,
            milestones: parsed.milestones,
          };
        });

        const milestones = createPaymentMilestones(
          paymentRulesList,
          row.vertical_id,
          Number(row.customer_total_cents),
        );

        const [schedule] = await tx
          .insert(paymentSchedules)
          .values({
            quoteId,
            totalCents: Number(row.customer_total_cents),
            currency: row.currency,
          })
          .returning({ id: paymentSchedules.id });

        const scheduleId = schedule?.id;
        if (!scheduleId) throw new Error("INSERT_FAILED");

        for (const milestone of milestones) {
          await tx.insert(paymentMilestones).values({
            scheduleId,
            sequence: milestone.sequence,
            triggerName: milestone.trigger,
            amountCents: milestone.amountCents,
            evidenceRequired: milestone.evidenceRequired,
          });
        }

        await tx
          .update(quotes)
          .set({
            status: "ACCEPTED",
            acceptedAt: new Date(),
            acceptedBy: actor(request).id,
            customerSuppliedAcknowledged: Boolean(row.customer_supplied_parts_caveat),
          })
          .where(eq(quotes.id, quoteId));

        // Supersede other pending submitted quotes for this job
        await tx
          .update(quotes)
          .set({ status: "SUPERSEDED" })
          .where(
            and(
              eq(quotes.jobId, row.job_id),
              sql`${quotes.id} <> ${quoteId}`,
              eq(quotes.status, "SUBMITTED"),
            ),
          );

        await tx
          .update(jobs)
          .set({ status: "WORK_SCHEDULED", updatedAt: new Date() })
          .where(eq(jobs.id, row.job_id));

        const [jobRecord] = await tx
          .select({ serviceRequestId: jobs.serviceRequestId })
          .from(jobs)
          .where(eq(jobs.id, row.job_id))
          .limit(1);

        if (jobRecord) {
          await tx
            .update(serviceRequests)
            .set({ status: "WORK_SCHEDULED", updatedAt: new Date() })
            .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
        }

        const response = { quoteId, scheduleId, milestones };
        await tx
          .update(idempotencyKeys)
          .set({ response })
          .where(eq(idempotencyKeys.key, idempotencyKey));

        return response;
      });

      await audit(
        actor(request).id,
        "QUOTE_ACCEPTED",
        "QUOTE",
        quoteId,
        null,
        outcome,
      );
      return reply.code(200).send(outcome);
    },
  );

  // ---------------------------------------------------------------------------
  // 5. Decline Quote (Customer)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/quotes/:id/decline",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const quoteId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(declineQuoteSchema, request.body);

      const outcome = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            job_id: quotes.jobId,
            customer_id: serviceRequests.customerId,
            status: quotes.status,
            expires_at: quotes.expiresAt,
          })
          .from(quotes)
          .innerJoin(jobs, eq(jobs.id, quotes.jobId))
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(quotes.id, quoteId))
          .for("update", { of: quotes });

        if (!row) throw new Error("NOT_FOUND");
        if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
        if (row.status !== "SUBMITTED") {
          throw new Error("QUOTE_NOT_DECLINABLE");
        }

        const fullReason = body.reason + (body.notes ? `: ${body.notes}` : "");

        await tx
          .update(quotes)
          .set({
            status: "REJECTED",
            declineReason: fullReason,
            declinedAt: new Date(),
            declinedBy: actor(request).id,
          })
          .where(eq(quotes.id, quoteId));

        await tx
          .update(jobs)
          .set({ status: "QUOTE_REJECTED", updatedAt: new Date() })
          .where(eq(jobs.id, row.job_id));

        const [jobRecord] = await tx
          .select({ serviceRequestId: jobs.serviceRequestId })
          .from(jobs)
          .where(eq(jobs.id, row.job_id))
          .limit(1);

        if (jobRecord) {
          await tx
            .update(serviceRequests)
            .set({ status: "QUOTE_REJECTED", updatedAt: new Date() })
            .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
        }

        return { quoteId, status: "REJECTED", reason: fullReason };
      });

      await audit(
        actor(request).id,
        "QUOTE_DECLINED",
        "QUOTE",
        quoteId,
        null,
        outcome,
      );

      return reply.code(200).send(outcome);
    },
  );
};
