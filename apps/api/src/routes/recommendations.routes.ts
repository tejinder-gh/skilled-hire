import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole, hasRole } from "@marketplace/auth";
import {
  db,
  eq,
  and,
  desc,
  asc,
  sql,
  jobs,
  technicians,
  contractors,
  serviceRequests,
  properties,
  users,
  idempotencyKeys,
  serviceRecommendations,
  serviceRecommendationResponses,
} from "@marketplace/database";
import {
  createRecommendationSchema,
  respondRecommendationSchema,
  convertRecommendationSchema,
} from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit, emit, notify } from "../common/events.js";

export const recommendationsRoutes: FastifyPluginAsync = async (app) => {
  // 1. Propose a new recommendation discovered during a job (Technician / Contractor)
  app.post(
    "/v1/jobs/:id/recommendations",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const isTech = hasRole(currentActor, "TECHNICIAN");
      const isContractor =
        hasRole(currentActor, "CONTRACTOR_OWNER") ||
        hasRole(currentActor, "CONTRACTOR_MANAGER");
      if (!isTech && !isContractor && !isOps(currentActor)) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "Technician or contractor clearance required",
        });
      }

      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createRecommendationSchema, request.body);

      const result = await db.transaction(async (tx) => {
        const [jobRow] = await tx
          .select({
            id: jobs.id,
            contractorId: jobs.contractorId,
            technicianId: jobs.technicianId,
            serviceRequestId: jobs.serviceRequestId,
            status: jobs.status,
            customerId: serviceRequests.customerId,
            propertyId: serviceRequests.propertyId,
            verticalId: serviceRequests.verticalId,
            categoryId: serviceRequests.categoryId,
            techUserId: technicians.userId,
            contractorOwnerId: contractors.ownerUserId,
          })
          .from(jobs)
          .innerJoin(
            serviceRequests,
            eq(serviceRequests.id, jobs.serviceRequestId),
          )
          .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
          .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!jobRow) {
          throw new Error("JOB_NOT_FOUND");
        }

        // Authorization check: Must be assigned tech, contractor owner, or ops
        if (
          !isOps(currentActor) &&
          jobRow.techUserId !== currentActor.id &&
          jobRow.contractorOwnerId !== currentActor.id &&
          currentActor.contractorId !== jobRow.contractorId
        ) {
          throw new Error("FORBIDDEN");
        }

        const [created] = await tx
          .insert(serviceRecommendations)
          .values({
            jobId: jobRow.id,
            serviceRequestId: jobRow.serviceRequestId,
            propertyId: jobRow.propertyId,
            customerId: jobRow.customerId,
            contractorId: jobRow.contractorId,
            technicianId: jobRow.technicianId,
            title: body.title,
            description: body.description,
            verticalId: body.verticalId ?? jobRow.verticalId,
            categoryId: body.categoryId ?? jobRow.categoryId,
            urgency: body.urgency,
            status: "PROPOSED",
            estimatedCostCents: body.estimatedCostCents,
            currency: "CAD",
            evidencePhotos: body.evidencePhotos ?? [],
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          })
          .returning();

        if (!created) {
          throw new Error("FAILED_TO_CREATE_RECOMMENDATION");
        }

        // Log initial submission in response history
        await tx.insert(serviceRecommendationResponses).values({
          recommendationId: created.id,
          action: "PROPOSED",
          actorId: currentActor.id,
          actorRole: isTech ? "TECHNICIAN" : isContractor ? "CONTRACTOR_OWNER" : "OPERATIONS_AGENT",
          notes: body.description,
          metadata: {
            title: body.title,
            urgency: body.urgency,
            estimatedCostCents: body.estimatedCostCents,
            evidencePhotoCount: (body.evidencePhotos ?? []).length,
          },
        });

        return {
          recommendation: created,
          customerId: jobRow.customerId,
          contractorId: jobRow.contractorId,
        };
      });

      await audit(
        currentActor.id,
        "SERVICE_RECOMMENDATION_PROPOSED",
        "SERVICE_RECOMMENDATION",
        result.recommendation.id,
        null,
        {
          jobId,
          title: body.title,
          urgency: body.urgency,
          estimatedCostCents: body.estimatedCostCents,
        },
      );

      await emit(
        "SERVICE_RECOMMENDATION",
        result.recommendation.id,
        "RecommendationProposed",
        {
          jobId,
          recommendationId: result.recommendation.id,
          urgency: body.urgency,
          estimatedCostCents: body.estimatedCostCents,
        },
      );

      await notify(
        result.customerId,
        "SERVICE_RECOMMENDED",
        "New Recommended Service Discovered",
        `Your technician recommended: "${body.title}". View details and accept or decline.`,
        {
          jobId,
          recommendationId: result.recommendation.id,
          urgency: body.urgency,
          estimatedCostCents: body.estimatedCostCents,
        },
      );

      return reply.code(201).send(result.recommendation);
    },
  );

  // 2. List recommendations for a job
  app.get(
    "/v1/jobs/:id/recommendations",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;

      const [jobRow] = await db
        .select({
          id: jobs.id,
          customerId: serviceRequests.customerId,
          contractorId: jobs.contractorId,
          techUserId: technicians.userId,
        })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobRow) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Job not found" });
      }

      if (
        !isOps(currentActor) &&
        jobRow.customerId !== currentActor.id &&
        jobRow.techUserId !== currentActor.id &&
        currentActor.contractorId !== jobRow.contractorId
      ) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "Not permitted" });
      }

      const rows = await db
        .select({
          rec: serviceRecommendations,
          techName: users.displayName,
          contractorName: contractors.name,
        })
        .from(serviceRecommendations)
        .innerJoin(technicians, eq(technicians.id, serviceRecommendations.technicianId))
        .innerJoin(users, eq(users.id, technicians.userId))
        .innerJoin(contractors, eq(contractors.id, serviceRecommendations.contractorId))
        .where(eq(serviceRecommendations.jobId, jobId))
        .orderBy(desc(serviceRecommendations.createdAt));

      const dtos = rows.map((r) => ({
        ...r.rec,
        technicianName: r.techName,
        contractorName: r.contractorName,
      }));

      return dtos;
    },
  );

  // 3. List recommendations for a property (Property Passport)
  app.get(
    "/v1/properties/:id/recommendations",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;

      const [propRow] = await db
        .select({
          id: properties.id,
          customerId: properties.customerId,
          addressLine1: properties.addressLine1,
          city: properties.city,
        })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (!propRow) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Property not found" });
      }

      if (!isOps(currentActor) && propRow.customerId !== currentActor.id) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "Not permitted" });
      }

      const rows = await db
        .select({
          rec: serviceRecommendations,
          techName: users.displayName,
          contractorName: contractors.name,
        })
        .from(serviceRecommendations)
        .innerJoin(technicians, eq(technicians.id, serviceRecommendations.technicianId))
        .innerJoin(users, eq(users.id, technicians.userId))
        .innerJoin(contractors, eq(contractors.id, serviceRecommendations.contractorId))
        .where(eq(serviceRecommendations.propertyId, propertyId))
        .orderBy(desc(serviceRecommendations.createdAt));

      return rows.map((r) => ({
        ...r.rec,
        technicianName: r.techName,
        contractorName: r.contractorName,
        propertyAddress: `${propRow.addressLine1}, ${propRow.city}`,
      }));
    },
  );

  // 4. Get specific recommendation with response audit trail
  app.get(
    "/v1/recommendations/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const recommendationId = parse(z.object({ id: uuid }), request.params).id;

      const [row] = await db
        .select({
          rec: serviceRecommendations,
          techName: users.displayName,
          contractorName: contractors.name,
          techUserId: technicians.userId,
        })
        .from(serviceRecommendations)
        .innerJoin(technicians, eq(technicians.id, serviceRecommendations.technicianId))
        .innerJoin(users, eq(users.id, technicians.userId))
        .innerJoin(contractors, eq(contractors.id, serviceRecommendations.contractorId))
        .where(eq(serviceRecommendations.id, recommendationId))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Recommendation not found" });
      }

      if (
        !isOps(currentActor) &&
        row.rec.customerId !== currentActor.id &&
        row.techUserId !== currentActor.id &&
        currentActor.contractorId !== row.rec.contractorId
      ) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "Not permitted" });
      }

      const responses = await db
        .select()
        .from(serviceRecommendationResponses)
        .where(eq(serviceRecommendationResponses.recommendationId, recommendationId))
        .orderBy(asc(serviceRecommendationResponses.createdAt));

      return {
        ...row.rec,
        technicianName: row.techName,
        contractorName: row.contractorName,
        responses: responses.map((res) => ({
          ...res,
          metadata: (res.metadata as Record<string, unknown>) ?? {},
        })),
      };
    },
  );

  // 5. Homeowner responds to recommendation (Accept, Decline, or Defer)
  app.post(
    "/v1/recommendations/:id/respond",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "CUSTOMER");

      const recommendationId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(respondRecommendationSchema, request.body);

      const rawKey = request.headers["idempotency-key"];
      const idempotencyKey = typeof rawKey === "string" ? rawKey : undefined;

      if (idempotencyKey !== undefined && idempotencyKey.length < 16) {
        return reply.code(400).send({
          code: "INVALID_IDEMPOTENCY_KEY",
          message: "Idempotency key must be at least 16 characters",
        });
      }

      const result = await db.transaction(async (tx) => {
        const requestHash = `recommendation-respond:${recommendationId}:${body.decision}`;
        if (idempotencyKey) {
          const [duplicate] = await tx
            .select({
              actorId: idempotencyKeys.actorId,
              requestHash: idempotencyKeys.requestHash,
              response: idempotencyKeys.response,
            })
            .from(idempotencyKeys)
            .where(eq(idempotencyKeys.key, idempotencyKey))
            .limit(1);

          if (
            duplicate &&
            (duplicate.actorId !== currentActor.id || duplicate.requestHash !== requestHash)
          ) {
            throw new Error("IDEMPOTENCY_KEY_REUSED");
          }
          if (duplicate?.response) {
            return duplicate.response as {
              recommendationId: string;
              status: string;
              convertedServiceRequestId?: string | null;
              contractorId: string;
              technicianId: string;
              title: string;
            };
          }

          await tx.insert(idempotencyKeys).values({
            key: idempotencyKey,
            actorId: currentActor.id,
            requestHash,
          });
        }

        const [recRow] = await tx
          .select()
          .from(serviceRecommendations)
          .where(eq(serviceRecommendations.id, recommendationId))
          .for("update", { of: serviceRecommendations });

        if (!recRow) {
          throw new Error("RECOMMENDATION_NOT_FOUND");
        }

        if (recRow.customerId !== currentActor.id) {
          throw new Error("FORBIDDEN");
        }

        if (recRow.status !== "PROPOSED" && recRow.status !== "DEFERRED") {
          throw new Error("RECOMMENDATION_ALREADY_RESOLVED");
        }

        let newStatus: "ACCEPTED" | "DECLINED" | "DEFERRED" | "CONVERTED" = body.decision;
        let convertedServiceRequestId: string | null = null;

        // If accepted and immediate conversion requested, create follow-up service request
        if (body.decision === "ACCEPTED" && body.convertImmediately) {
          // Fetch original service request to reuse issue type
          const [origReq] = await tx
            .select({
              issueTypeId: serviceRequests.issueTypeId,
              verticalId: serviceRequests.verticalId,
              categoryId: serviceRequests.categoryId,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.id, recRow.serviceRequestId))
            .limit(1);

          if (!origReq) throw new Error("ORIGINAL_REQUEST_NOT_FOUND");

          const [newReq] = await tx
            .insert(serviceRequests)
            .values({
              customerId: recRow.customerId,
              propertyId: recRow.propertyId,
              verticalId: recRow.verticalId ?? origReq.verticalId,
              categoryId: recRow.categoryId ?? origReq.categoryId,
              issueTypeId: origReq.issueTypeId,
              urgency: recRow.urgency === "IMMEDIATE_SAFETY_HAZARD" ? "EMERGENCY" : "STANDARD",
              status: "SUBMITTED",
              description: `[Discovered Service Recommendation] ${recRow.title}: ${recRow.description}`,
              preferredStartsAt: body.preferredStartsAt ? new Date(body.preferredStartsAt) : null,
              preferredEndsAt: body.preferredEndsAt ? new Date(body.preferredEndsAt) : null,
              attachmentKeys: recRow.evidencePhotos,
            })
            .returning({ id: serviceRequests.id });

          if (!newReq) throw new Error("FAILED_TO_CREATE_CONVERTED_REQUEST");

          convertedServiceRequestId = newReq.id;
          newStatus = "CONVERTED";
        }

        // Update recommendation
        await tx
          .update(serviceRecommendations)
          .set({
            status: newStatus,
            respondedAt: new Date(),
            homeownerResponseNotes: body.notes ?? null,
            declineReason: body.decision === "DECLINED" ? (body.declineReason ?? "OTHER") : null,
            convertedServiceRequestId: convertedServiceRequestId ?? recRow.convertedServiceRequestId,
            updatedAt: new Date(),
          })
          .where(eq(serviceRecommendations.id, recommendationId));

        // Record response event in audit history
        await tx.insert(serviceRecommendationResponses).values({
          recommendationId,
          action: body.decision,
          actorId: currentActor.id,
          actorRole: "CUSTOMER",
          notes: body.notes ?? null,
          metadata: {
            decision: body.decision,
            declineReason: body.declineReason ?? null,
            convertedImmediately: Boolean(body.convertImmediately),
            convertedServiceRequestId,
          },
        });

        if (convertedServiceRequestId) {
          await tx.insert(serviceRecommendationResponses).values({
            recommendationId,
            action: "CONVERTED",
            actorId: currentActor.id,
            actorRole: "CUSTOMER",
            notes: "Direct conversion to follow-up service request",
            metadata: {
              convertedServiceRequestId,
            },
          });
        }

        const output = {
          recommendationId,
          status: newStatus,
          convertedServiceRequestId,
          contractorId: recRow.contractorId,
          technicianId: recRow.technicianId,
          title: recRow.title,
        };

        if (idempotencyKey) {
          await tx
            .update(idempotencyKeys)
            .set({ response: output })
            .where(eq(idempotencyKeys.key, idempotencyKey));
        }

        return output;
      });

      // Audit and notify
      await audit(
        currentActor.id,
        `SERVICE_RECOMMENDATION_${body.decision}`,
        "SERVICE_RECOMMENDATION",
        recommendationId,
        { status: "PROPOSED" },
        { status: result.status, declineReason: body.declineReason },
      );

      await emit(
        "SERVICE_RECOMMENDATION",
        recommendationId,
        `Recommendation${body.decision === "ACCEPTED" ? "Accepted" : body.decision === "DECLINED" ? "Declined" : "Deferred"}`,
        {
          recommendationId,
          decision: body.decision,
          declineReason: body.declineReason,
          convertedServiceRequestId: result.convertedServiceRequestId,
        },
      );

      // Find technician user ID to notify them directly
      const [tech] = await db
        .select({ userId: technicians.userId })
        .from(technicians)
        .where(eq(technicians.id, result.technicianId))
        .limit(1);

      if (tech) {
        await notify(
          tech.userId,
          `RECOMMENDATION_${body.decision}`,
          `Homeowner ${body.decision.toLowerCase()} recommendation: "${result.title}"`,
          body.decision === "ACCEPTED"
            ? "Great news! The homeowner accepted your recommended service."
            : body.decision === "DECLINED"
              ? `The homeowner declined this recommendation (${body.declineReason ?? "No reason given"}).`
              : "The homeowner deferred this recommendation to review later.",
          {
            recommendationId,
            decision: body.decision,
            convertedServiceRequestId: result.convertedServiceRequestId,
          },
        );
      }

      return reply.code(200).send(result);
    },
  );

  // 6. Convert an accepted recommendation to a new service request
  app.post(
    "/v1/recommendations/:id/convert",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const recommendationId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(convertRecommendationSchema, request.body);

      const result = await db.transaction(async (tx) => {
        const [rec] = await tx
          .select()
          .from(serviceRecommendations)
          .where(eq(serviceRecommendations.id, recommendationId))
          .for("update", { of: serviceRecommendations });

        if (!rec) {
          throw new Error("RECOMMENDATION_NOT_FOUND");
        }

        if (!isOps(currentActor) && rec.customerId !== currentActor.id) {
          throw new Error("FORBIDDEN");
        }

        if (rec.status !== "ACCEPTED") {
          throw new Error("RECOMMENDATION_NOT_ACCEPTED");
        }

        if (rec.convertedServiceRequestId) {
          return {
            recommendationId,
            serviceRequestId: rec.convertedServiceRequestId,
            alreadyConverted: true,
          };
        }

        const [origReq] = await tx
          .select({
            issueTypeId: serviceRequests.issueTypeId,
            verticalId: serviceRequests.verticalId,
            categoryId: serviceRequests.categoryId,
          })
          .from(serviceRequests)
          .where(eq(serviceRequests.id, rec.serviceRequestId))
          .limit(1);

        if (!origReq) throw new Error("ORIGINAL_REQUEST_NOT_FOUND");

        const [newReq] = await tx
          .insert(serviceRequests)
          .values({
            customerId: rec.customerId,
            propertyId: rec.propertyId,
            verticalId: rec.verticalId ?? origReq.verticalId,
            categoryId: rec.categoryId ?? origReq.categoryId,
            issueTypeId: origReq.issueTypeId,
            urgency: rec.urgency === "IMMEDIATE_SAFETY_HAZARD" ? "EMERGENCY" : "STANDARD",
            status: "SUBMITTED",
            description: `[Discovered Service Recommendation] ${rec.title}: ${rec.description}`,
            preferredStartsAt: body.preferredStartsAt ? new Date(body.preferredStartsAt) : null,
            preferredEndsAt: body.preferredEndsAt ? new Date(body.preferredEndsAt) : null,
            attachmentKeys: rec.evidencePhotos,
          })
          .returning({ id: serviceRequests.id });

        if (!newReq) throw new Error("FAILED_TO_CREATE_CONVERTED_REQUEST");

        await tx
          .update(serviceRecommendations)
          .set({
            status: "CONVERTED",
            convertedServiceRequestId: newReq.id,
            updatedAt: new Date(),
          })
          .where(eq(serviceRecommendations.id, recommendationId));

        await tx.insert(serviceRecommendationResponses).values({
          recommendationId,
          action: "CONVERTED",
          actorId: currentActor.id,
          actorRole: isOps(currentActor) ? "OPERATIONS_AGENT" : "CUSTOMER",
          notes: body.notes ?? "Converted recommendation to follow-up service request",
          metadata: {
            convertedServiceRequestId: newReq.id,
          },
        });

        return {
          recommendationId,
          serviceRequestId: newReq.id,
          alreadyConverted: false,
        };
      });

      await audit(
        currentActor.id,
        "SERVICE_RECOMMENDATION_CONVERTED",
        "SERVICE_RECOMMENDATION",
        recommendationId,
        { status: "ACCEPTED" },
        { status: "CONVERTED", serviceRequestId: result.serviceRequestId },
      );

      return reply.code(200).send(result);
    },
  );

  // 7. Contractor recommendations conversion analytics
  app.get(
    "/v1/contractors/:id/recommendations/analytics",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const contractorId = parse(z.object({ id: uuid }), request.params).id;

      if (!isOps(currentActor) && currentActor.contractorId !== contractorId) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "Not permitted" });
      }

      const rows = await db
        .select({
          status: serviceRecommendations.status,
          count: sql<number>`count(*)::int`,
          totalCostCents: sql<number>`coalesce(sum(${serviceRecommendations.estimatedCostCents}), 0)::bigint`,
        })
        .from(serviceRecommendations)
        .where(eq(serviceRecommendations.contractorId, contractorId))
        .groupBy(serviceRecommendations.status);

      let totalProposed = 0;
      let totalAccepted = 0;
      let totalDeclined = 0;
      let totalDeferred = 0;
      let totalConverted = 0;
      let totalProposedRevenueCents = 0;
      let totalAcceptedRevenueCents = 0;

      for (const row of rows) {
        const count = Number(row.count);
        const cost = Number(row.totalCostCents);
        totalProposed += count;
        totalProposedRevenueCents += cost;

        if (row.status === "ACCEPTED") {
          totalAccepted += count;
          totalAcceptedRevenueCents += cost;
        } else if (row.status === "CONVERTED") {
          totalAccepted += count;
          totalConverted += count;
          totalAcceptedRevenueCents += cost;
        } else if (row.status === "DECLINED") {
          totalDeclined += count;
        } else if (row.status === "DEFERRED") {
          totalDeferred += count;
        }
      }

      const conversionRatePct =
        totalProposed > 0 ? Math.round((totalAccepted / totalProposed) * 1000) / 10 : 0;

      return {
        contractorId,
        totalProposed,
        totalAccepted,
        totalDeclined,
        totalDeferred,
        totalConverted,
        conversionRatePct,
        totalProposedRevenueCents,
        totalAcceptedRevenueCents,
      };
    },
  );
};
