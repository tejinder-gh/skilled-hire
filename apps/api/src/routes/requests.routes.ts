import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import type { ServiceRequestStatus } from "@marketplace/contracts";
import { assertTransition } from "@marketplace/core";
import {
  db,
  eq,
  and,
  isNull,
  desc,
  serviceRequests,
  properties,
  verticals,
  serviceCategories,
  issueTypes,
  jobs,
  technicians,
  contractors,
  users,
} from "@marketplace/database";
import { createRequestSchema } from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const requestRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/service-requests",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const body = parse(createRequestSchema, request.body);

      const [validProp] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.id, body.propertyId),
            eq(properties.customerId, actor(request).id),
            isNull(properties.deletedAt),
          ),
        )
        .limit(1);

      const [validIssue] = await db
        .select({ id: issueTypes.id })
        .from(issueTypes)
        .innerJoin(
          serviceCategories,
          eq(serviceCategories.id, issueTypes.categoryId),
        )
        .innerJoin(verticals, eq(verticals.id, serviceCategories.verticalId))
        .where(
          and(
            eq(issueTypes.id, body.issueTypeId),
            eq(issueTypes.active, true),
            eq(serviceCategories.id, body.categoryId),
            eq(serviceCategories.active, true),
            eq(verticals.id, body.verticalId),
            eq(verticals.active, true),
          ),
        )
        .limit(1);

      if (!validProp || !validIssue)
        return reply
          .code(422)
          .send({
            code: "INVALID_REQUEST_CONFIGURATION",
            message: "Property or vertical service selection is invalid",
          });

      const [result] = await db
        .insert(serviceRequests)
        .values({
          customerId: actor(request).id,
          propertyId: body.propertyId,
          verticalId: body.verticalId,
          categoryId: body.categoryId,
          issueTypeId: body.issueTypeId,
          urgency: body.urgency,
          status: "SUBMITTED",
          description: body.description,
          equipment: body.equipment,
          preferredStartsAt: body.preferredStartsAt
            ? new Date(body.preferredStartsAt)
            : null,
          preferredEndsAt: body.preferredEndsAt
            ? new Date(body.preferredEndsAt)
            : null,
          attachmentKeys: body.attachmentKeys,
        })
        .returning({ id: serviceRequests.id });

      const id = result?.id;
      if (!id) throw new Error("INSERT_FAILED");
      await audit(
        actor(request).id,
        "SERVICE_REQUEST_SUBMITTED",
        "SERVICE_REQUEST",
        id,
        { status: "DRAFT" },
        { status: "SUBMITTED" },
      );
      return reply
        .code(201)
        .send({ id, serviceRequestId: id, status: "SUBMITTED" });
    },
  );

  app.get(
    "/v1/service-requests",
    { preHandler: authenticate },
    async (request) => {
      const isOperations = isOps(actor(request));
      if (isOperations) {
        return await db
          .select({
            id: serviceRequests.id,
            urgency: serviceRequests.urgency,
            status: serviceRequests.status,
            description: serviceRequests.description,
            created_at: serviceRequests.createdAt,
            property_label: properties.label,
            city: properties.city,
            vertical_name: verticals.name,
            category_name: serviceCategories.name,
            issue_name: issueTypes.name,
            customer_name: users.displayName,
          })
          .from(serviceRequests)
          .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
          .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
          .innerJoin(
            serviceCategories,
            eq(serviceCategories.id, serviceRequests.categoryId),
          )
          .innerJoin(issueTypes, eq(issueTypes.id, serviceRequests.issueTypeId))
          .innerJoin(users, eq(users.id, serviceRequests.customerId))
          .orderBy(desc(serviceRequests.createdAt))
          .limit(50);
      } else {
        return await db
          .select({
            id: serviceRequests.id,
            urgency: serviceRequests.urgency,
            status: serviceRequests.status,
            description: serviceRequests.description,
            created_at: serviceRequests.createdAt,
            property_label: properties.label,
            city: properties.city,
            vertical_name: verticals.name,
            category_name: serviceCategories.name,
            issue_name: issueTypes.name,
          })
          .from(serviceRequests)
          .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
          .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
          .innerJoin(
            serviceCategories,
            eq(serviceCategories.id, serviceRequests.categoryId),
          )
          .innerJoin(issueTypes, eq(issueTypes.id, serviceRequests.issueTypeId))
          .where(eq(serviceRequests.customerId, actor(request).id))
          .orderBy(desc(serviceRequests.createdAt))
          .limit(50);
      }
    },
  );

  app.get(
    "/v1/service-requests/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const id = parse(z.object({ id: uuid }), request.params).id;
      const [result] = await db
        .select({
          id: serviceRequests.id,
          customer_id: serviceRequests.customerId,
          property_id: serviceRequests.propertyId,
          vertical_id: serviceRequests.verticalId,
          category_id: serviceRequests.categoryId,
          issue_type_id: serviceRequests.issueTypeId,
          urgency: serviceRequests.urgency,
          status: serviceRequests.status,
          description: serviceRequests.description,
          equipment: serviceRequests.equipment,
          preferred_starts_at: serviceRequests.preferredStartsAt,
          preferred_ends_at: serviceRequests.preferredEndsAt,
          attachment_keys: serviceRequests.attachmentKeys,
          created_at: serviceRequests.createdAt,
          updated_at: serviceRequests.updatedAt,
          job_id: jobs.id,
          technician_id: jobs.technicianId,
          contractor_id: jobs.contractorId,
          technician_name: technicians.displayName,
          contractor_name: contractors.name,
        })
        .from(serviceRequests)
        .leftJoin(jobs, eq(jobs.serviceRequestId, serviceRequests.id))
        .leftJoin(technicians, eq(technicians.id, jobs.technicianId))
        .leftJoin(contractors, eq(contractors.id, jobs.contractorId))
        .where(eq(serviceRequests.id, id))
        .limit(1);

      if (!result)
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Service request not found" });
      if (
        !isOps(actor(request)) &&
        result.customer_id !== actor(request).id &&
        result.contractor_id !== actor(request).contractorId
      )
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted" });
      return result;
    },
  );

  app.post(
    "/v1/service-requests/:id/transition",
    { preHandler: authenticate },
    async (request, reply) => {
      const id = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(
        z.object({
          to: z.enum([
            "DRAFT",
            "SUBMITTED",
            "QUALIFICATION_PENDING",
            "QUALIFIED",
            "SCHEDULING",
            "SCHEDULED",
            "CONTRACTOR_SEARCH",
            "ASSIGNED",
            "TECHNICIAN_EN_ROUTE",
            "TECHNICIAN_ARRIVED",
            "ASSESSMENT_IN_PROGRESS",
            "QUOTE_PENDING",
            "QUOTE_SUBMITTED",
            "QUOTE_APPROVED",
            "QUOTE_REJECTED",
            "MATERIALS_PENDING",
            "WORK_SCHEDULED",
            "WORK_IN_PROGRESS",
            "ON_HOLD",
            "CHANGE_ORDER_PENDING",
            "COMPLETION_PENDING",
            "COMPLETED",
            "CANCELLED",
            "DISPUTED",
            "CLOSED",
          ]),
          reason: z.string().max(1000).optional(),
        }),
        request.body,
      );
      const outcome = await db.transaction(async (tx) => {
        const current = await tx
          .select({
            status: serviceRequests.status,
            customerId: serviceRequests.customerId,
            technicianUserId: technicians.userId,
            contractorId: jobs.contractorId,
          })
          .from(serviceRequests)
          .leftJoin(jobs, eq(jobs.serviceRequestId, serviceRequests.id))
          .leftJoin(technicians, eq(technicians.id, jobs.technicianId))
          .where(eq(serviceRequests.id, id))
          .for("update", { of: serviceRequests });

        const record = current[0];
        if (!record) throw new Error("NOT_FOUND");
        const customerCancellation =
          record.customerId === actor(request).id && body.to === "CANCELLED";
        const technicianStates: readonly ServiceRequestStatus[] = [
          "TECHNICIAN_EN_ROUTE",
          "TECHNICIAN_ARRIVED",
          "ASSESSMENT_IN_PROGRESS",
          "QUOTE_PENDING",
          "WORK_IN_PROGRESS",
          "COMPLETION_PENDING",
        ];
        const technicianOwns =
          record.technicianUserId === actor(request).id &&
          technicianStates.includes(body.to);
        const contractorOwns = Boolean(
          actor(request).contractorId &&
          record.contractorId === actor(request).contractorId &&
          technicianStates.includes(body.to),
        );
        if (
          !isOps(actor(request)) &&
          !customerCancellation &&
          !technicianOwns &&
          !contractorOwns
        )
          throw new Error("FORBIDDEN");
        assertTransition(record.status, body.to);

        await tx
          .update(serviceRequests)
          .set({ status: body.to, updatedAt: new Date() })
          .where(eq(serviceRequests.id, id));

        await tx
          .update(jobs)
          .set({ status: body.to, updatedAt: new Date() })
          .where(eq(jobs.serviceRequestId, id));

        return { id, from: record.status, status: body.to };
      });
      await audit(
        actor(request).id,
        "SERVICE_REQUEST_TRANSITIONED",
        "SERVICE_REQUEST",
        id,
        { status: outcome.from },
        { status: outcome.status },
        body.reason ? { reason: body.reason } : {},
      );
      return { id, status: outcome.status };
    },
  );
};
