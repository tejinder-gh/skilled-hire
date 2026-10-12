import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import { assertTransition } from "@marketplace/core";
import {
  db,
  eq,
  and,
  desc,
  sql,
  jobs,
  contractors,
  technicians,
  serviceRequests,
  properties,
  serviceRecords,
  customerContractorRelationships,
  reviews,
  invoices,
  quotes,
  changeOrders,
  paymentMilestones,
  paymentSchedules,
  payouts,
} from "@marketplace/database";
import { reviewSchema } from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const jobsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/jobs", { preHandler: authenticate }, async (request) => {
    const currentActor = actor(request);
    let jobWhere: any = undefined;
    if (isOps(currentActor)) {
      jobWhere = undefined;
    } else if (currentActor.contractorId) {
      jobWhere = eq(jobs.contractorId, currentActor.contractorId);
    } else {
      jobWhere = eq(technicians.userId, currentActor.id);
    }

    const queryBuilder = db
      .select({
        id: jobs.id,
        status: jobs.status,
        service_request_id: jobs.serviceRequestId,
        contractor_id: jobs.contractorId,
        technician_id: jobs.technicianId,
        created_at: jobs.createdAt,
        updated_at: jobs.updatedAt,
        contractor_name: contractors.name,
        technician_name: technicians.displayName,
        urgency: serviceRequests.urgency,
        request_description: serviceRequests.description,
        address_line1: properties.addressLine1,
        city: properties.city,
      })
      .from(jobs)
      .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
      .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
      .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
      .innerJoin(properties, eq(properties.id, serviceRequests.propertyId));

    if (jobWhere) {
      return await queryBuilder
        .where(jobWhere)
        .orderBy(desc(jobs.createdAt))
        .limit(50);
    }
    return await queryBuilder.orderBy(desc(jobs.createdAt)).limit(50);
  });

  app.post(
    "/v1/jobs/:id/complete",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "TECHNICIAN",
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(
        z.object({
          summary: z.string().min(5).max(5000),
          equipment: z.record(z.string(), z.string()).default({}),
        }),
        request.body,
      );
      const complete = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            technician_user_id: technicians.userId,
            status: jobs.status,
            property_id: serviceRequests.propertyId,
            vertical_id: serviceRequests.verticalId,
            customer_id: serviceRequests.customerId,
            contractor_id: jobs.contractorId,
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
        if (
          !isOps(actor(request)) &&
          row.technician_user_id !== actor(request).id
        )
          throw new Error("FORBIDDEN");

        if (row.status === "WORK_IN_PROGRESS") {
          assertTransition(row.status, "COMPLETION_PENDING");
          await tx
            .update(jobs)
            .set({ status: "COMPLETION_PENDING" })
            .where(eq(jobs.id, jobId));
        }

        const [final] = await tx
          .select({ status: jobs.status })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .for("update");

        const status = final?.status;
        if (!status) throw new Error("NOT_FOUND");
        assertTransition(status, "COMPLETED");

        await tx
          .update(jobs)
          .set({
            status: "COMPLETED",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId));

        const [jobRecord] = await tx
          .select({ serviceRequestId: jobs.serviceRequestId })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (jobRecord) {
          await tx
            .update(serviceRequests)
            .set({ status: "COMPLETED", updatedAt: new Date() })
            .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
        }

        const [record] = await tx
          .insert(serviceRecords)
          .values({
            propertyId: row.property_id,
            jobId,
            verticalId: row.vertical_id,
            summary: body.summary,
            equipment: body.equipment,
            completedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: serviceRecords.jobId,
            set: { summary: body.summary },
          })
          .returning({ id: serviceRecords.id });

        await tx
          .insert(customerContractorRelationships)
          .values({
            customerId: row.customer_id,
            contractorId: row.contractor_id,
            acquisitionSource: "PLATFORM_INTRODUCTION",
            firstPlatformJobId: jobId,
            lastPlatformJobId: jobId,
            repeatJobCount: 0,
          })
          .onConflictDoUpdate({
            target: [
              customerContractorRelationships.customerId,
              customerContractorRelationships.contractorId,
            ],
            set: {
              lastPlatformJobId: jobId,
              repeatJobCount: sql`${customerContractorRelationships.repeatJobCount} + 1`,
              updatedAt: new Date(),
            },
          });

        return { serviceRecordId: record?.id, status: "COMPLETED" as const };
      });
      await audit(
        actor(request).id,
        "JOB_COMPLETED",
        "JOB",
        jobId,
        null,
        complete,
      );
      return complete;
    },
  );

  app.post(
    "/v1/jobs/:id/reviews",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(reviewSchema, request.body);

      const [verified] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(
          and(
            eq(jobs.id, jobId),
            eq(serviceRequests.customerId, actor(request).id),
            sql`${jobs.status} IN ('COMPLETED', 'CLOSED')`,
          ),
        )
        .limit(1);

      if (!verified)
        return reply
          .code(422)
          .send({
            code: "REVIEW_NOT_ELIGIBLE",
            message: "Only completed jobs can be reviewed",
          });

      const [result] = await db
        .insert(reviews)
        .values({
          jobId,
          customerId: actor(request).id,
          overall: body.overall,
          quality: body.quality ?? null,
          professionalism: body.professionalism ?? null,
          timeliness: body.timeliness ?? null,
          communication: body.communication ?? null,
          comment: body.comment ?? null,
        })
        .onConflictDoNothing({ target: reviews.jobId })
        .returning({ id: reviews.id });

      if (!result)
        return reply
          .code(409)
          .send({
            code: "DUPLICATE_REVIEW",
            message: "A review already exists for this job",
          });

      await audit(actor(request).id, "REVIEW_SUBMITTED", "JOB", jobId, null, {
        reviewId: result.id,
      });
      return reply.code(201).send({ reviewId: result.id });
    },
  );

  app.post(
    "/v1/jobs/:id/invoice",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            customer_id: serviceRequests.customerId,
            contractor_id: jobs.contractorId,
            status: jobs.status,
          })
          .from(jobs)
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!row) throw new Error("NOT_FOUND");
        if (
          !isOps(actor(request)) &&
          row.customer_id !== actor(request).id &&
          row.contractor_id !== actor(request).contractorId
        )
          throw new Error("FORBIDDEN");
        if (!["COMPLETED", "CLOSED"].includes(row.status))
          throw new Error("JOB_NOT_COMPLETE");

        const [existing] = await tx
          .select({
            id: invoices.id,
            invoice_number: invoices.invoiceNumber,
            total_cents: invoices.totalCents,
          })
          .from(invoices)
          .where(eq(invoices.jobId, jobId))
          .limit(1);

        if (existing) return existing;

        const [quote] = await tx
          .select()
          .from(quotes)
          .where(and(eq(quotes.jobId, jobId), eq(quotes.status, "ACCEPTED")))
          .limit(1);

        if (!quote) throw new Error("FINAL_PAYMENT_REQUIRED");

        const [coSum] = await tx
          .select({
            custTotal: sql<number>`COALESCE(sum(${changeOrders.customerTotalCents}),0)`,
            subtotal: sql<number>`COALESCE(sum(${changeOrders.contractorSubtotalCents}),0)`,
            fee: sql<number>`COALESCE(sum(${changeOrders.platformFeeCents}),0)`,
            tax: sql<number>`COALESCE(sum(${changeOrders.taxCents}),0)`,
          })
          .from(changeOrders)
          .where(
            and(
              eq(changeOrders.jobId, jobId),
              eq(changeOrders.status, "ACCEPTED"),
            ),
          );

        const [paidSum] = await tx
          .select({
            paid: sql<number>`COALESCE(sum(${paymentMilestones.amountCents}),0)`,
          })
          .from(paymentMilestones)
          .innerJoin(
            paymentSchedules,
            eq(paymentSchedules.id, paymentMilestones.scheduleId),
          )
          .where(
            and(
              eq(paymentSchedules.quoteId, quote.id),
              eq(paymentMilestones.status, "PAID"),
            ),
          );

        const expectedCents =
          Number(quote.customerTotalCents) + Number(coSum?.custTotal ?? 0);
        const paidCents = Number(paidSum?.paid ?? 0);
        const subtotalCents =
          Number(quote.contractorSubtotalCents) + Number(coSum?.subtotal ?? 0);
        const feeCents =
          Number(quote.platformFeeCents) + Number(coSum?.fee ?? 0);
        const taxCents = Number(quote.taxCents) + Number(coSum?.tax ?? 0);

        if (expectedCents !== paidCents)
          throw new Error("FINAL_PAYMENT_REQUIRED");

        const invoiceNumber = `INV-${new Date().getUTCFullYear()}-${jobId.slice(0, 8).toUpperCase()}`;

        const [created] = await tx
          .insert(invoices)
          .values({
            jobId,
            invoiceNumber,
            subtotalCents,
            platformFeeCents: feeCents,
            taxCents,
            totalCents: expectedCents,
            currency: quote.currency,
          })
          .returning({
            id: invoices.id,
            invoice_number: invoices.invoiceNumber,
            total_cents: invoices.totalCents,
          });

        await tx
          .insert(payouts)
          .values({
            contractorId: row.contractor_id,
            jobId,
            amountCents: subtotalCents,
            currency: quote.currency,
            status: "HELD",
            eligibleAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          })
          .onConflictDoNothing({
            target: [payouts.contractorId, payouts.jobId],
          });

        return created;
      });

      if (!result) throw new Error("INVOICE_FAILED");
      await audit(
        actor(request).id,
        "INVOICE_ISSUED",
        "INVOICE",
        result.id,
        null,
        result,
      );
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/v1/service-records/:id/rebook",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const recordId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(
        z.object({
          preferredStartsAt: z.string().datetime(),
          preferredEndsAt: z.string().datetime(),
        }),
        request.body,
      );
      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            property_id: serviceRequests.propertyId,
            vertical_id: serviceRequests.verticalId,
            category_id: serviceRequests.categoryId,
            issue_type_id: serviceRequests.issueTypeId,
            customer_id: serviceRequests.customerId,
            description: serviceRequests.description,
          })
          .from(serviceRecords)
          .innerJoin(jobs, eq(jobs.id, serviceRecords.jobId))
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .where(eq(serviceRecords.id, recordId))
          .for("update", { of: serviceRecords });

        if (!row) throw new Error("NOT_FOUND");
        if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");

        const [created] = await tx
          .insert(serviceRequests)
          .values({
            customerId: row.customer_id,
            propertyId: row.property_id,
            verticalId: row.vertical_id,
            categoryId: row.category_id,
            issueTypeId: row.issue_type_id,
            urgency: "STANDARD",
            status: "SUBMITTED",
            description: `Rebook: ${row.description}`,
            preferredStartsAt: new Date(body.preferredStartsAt),
            preferredEndsAt: new Date(body.preferredEndsAt),
          })
          .returning({ id: serviceRequests.id });

        return created;
      });

      if (!result) throw new Error("INSERT_FAILED");
      await audit(
        actor(request).id,
        "SERVICE_REBOOKED",
        "SERVICE_RECORD",
        recordId,
        null,
        { newServiceRequestId: result.id },
      );
      return reply.code(201).send({ serviceRequestId: result.id });
    },
  );
};
