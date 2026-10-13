import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import type {
  CredentialStatus,
  SlotAvailabilityResponse,
} from "@marketplace/contracts";
import { assertTransition, rankCandidates } from "@marketplace/core";
import {
  db,
  eq,
  and,
  or,
  desc,
  sql,
  inArray,
  verticals,
  technicians,
  contractors,
  jobs,
  serviceRequests,
  properties,
  credentials,
  serviceCategories,
  issueTypes,
  tradeRegulatoryPolicies,
  contractorCapabilityAssessments,
  dispatchEligibilityChecks,
  contractorSafetyQuarantines,
  jobRiskAssessments,
  legalAgreements,
  agreementSignatures,
  isNull,
  gt,
  technicianSchedules,
  technicianScheduleExceptions,
  technicianServiceRegions,
  dispatchSlotHolds,
  dispatchOffers,
  dispatchFallbackQueue,
  users,
} from "@marketplace/database";
import {
  evaluateRegulatoryEligibility,
  resolveRegulatoryPolicy,
  evaluatePreDispatchEligibility,
  checkSlotConflict,
  rankCandidatesForSlot,
  computeTravelBufferMinutes,
  computeEvidenceBasedAvailability,
  parseSlotWindow,
  type EvidenceTechnicianData,
} from "@marketplace/vertical-engine";
import {
  evaluatePreDispatchSchema,
  createTechnicianScheduleSchema,
  createScheduleExceptionSchema,
  createServiceRegionSchema,
  acquireSlotHoldSchema,
  generateDispatchOffersSchema,
  respondDispatchOfferSchema,
  triageFallbackQueueSchema,
  slotAvailabilityQuerySchema,
  reserveSlotSchema,
  confirmSlotSchema,
} from "@marketplace/validation";
import { actor, authenticate, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

const getCandidatesHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  requireRole(
    actor(request),
    "OPERATIONS_AGENT",
    "DISPATCHER",
    "ADMIN",
    "SUPER_ADMIN",
  );
  const requestId = parse(
    z.object({ requestId: uuid }),
    request.params,
  ).requestId;

  const [service] = await db
    .select({
      vertical_id: serviceRequests.verticalId,
      urgency: serviceRequests.urgency,
      region: properties.region,
      latitude: properties.latitude,
      longitude: properties.longitude,
      config: verticals.config,
    })
    .from(serviceRequests)
    .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
    .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
    .where(eq(serviceRequests.id, requestId))
    .limit(1);

  if (!service)
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: "Service request not found" });

  const config = z
    .object({
      credentialRequirements: z
        .array(
          z.object({
            code: z.string(),
            geography: z.string(),
            verificationRequired: z.boolean(),
          }),
        )
        .default([]),
    })
    .passthrough()
    .parse(service.config);
  const required = config.credentialRequirements
    .filter(
      (requirement) =>
        requirement.verificationRequired &&
        (requirement.geography === "*" ||
          requirement.geography === service.region),
    )
    .map((requirement) => requirement.code);

  const pLat = service.latitude ?? "0";
  const pLng = service.longitude ?? "0";

  const techRows = await db
    .select({
      technician_id: technicians.id,
      contractor_id: technicians.contractorId,
      distance_km: sql<string>`COALESCE(6371 * acos(least(1,cos(radians(${pLat}::numeric))*cos(radians(${technicians.latitude}))*cos(radians(${technicians.longitude})-radians(${pLng}::numeric))+sin(radians(${pLat}::numeric))*sin(radians(${technicians.latitude})))),9999)::text`,
      rating_bps: contractors.ratingBps,
      completion_rate_bps: contractors.completionRateBps,
      avg_response_minutes: contractors.avgResponseMinutes,
      workload: technicians.workload,
      emergency_available: technicians.emergencyAvailable,
      credentials: sql<unknown>`COALESCE(json_agg(json_build_object('code',${credentials.code},'status',${credentials.status},'expiryDate',${credentials.expiryDate})) FILTER(WHERE ${credentials.id} IS NOT NULL),'[]')`,
    })
    .from(technicians)
    .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
    .leftJoin(
      credentials,
      and(
        or(
          eq(credentials.technicianId, technicians.id),
          eq(credentials.contractorId, contractors.id),
        ),
        or(
          eq(credentials.geography, "*"),
          eq(credentials.geography, service.region),
        ),
      ),
    )
    .where(
      and(
        eq(technicians.active, true),
        eq(contractors.status, "VERIFIED"),
        sql`${contractors.verticalIds} ? ${service.vertical_id}`,
      ),
    )
    .groupBy(technicians.id, contractors.id);

  const candidates = rankCandidates(
    techRows.map((row) => ({
      technicianId: row.technician_id,
      contractorId: row.contractor_id,
      distanceKm: Number(row.distance_km),
      ratingBps: row.rating_bps,
      completionRateBps: row.completion_rate_bps,
      responseMinutes: row.avg_response_minutes,
      workload: row.workload,
      emergencyAvailable: row.emergency_available,
      available: true,
      credentials: z
        .array(
          z.object({
            code: z.string(),
            status: z.enum([
              "PENDING",
              "VERIFIED",
              "REJECTED",
              "EXPIRED",
              "SUSPENDED",
            ]),
            expiryDate: z.string().nullable().optional(),
          }),
        )
        .parse(row.credentials) as Array<{
        code: string;
        status: CredentialStatus;
        expiryDate?: string | null;
      }>,
    })),
    required,
    service.urgency === "EMERGENCY",
  );
  return { candidates, requiredCredentials: required };
};

export const dispatchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/dispatch/slot-availability", async (request, reply) => {
    const query = parse(slotAvailabilityQuerySchema, request.query ?? {});
    const verticalSlug = query.vertical ?? "hvac";
    const region = (query.region ?? "ON").toUpperCase();
    const queriedSlot = query.slot ?? "today-13-15";
    const postalFsa = (query.fsa ?? query.postalCode)
      ?.toUpperCase()
      .replace(/\s+/g, "")
      .slice(0, 3);

    const [vertical] = await db
      .select({ id: verticals.id, slug: verticals.slug, name: verticals.name })
      .from(verticals)
      .where(
        or(
          sql`lower(${verticals.slug}) = lower(${verticalSlug})`,
          sql`lower(${verticals.name}) = lower(${verticalSlug})`,
        ),
      )
      .limit(1);

    if (!vertical) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: `Vertical '${verticalSlug}' not found`,
      });
    }

    const slotWindowParsed = parseSlotWindow(
      queriedSlot,
      query.slotStartsAt,
      query.slotEndsAt,
      new Date(),
    );

    const activeTechs = await db
      .select({
        id: technicians.id,
        displayName: technicians.displayName,
        contractorId: technicians.contractorId,
        contractorName: contractors.name,
        emergencyAvailable: technicians.emergencyAvailable,
      })
      .from(technicians)
      .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
      .where(
        and(
          eq(technicians.active, true),
          eq(contractors.status, "VERIFIED"),
          sql`${contractors.verticalIds} ? ${vertical.id}`,
        ),
      );

    const [jobCountRow] = await db
      .select({ count: sql<string>`count(*)::text` })
      .from(jobs)
      .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
      .where(
        and(
          eq(serviceRequests.verticalId, vertical.id),
          sql`${jobs.status} NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED')`,
        ),
      );

    const activeJobsCount = parseInt(jobCountRow?.count ?? "0", 10);
    const techIds = activeTechs.map((t) => t.id);

    let schedules: Array<typeof technicianSchedules.$inferSelect> = [];
    let exceptions: Array<typeof technicianScheduleExceptions.$inferSelect> = [];
    let regions: Array<typeof technicianServiceRegions.$inferSelect> = [];
    let existingJobs: Array<typeof jobs.$inferSelect> = [];
    let activeHolds: Array<typeof dispatchSlotHolds.$inferSelect> = [];

    if (techIds.length > 0) {
      const now = new Date();
      [schedules, exceptions, regions, existingJobs, activeHolds] =
        await Promise.all([
          db
            .select()
            .from(technicianSchedules)
            .where(
              and(
                inArray(technicianSchedules.technicianId, techIds),
                eq(technicianSchedules.active, true),
              ),
            ),
          db
            .select()
            .from(technicianScheduleExceptions)
            .where(inArray(technicianScheduleExceptions.technicianId, techIds)),
          db
            .select()
            .from(technicianServiceRegions)
            .where(
              and(
                inArray(technicianServiceRegions.technicianId, techIds),
                eq(technicianServiceRegions.active, true),
              ),
            ),
          db
            .select()
            .from(jobs)
            .where(
              and(
                inArray(jobs.technicianId, techIds),
                sql`${jobs.status} NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED')`,
                sql`${jobs.scheduledStartsAt} IS NOT NULL`,
              ),
            ),
          db
            .select()
            .from(dispatchSlotHolds)
            .where(
              and(
                inArray(dispatchSlotHolds.technicianId, techIds),
                eq(dispatchSlotHolds.status, "HELD"),
                gt(dispatchSlotHolds.holdExpiresAt, now),
              ),
            ),
        ]);
    }

    const evidenceTechs: EvidenceTechnicianData[] = activeTechs.map((t) => ({
      id: t.id,
      displayName: t.displayName,
      contractorId: t.contractorId,
      contractorName: t.contractorName,
      emergencyAvailable: t.emergencyAvailable,
      serviceRegions: regions
        .filter((r) => r.technicianId === t.id)
        .map((r) => ({
          postalFsa: r.postalFsa,
          active: r.active,
          maxTravelRadiusKm: r.maxTravelRadiusKm,
          travelBufferMinutes: r.travelBufferMinutes,
        })),
      weeklySchedules: schedules
        .filter((s) => s.technicianId === t.id)
        .map((s) => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          active: s.active,
        })),
      exceptions: exceptions
        .filter((e) => e.technicianId === t.id)
        .map((e) => ({
          id: e.id,
          exceptionType: e.exceptionType,
          startDate: e.startDate,
          endDate: e.endDate,
          startTime: e.startTime,
          endTime: e.endTime,
          allDay: e.allDay,
          reason: e.reason,
        })),
      scheduledJobs: existingJobs
        .filter((j) => j.technicianId === t.id)
        .map((j) => ({
          id: j.id,
          startsAt: new Date(j.scheduledStartsAt!),
          endsAt: new Date(j.scheduledEndsAt!),
          travelBufferMinutes: j.travelBufferMinutes ?? 30,
          status: j.status,
        })),
      activeHolds: activeHolds
        .filter((h) => h.technicianId === t.id)
        .map((h) => ({
          id: h.id,
          bufferedStartsAt: new Date(h.bufferedStartsAt),
          bufferedEndsAt: new Date(h.bufferedEndsAt),
          holdExpiresAt: new Date(h.holdExpiresAt),
        })),
    }));

    const isLegacySurge =
      queriedSlot === "peak-surge" ||
      queriedSlot === "today-13-15-surge" ||
      queriedSlot.includes("busy") ||
      query.forceSurge === "true";

    const response = computeEvidenceBasedAvailability({
      verticalSlug: vertical.slug,
      verticalName: vertical.name,
      region,
      postalFsa,
      slotKey: queriedSlot,
      slotWindow: {
        startsAt: slotWindowParsed.startsAt,
        endsAt: slotWindowParsed.endsAt,
        travelBufferMinutes: 30,
      },
      slotLabel: slotWindowParsed.label,
      technicians: evidenceTechs,
      activeJobsInVerticalCount: activeJobsCount,
      now: new Date(),
      isLegacySurge,
    });

    return reply.code(200).send(response);
  });

  // Atomic Slot Reservation (15-min lease)
  app.post("/v1/dispatch/slots/reserve", async (request, reply) => {
    const body = parse(reserveSlotSchema, request.body);
    const postalFsa = body.postalCode.toUpperCase().replace(/\s+/g, "").slice(0, 3);
    const startsAt = new Date(body.slotStartsAt);
    const endsAt = new Date(body.slotEndsAt);
    const now = new Date();

    if (endsAt.getTime() <= startsAt.getTime()) {
      return reply.code(400).send({
        code: "INVALID_SLOT_WINDOW",
        message: "slotEndsAt must be strictly after slotStartsAt",
      });
    }

    const [vertical] = await db
      .select({ id: verticals.id, slug: verticals.slug, name: verticals.name })
      .from(verticals)
      .where(sql`lower(${verticals.slug}) = lower(${body.verticalSlug})`)
      .limit(1);

    if (!vertical) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: `Vertical '${body.verticalSlug}' not found`,
      });
    }

    // Atomic transaction: Find available technician and place exclusive hold
    const result = await db.transaction(async (tx) => {
      // Find candidate verified technicians serving this FSA
      const candidateTechs = await tx
        .select({
          id: technicians.id,
          displayName: technicians.displayName,
          contractorId: technicians.contractorId,
          emergencyAvailable: technicians.emergencyAvailable,
        })
        .from(technicians)
        .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
        .innerJoin(
          technicianServiceRegions,
          and(
            eq(technicianServiceRegions.technicianId, technicians.id),
            eq(technicianServiceRegions.active, true),
            sql`upper(${technicianServiceRegions.postalFsa}) = ${postalFsa}`,
          ),
        )
        .where(
          and(
            eq(technicians.active, true),
            eq(contractors.status, "VERIFIED"),
            sql`${contractors.verticalIds} ? ${vertical.id}`,
            body.urgency === "EMERGENCY"
              ? eq(technicians.emergencyAvailable, true)
              : sql`true`,
          ),
        );

      if (candidateTechs.length === 0) {
        return {
          success: false,
          status: "UNAVAILABLE" as const,
          reason: `No verified ${vertical.name} technicians currently serve postal FSA ${postalFsa}.`,
        };
      }

      const techIds = candidateTechs.map((t) => t.id);

      // Lock existing active holds for candidate techs to prevent race conditions
      const existingHolds = await tx
        .select()
        .from(dispatchSlotHolds)
        .where(
          and(
            inArray(dispatchSlotHolds.technicianId, techIds),
            eq(dispatchSlotHolds.status, "HELD"),
            gt(dispatchSlotHolds.holdExpiresAt, now),
          ),
        )
        .for("update");

      const existingJobs = await tx
        .select()
        .from(jobs)
        .where(
          and(
            inArray(jobs.technicianId, techIds),
            sql`${jobs.status} NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED')`,
            sql`${jobs.scheduledStartsAt} IS NOT NULL`,
          ),
        );

      const schedules = await tx
        .select()
        .from(technicianSchedules)
        .where(
          and(
            inArray(technicianSchedules.technicianId, techIds),
            eq(technicianSchedules.active, true),
          ),
        );

      const exceptions = await tx
        .select()
        .from(technicianScheduleExceptions)
        .where(inArray(technicianScheduleExceptions.technicianId, techIds));

      const slotWindow = { startsAt, endsAt, travelBufferMinutes: 30 };

      // Find first conflict-free technician
      let chosenTech: (typeof candidateTechs)[number] | null = null;
      for (const tech of candidateTechs) {
        const techJobs = existingJobs
          .filter((j) => j.technicianId === tech.id)
          .map((j) => ({
            id: j.id,
            startsAt: new Date(j.scheduledStartsAt!),
            endsAt: new Date(j.scheduledEndsAt!),
            travelBufferMinutes: j.travelBufferMinutes ?? 30,
            status: j.status,
          }));
        const techHolds = existingHolds
          .filter((h) => h.technicianId === tech.id)
          .map((h) => ({
            id: h.id,
            bufferedStartsAt: new Date(h.bufferedStartsAt),
            bufferedEndsAt: new Date(h.bufferedEndsAt),
            holdExpiresAt: new Date(h.holdExpiresAt),
          }));
        const techSchedules = schedules.filter((s) => s.technicianId === tech.id);
        const techExceptions = exceptions.filter((e) => e.technicianId === tech.id);

        const conflict = checkSlotConflict(slotWindow, {
          existingJobs: techJobs,
          activeHolds: techHolds,
          weeklySchedules: techSchedules,
          exceptions: techExceptions,
          now,
        });

        if (!conflict.hasConflict) {
          chosenTech = tech;
          break;
        }
      }

      if (!chosenTech) {
        return {
          success: false,
          status: "UNAVAILABLE" as const,
          reason: `All verified ${vertical.name} specialists in postal FSA ${postalFsa} are committed for this requested arrival window.`,
        };
      }

      const holdExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);
      const holdToken = `hold_${crypto.randomUUID().replace(/-/g, "")}`;
      const bufferedStartsAt = new Date(startsAt.getTime() - 30 * 60 * 1000);
      const bufferedEndsAt = new Date(endsAt.getTime() + 30 * 60 * 1000);

      const [hold] = await tx
        .insert(dispatchSlotHolds)
        .values({
          serviceRequestId: body.serviceRequestId ?? null,
          technicianId: chosenTech.id,
          contractorId: chosenTech.contractorId,
          holdToken,
          postalFsa,
          verticalId: vertical.id,
          slotStartsAt: startsAt,
          slotEndsAt: endsAt,
          travelBufferMinutes: 30,
          bufferedStartsAt,
          bufferedEndsAt,
          status: "HELD",
          holdExpiresAt,
          heldByUserId: request.actor?.id ?? null,
        })
        .returning();

      return {
        success: true,
        status: "HELD" as const,
        holdId: hold!.id,
        holdToken,
        technicianId: chosenTech.id,
        technicianName: chosenTech.displayName,
        contractorId: chosenTech.contractorId,
        slotStartsAt: startsAt.toISOString(),
        slotEndsAt: endsAt.toISOString(),
        holdExpiresAt: holdExpiresAt.toISOString(),
        expiresInSeconds: 900,
      };
    });

    if (!result.success) {
      return reply.code(409).send(result);
    }
    return reply.code(201).send(result);
  });

  // Atomic Slot Hold Confirmation & Job Appointment Creation
  app.post("/v1/dispatch/slots/confirm", async (request, reply) => {
    const body = parse(confirmSlotSchema, request.body);
    const now = new Date();

    if (!body.holdId && !body.holdToken) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Either holdId or holdToken must be provided",
      });
    }

    const [hold] = await db
      .select()
      .from(dispatchSlotHolds)
      .where(
        body.holdId
          ? eq(dispatchSlotHolds.id, body.holdId)
          : eq(dispatchSlotHolds.holdToken, body.holdToken!),
      )
      .limit(1);

    if (!hold) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "Slot reservation hold not found",
      });
    }

    if (hold.status === "CONFIRMED") {
      return reply.code(409).send({
        code: "ALREADY_CONFIRMED",
        message: "This slot hold has already been confirmed",
      });
    }

    if (new Date(hold.holdExpiresAt).getTime() <= now.getTime()) {
      await db
        .update(dispatchSlotHolds)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(eq(dispatchSlotHolds.id, hold.id));

      return reply.code(410).send({
        code: "HOLD_EXPIRED",
        message:
          "Slot hold lease has expired. Please select and reserve an open arrival window.",
      });
    }

    const serviceRequestId = body.serviceRequestId ?? hold.serviceRequestId;

    const result = await db.transaction(async (tx) => {
      await tx
        .update(dispatchSlotHolds)
        .set({
          status: "CONFIRMED",
          serviceRequestId: serviceRequestId ?? hold.serviceRequestId,
          updatedAt: now,
        })
        .where(eq(dispatchSlotHolds.id, hold.id));

      let jobId: string | undefined;

      if (serviceRequestId) {
        await tx
          .update(serviceRequests)
          .set({
            preferredStartsAt: hold.slotStartsAt,
            preferredEndsAt: hold.slotEndsAt,
            status: "SCHEDULED",
            updatedAt: now,
          })
          .where(eq(serviceRequests.id, serviceRequestId));

        const [existingJob] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.serviceRequestId, serviceRequestId))
          .limit(1);

        if (existingJob) {
          jobId = existingJob.id;
          await tx
            .update(jobs)
            .set({
              technicianId: hold.technicianId,
              scheduledStartsAt: hold.slotStartsAt,
              scheduledEndsAt: hold.slotEndsAt,
              travelBufferMinutes: hold.travelBufferMinutes,
              status: "ASSIGNED",
              updatedAt: now,
            })
            .where(eq(jobs.id, existingJob.id));
        } else {
          const [newJob] = await tx
            .insert(jobs)
            .values({
              serviceRequestId,
              contractorId: hold.contractorId,
              technicianId: hold.technicianId,
              status: "ASSIGNED",
              scheduledStartsAt: hold.slotStartsAt,
              scheduledEndsAt: hold.slotEndsAt,
              travelBufferMinutes: hold.travelBufferMinutes,
            })
            .returning({ id: jobs.id });
          jobId = newJob?.id;
        }
      }

      return {
        success: true,
        status: "CONFIRMED" as const,
        holdId: hold.id,
        serviceRequestId: serviceRequestId ?? undefined,
        jobId,
        technicianId: hold.technicianId,
        scheduledStartsAt: new Date(hold.slotStartsAt).toISOString(),
        scheduledEndsAt: new Date(hold.slotEndsAt).toISOString(),
      };
    });

    if (request.actor?.id) {
      await audit(
        request.actor.id,
        "DISPATCH_SLOT_CONFIRMED",
        "DISPATCH_SLOT_HOLD",
        hold.id,
        { status: "HELD" },
        { status: "CONFIRMED", jobId: result.jobId },
      );
    }

    return reply.code(200).send(result);
  });

  app.get(
    "/v1/dispatch/:requestId/candidates",
    { preHandler: authenticate },
    getCandidatesHandler,
  );
  app.get(
    "/v1/dispatch/:requestId/match",
    { preHandler: authenticate },
    getCandidatesHandler,
  );

  app.post(
    "/v1/dispatch/:requestId/evaluate-eligibility",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const requestId = parse(
        z.object({ requestId: uuid }),
        request.params,
      ).requestId;
      const body = parse(evaluatePreDispatchSchema, request.body);

      const [service] = await db
        .select({
          status: serviceRequests.status,
          vertical_id: serviceRequests.verticalId,
          category_id: serviceRequests.categoryId,
          issue_type_id: serviceRequests.issueTypeId,
          urgency: serviceRequests.urgency,
          region: properties.region,
          config: verticals.config,
          vertical_slug: verticals.slug,
          category_slug: serviceCategories.slug,
          variant_slug: issueTypes.slug,
        })
        .from(serviceRequests)
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
        .leftJoin(
          serviceCategories,
          eq(serviceCategories.id, serviceRequests.categoryId),
        )
        .leftJoin(issueTypes, eq(issueTypes.id, serviceRequests.issueTypeId))
        .where(eq(serviceRequests.id, requestId))
        .limit(1);

      if (!service) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Service request not found" });
      }

      const [candidate] = await db
        .select({
          technician_id: technicians.id,
          technician_name: technicians.displayName,
          technician_active: technicians.active,
          technician_safety_status: technicians.safetyStatus,
          contractor_id: technicians.contractorId,
          contractor_name: contractors.name,
          contractor_status: contractors.status,
          contractor_safety_status: contractors.safetyStatus,
          contractor_vertical_ids: contractors.verticalIds,
        })
        .from(technicians)
        .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
        .where(eq(technicians.id, body.technicianId))
        .limit(1);

      if (!candidate) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Technician or contractor not found",
        });
      }

      const cCredRows = await db
        .select({
          id: credentials.id,
          code: credentials.code,
          geography: credentials.geography,
          status: credentials.status,
          verificationSource: credentials.verificationSource,
          regulatorReference: credentials.regulatorReference,
          expiryDate: credentials.expiryDate,
          checkedAt: credentials.checkedAt,
        })
        .from(credentials)
        .where(eq(credentials.contractorId, candidate.contractor_id));

      const tCredRows = await db
        .select({
          id: credentials.id,
          code: credentials.code,
          geography: credentials.geography,
          status: credentials.status,
          verificationSource: credentials.verificationSource,
          regulatorReference: credentials.regulatorReference,
          expiryDate: credentials.expiryDate,
          checkedAt: credentials.checkedAt,
        })
        .from(credentials)
        .where(eq(credentials.technicianId, body.technicianId));

      const matchingPolicies = await db
        .select()
        .from(tradeRegulatoryPolicies)
        .where(
          and(
            eq(tradeRegulatoryPolicies.verticalSlug, service.vertical_slug),
            eq(tradeRegulatoryPolicies.geography, service.region),
            eq(tradeRegulatoryPolicies.active, true),
          ),
        );

      const resolvedPolicy = resolveRegulatoryPolicy(
        matchingPolicies.map((p) => ({
          id: p.id,
          verticalSlug: p.verticalSlug,
          categorySlug: p.categorySlug,
          variantSlug: p.variantSlug,
          geography: p.geography,
          policyVersion: p.policyVersion,
          contractorMandatoryCodes:
            (p.contractorMandatoryCodes as string[]) ?? [],
          technicianMandatoryCodes:
            (p.technicianMandatoryCodes as string[]) ?? [],
          apprenticeEligible: p.apprenticeEligible,
          supervisorRatio: p.supervisorRatio ?? "1:1",
          permitRequired: p.permitRequired,
          inspectionAuthority: p.inspectionAuthority ?? null,
          legalAuthorityDisclaimer: p.legalAuthorityDisclaimer,
          active: p.active,
        })),
        {
          verticalSlug: service.vertical_slug,
          categorySlug: service.category_slug ?? undefined,
          variantSlug: service.variant_slug ?? undefined,
          geography: service.region,
        },
      );

      const [capabilityRow] = service.issue_type_id
        ? await db
            .select()
            .from(contractorCapabilityAssessments)
            .where(
              and(
                eq(
                  contractorCapabilityAssessments.contractorId,
                  candidate.contractor_id,
                ),
                eq(
                  contractorCapabilityAssessments.issueTypeId,
                  service.issue_type_id,
                ),
                eq(contractorCapabilityAssessments.geography, service.region),
              ),
            )
            .limit(1)
        : [null];

      const cCreds = cCredRows.map((c) => ({
        id: c.id,
        code: c.code,
        geography: c.geography,
        status: c.status,
        verificationSource: c.verificationSource as any,
        regulatorReference: c.regulatorReference ?? null,
        expiryDate: c.expiryDate ?? null,
        checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
      }));

      const tCreds = tCredRows.map((c) => ({
        id: c.id,
        code: c.code,
        geography: c.geography,
        status: c.status,
        verificationSource: c.verificationSource as any,
        regulatorReference: c.regulatorReference ?? null,
        expiryDate: c.expiryDate ?? null,
        checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
      }));

      const activeQuarantines = await db
        .select({
          quarantineType: contractorSafetyQuarantines.quarantineType,
          restrictedVerticalIds:
            contractorSafetyQuarantines.restrictedVerticalIds,
          restrictedIssueTypeIds:
            contractorSafetyQuarantines.restrictedIssueTypeIds,
        })
        .from(contractorSafetyQuarantines)
        .where(
          and(
            eq(
              contractorSafetyQuarantines.contractorId,
              candidate.contractor_id,
            ),
            eq(contractorSafetyQuarantines.active, true),
          ),
        );

      const preDispatch = evaluatePreDispatchEligibility({
        serviceRequest: {
          id: requestId,
          verticalId: service.vertical_id,
          verticalSlug: service.vertical_slug,
          categoryId: service.category_id,
          categorySlug: service.category_slug,
          issueTypeId: service.issue_type_id,
          variantSlug: service.variant_slug,
          urgency: service.urgency as any,
          region: service.region,
        },
        contractor: {
          id: candidate.contractor_id,
          name: candidate.contractor_name,
          status: candidate.contractor_status,
          verticalIds: (candidate.contractor_vertical_ids as string[]) ?? [],
          safetyStatus: candidate.contractor_safety_status,
          activeQuarantines: activeQuarantines as any,
        },
        technician: {
          id: candidate.technician_id,
          contractorId: candidate.contractor_id,
          displayName: candidate.technician_name,
          active: candidate.technician_active,
          safetyStatus: candidate.technician_safety_status,
        },
        contractorCredentials: cCreds,
        technicianCredentials: tCreds,
        regulatoryPolicy: resolvedPolicy,
        capabilityAssessment: capabilityRow
          ? {
              id: capabilityRow.id,
              contractorId: capabilityRow.contractorId,
              issueTypeId: capabilityRow.issueTypeId,
              geography: capabilityRow.geography,
              status: capabilityRow.status as any,
              complexityTier: capabilityRow.complexityTier as any,
              maxJobValueCents: Number(capabilityRow.maxJobValueCents),
              validUntil: capabilityRow.validUntil
                ? capabilityRow.validUntil.toISOString()
                : null,
              supervisedRequirements:
                capabilityRow.supervisedRequirements as any,
            }
          : null,
      });

      return reply.code(200).send(preDispatch);
    },
  );

  app.post(
    "/v1/dispatch/:requestId/assign",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const requestId = parse(
        z.object({ requestId: uuid }),
        request.params,
      ).requestId;
      const body = parse(
        z.object({
          technicianId: uuid,
          overrideReason: z.string().min(5).max(1000).optional(),
        }),
        request.body,
      );
      const assigned = await db.transaction(async (tx) => {
        const [service] = await tx
          .select({
            status: serviceRequests.status,
            vertical_id: serviceRequests.verticalId,
            category_id: serviceRequests.categoryId,
            issue_type_id: serviceRequests.issueTypeId,
            urgency: serviceRequests.urgency,
            region: properties.region,
            config: verticals.config,
            vertical_slug: verticals.slug,
            category_slug: serviceCategories.slug,
            variant_slug: issueTypes.slug,
          })
          .from(serviceRequests)
          .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
          .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
          .leftJoin(
            serviceCategories,
            eq(serviceCategories.id, serviceRequests.categoryId),
          )
          .leftJoin(issueTypes, eq(issueTypes.id, serviceRequests.issueTypeId))
          .where(eq(serviceRequests.id, requestId))
          .for("update", { of: serviceRequests });

        if (!service) throw new Error("NOT_FOUND");
        assertTransition(service.status, "ASSIGNED");

        const [existingJob] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.serviceRequestId, requestId))
          .limit(1);

        if (existingJob) throw new Error("ALREADY_ASSIGNED");

        const [candidate] = await tx
          .select({
            technician_id: technicians.id,
            technician_name: technicians.displayName,
            technician_active: technicians.active,
            technician_safety_status: technicians.safetyStatus,
            contractor_id: technicians.contractorId,
            contractor_name: contractors.name,
            contractor_status: contractors.status,
            contractor_safety_status: contractors.safetyStatus,
            contractor_vertical_ids: contractors.verticalIds,
            rating_bps: contractors.ratingBps,
            completion_rate_bps: contractors.completionRateBps,
            avg_response_minutes: contractors.avgResponseMinutes,
            workload: technicians.workload,
            emergency_available: technicians.emergencyAvailable,
            credentials: sql<unknown>`COALESCE(json_agg(json_build_object('code',${credentials.code},'status',${credentials.status},'expiryDate',${credentials.expiryDate})) FILTER(WHERE ${credentials.id} IS NOT NULL),'[]')`,
          })
          .from(technicians)
          .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
          .leftJoin(
            credentials,
            and(
              or(
                eq(credentials.technicianId, technicians.id),
                eq(credentials.contractorId, contractors.id),
              ),
              or(
                eq(credentials.geography, "*"),
                eq(credentials.geography, service.region),
              ),
            ),
          )
          .where(
            and(
              eq(technicians.id, body.technicianId),
              eq(technicians.active, true),
              eq(contractors.status, "VERIFIED"),
              sql`${contractors.verticalIds} ? ${service.vertical_id}`,
            ),
          )
          .groupBy(technicians.id, contractors.id);

        if (!candidate) {
          throw new Error("INELIGIBLE_TECHNICIAN");
        }

        // Fetch credentials for comprehensive pre-dispatch check
        const cCredRows = await tx
          .select({
            id: credentials.id,
            code: credentials.code,
            geography: credentials.geography,
            status: credentials.status,
            verificationSource: credentials.verificationSource,
            regulatorReference: credentials.regulatorReference,
            expiryDate: credentials.expiryDate,
            checkedAt: credentials.checkedAt,
          })
          .from(credentials)
          .where(eq(credentials.contractorId, candidate.contractor_id));

        const tCredRows = await tx
          .select({
            id: credentials.id,
            code: credentials.code,
            geography: credentials.geography,
            status: credentials.status,
            verificationSource: credentials.verificationSource,
            regulatorReference: credentials.regulatorReference,
            expiryDate: credentials.expiryDate,
            checkedAt: credentials.checkedAt,
          })
          .from(credentials)
          .where(eq(credentials.technicianId, body.technicianId));

        const cCreds = cCredRows.map((c) => ({
          id: c.id,
          code: c.code,
          geography: c.geography,
          status: c.status,
          verificationSource: c.verificationSource as any,
          regulatorReference: c.regulatorReference ?? null,
          expiryDate: c.expiryDate ?? null,
          checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
        }));

        const tCreds = tCredRows.map((c) => ({
          id: c.id,
          code: c.code,
          geography: c.geography,
          status: c.status,
          verificationSource: c.verificationSource as any,
          regulatorReference: c.regulatorReference ?? null,
          expiryDate: c.expiryDate ?? null,
          checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
        }));

        // Resolve trade regulatory policy
        const matchingPolicies = await tx
          .select()
          .from(tradeRegulatoryPolicies)
          .where(
            and(
              eq(tradeRegulatoryPolicies.verticalSlug, service.vertical_slug),
              eq(tradeRegulatoryPolicies.geography, service.region),
              eq(tradeRegulatoryPolicies.active, true),
            ),
          );

        const resolvedPolicy = resolveRegulatoryPolicy(
          matchingPolicies.map((p) => ({
            id: p.id,
            verticalSlug: p.verticalSlug,
            categorySlug: p.categorySlug,
            variantSlug: p.variantSlug,
            geography: p.geography,
            policyVersion: p.policyVersion,
            contractorMandatoryCodes:
              (p.contractorMandatoryCodes as string[]) ?? [],
            technicianMandatoryCodes:
              (p.technicianMandatoryCodes as string[]) ?? [],
            apprenticeEligible: p.apprenticeEligible,
            supervisorRatio: p.supervisorRatio ?? "1:1",
            permitRequired: p.permitRequired,
            inspectionAuthority: p.inspectionAuthority ?? null,
            legalAuthorityDisclaimer: p.legalAuthorityDisclaimer,
            active: p.active,
          })),
          {
            verticalSlug: service.vertical_slug,
            categorySlug: service.category_slug ?? undefined,
            variantSlug: service.variant_slug ?? undefined,
            geography: service.region,
          },
        );

        // Fetch capability assessment
        const [capabilityRow] = service.issue_type_id
          ? await tx
              .select()
              .from(contractorCapabilityAssessments)
              .where(
                and(
                  eq(
                    contractorCapabilityAssessments.contractorId,
                    candidate.contractor_id,
                  ),
                  eq(
                    contractorCapabilityAssessments.issueTypeId,
                    service.issue_type_id,
                  ),
                  eq(
                    contractorCapabilityAssessments.geography,
                    service.region,
                  ),
                ),
              )
              .limit(1)
          : [null];

        const activeQuarantines = await tx
          .select({
            quarantineType: contractorSafetyQuarantines.quarantineType,
            restrictedVerticalIds:
              contractorSafetyQuarantines.restrictedVerticalIds,
            restrictedIssueTypeIds:
              contractorSafetyQuarantines.restrictedIssueTypeIds,
          })
          .from(contractorSafetyQuarantines)
          .where(
            and(
              eq(
                contractorSafetyQuarantines.contractorId,
                candidate.contractor_id,
              ),
              eq(contractorSafetyQuarantines.active, true),
            ),
          );

        // Perform atomic pre-dispatch safety and eligibility evaluation (#57, #58)
        const preDispatch = evaluatePreDispatchEligibility({
          serviceRequest: {
            id: requestId,
            verticalId: service.vertical_id,
            verticalSlug: service.vertical_slug,
            categoryId: service.category_id,
            categorySlug: service.category_slug,
            issueTypeId: service.issue_type_id,
            variantSlug: service.variant_slug,
            urgency: service.urgency as any,
            region: service.region,
          },
          contractor: {
            id: candidate.contractor_id,
            name: candidate.contractor_name,
            status: candidate.contractor_status,
            verticalIds:
              (candidate.contractor_vertical_ids as string[]) ?? [],
            safetyStatus: candidate.contractor_safety_status,
            activeQuarantines: activeQuarantines as any,
          },
          technician: {
            id: candidate.technician_id,
            contractorId: candidate.contractor_id,
            displayName: candidate.technician_name,
            active: candidate.technician_active,
            safetyStatus: candidate.technician_safety_status,
          },
          contractorCredentials: cCreds,
          technicianCredentials: tCreds,
          regulatoryPolicy: resolvedPolicy,
          capabilityAssessment: capabilityRow
            ? {
                id: capabilityRow.id,
                contractorId: capabilityRow.contractorId,
                issueTypeId: capabilityRow.issueTypeId,
                geography: capabilityRow.geography,
                status: capabilityRow.status as any,
                complexityTier: capabilityRow.complexityTier as any,
                maxJobValueCents: Number(capabilityRow.maxJobValueCents),
                validUntil: capabilityRow.validUntil
                  ? capabilityRow.validUntil.toISOString()
                  : null,
                supervisedRequirements:
                  capabilityRow.supervisedRequirements as any,
              }
            : null,
        });

        // Record check in audit history table
        await tx.insert(dispatchEligibilityChecks).values({
          serviceRequestId: requestId,
          contractorId: candidate.contractor_id,
          technicianId: body.technicianId,
          evaluationStage: "PRE_DISPATCH",
          eligible: preDispatch.eligible,
          failClosedReason: preDispatch.failClosedReason ?? null,
          denyCodes: preDispatch.denyCodes,
          evidenceSnapshot: preDispatch.evidenceSnapshot,
          evaluatedByUserId: actor(request).id,
          escalatedToOps: !preDispatch.eligible,
        });

        if (!preDispatch.eligible) {
          const isRegulatory = preDispatch.denyCodes.includes(
            "REGULATORY_POLICY_DEFICIENCY",
          );
          const err = new Error(
            `Pre-dispatch safety check failed: ${preDispatch.failClosedReason}`,
          );
          (err as any).statusCode = 422;
          (err as any).code = isRegulatory
            ? "REGULATORY_ELIGIBILITY_FAILED"
            : "PRE_DISPATCH_INELIGIBLE";
          (err as any).details = {
            denyCodes: preDispatch.denyCodes,
            failClosedReason: preDispatch.failClosedReason,
            evidenceSnapshot: preDispatch.evidenceSnapshot,
          };
          throw err;
        }

        const config = z
          .object({
            credentialRequirements: z
              .array(
                z.object({
                  code: z.string(),
                  geography: z.string(),
                  verificationRequired: z.boolean(),
                }),
              )
              .default([]),
          })
          .passthrough()
          .parse(service.config);
        const required = config.credentialRequirements
          .filter(
            (requirement) =>
              requirement.verificationRequired &&
              (requirement.geography === "*" ||
                requirement.geography === service.region),
          )
          .map((requirement) => requirement.code);

        const ranked = candidate
          ? rankCandidates(
              [
                {
                  technicianId: candidate.technician_id,
                  contractorId: candidate.contractor_id,
                  distanceKm: 0,
                  ratingBps: candidate.rating_bps,
                  completionRateBps: candidate.completion_rate_bps,
                  responseMinutes: candidate.avg_response_minutes,
                  workload: candidate.workload,
                  emergencyAvailable: candidate.emergency_available,
                  available: true,
                  credentials: z
                    .array(
                      z.object({
                        code: z.string(),
                        status: z.enum([
                          "PENDING",
                          "VERIFIED",
                          "REJECTED",
                          "EXPIRED",
                          "SUSPENDED",
                        ]),
                        expiryDate: z.string().nullable().optional(),
                      }),
                    )
                    .parse(candidate.credentials) as Array<{
                    code: string;
                    status: CredentialStatus;
                    expiryDate?: string | null;
                  }>,
                },
              ],
              required,
              service.urgency === "EMERGENCY",
            )
          : [];
        if (!ranked.some((item) => item.technicianId === body.technicianId))
          throw new Error("INELIGIBLE_TECHNICIAN");

        // Check job risk assessment for service request
        const [riskAssessment] = await tx
          .select()
          .from(jobRiskAssessments)
          .where(eq(jobRiskAssessments.serviceRequestId, requestId))
          .orderBy(desc(jobRiskAssessments.createdAt))
          .limit(1);

        if (riskAssessment) {
          // Invariant 1: Manual review requirement fails closed if pending or not approved
          if (
            riskAssessment.requiresManualApproval &&
            riskAssessment.manualApprovalStatus !== "APPROVED"
          ) {
            const err = new Error(
              `Pre-dispatch safety check failed: job risk tier (${riskAssessment.riskTier}) requires operations safety approval before assignment`,
            );
            (err as any).statusCode = 422;
            (err as any).code = "CRITICAL_RISK_MANUAL_APPROVAL_REQUIRED";
            (err as any).details = {
              riskAssessmentId: riskAssessment.id,
              riskTier: riskAssessment.riskTier,
              manualApprovalStatus: riskAssessment.manualApprovalStatus,
              requiresManualApproval: true,
            };
            throw err;
          }

          // Invariant 2: Mandatory safety controls must all be fulfilled
          const mandatoryControls =
            (riskAssessment.mandatoryControls as Array<{ control: string; fulfilled?: boolean }>) ?? [];
          const unfulfilledControls = mandatoryControls.filter(
            (c) => !c.fulfilled,
          );
          if (unfulfilledControls.length > 0) {
            const err = new Error(
              `Pre-dispatch safety check failed: ${unfulfilledControls.length} mandatory safety controls are unfulfilled`,
            );
            (err as any).statusCode = 422;
            (err as any).code = "UNFULFILLED_MANDATORY_SAFETY_CONTROLS";
            (err as any).details = {
              riskAssessmentId: riskAssessment.id,
              unfulfilledControls: unfulfilledControls.map((c) => c.control),
              totalMandated: mandatoryControls.length,
            };
            throw err;
          }
        }

        // Check legal agreement compliance: Contractor must have executed active ICA
        const [activeIca] = await tx
          .select({
            id: legalAgreements.id,
            version: legalAgreements.version,
            contentChecksum: legalAgreements.contentChecksum,
          })
          .from(legalAgreements)
          .where(
            and(
              eq(legalAgreements.type, "INDEPENDENT_CONTRACTOR_AGREEMENT"),
              eq(legalAgreements.jurisdiction, service.region),
              eq(legalAgreements.isActive, true),
            ),
          )
          .limit(1);

        if (activeIca) {
          const [icaSignature] = await tx
            .select({ id: agreementSignatures.id })
            .from(agreementSignatures)
            .where(
              and(
                eq(agreementSignatures.agreementId, activeIca.id),
                eq(agreementSignatures.contractorId, candidate.contractor_id),
                eq(
                  agreementSignatures.agreementChecksum,
                  activeIca.contentChecksum,
                ),
                isNull(agreementSignatures.revokedAt),
              ),
            )
            .limit(1);

          if (!icaSignature) {
            const err = new Error(
              `Pre-dispatch legal check failed: Contractor (${candidate.contractor_name}) has not executed active Independent Contractor Agreement (v${activeIca.version})`,
            );
            (err as any).statusCode = 422;
            (err as any).code = "CONTRACTOR_AGREEMENT_REQUIRED";
            (err as any).details = {
              contractorId: candidate.contractor_id,
              requiredAgreementId: activeIca.id,
              requiredVersion: activeIca.version,
              jurisdiction: service.region,
            };
            throw err;
          }
        }

        const [job] = await tx
          .insert(jobs)
          .values({
            serviceRequestId: requestId,
            contractorId: candidate.contractor_id,
            technicianId: body.technicianId,
            status: "ASSIGNED",
            evidenceSnapshot: preDispatch.evidenceSnapshot,
            assignedJurisdiction: service.region,
            assignedScope: {
              verticalId: service.vertical_id,
              verticalSlug: service.vertical_slug,
              categoryId: service.category_id,
              categorySlug: service.category_slug,
              issueTypeId: service.issue_type_id,
              variantSlug: service.variant_slug,
              urgency: service.urgency,
            },
            workerIdentityVerified: false,
            riskTier: riskAssessment ? (riskAssessment.riskTier as any) : "LOW",
            riskScore: riskAssessment ? riskAssessment.residualScore : null,
            riskAssessmentId: riskAssessment ? riskAssessment.id : null,
            riskReviewStatus: riskAssessment
              ? (riskAssessment.manualApprovalStatus as any)
              : "NOT_REQUIRED",
          })
          .returning({ id: jobs.id });

        if (!job) throw new Error("ASSIGNMENT_FAILED");

        if (riskAssessment && !riskAssessment.jobId) {
          await tx
            .update(jobRiskAssessments)
            .set({ jobId: job.id, updatedAt: new Date() })
            .where(eq(jobRiskAssessments.id, riskAssessment.id));
        }

        await tx
          .update(serviceRequests)
          .set({ status: "ASSIGNED", updatedAt: new Date() })
          .where(eq(serviceRequests.id, requestId));

        return { job, evidenceSnapshot: preDispatch.evidenceSnapshot };
      });

      if (!assigned || !assigned.job) throw new Error("ASSIGNMENT_FAILED");
      await audit(
        actor(request).id,
        "TECHNICIAN_ASSIGNED",
        "SERVICE_REQUEST",
        requestId,
        null,
        { technicianId: body.technicianId },
        body.overrideReason ? { overrideReason: body.overrideReason } : {},
      );
      return reply.code(201).send({
        jobId: assigned.job.id,
        status: "ASSIGNED",
        evidenceSnapshot: assigned.evidenceSnapshot,
      });
    },
  );

  // -------------------------------------------------------------------------
  // TECHNICIAN SCHEDULING, EXCEPTIONS & SERVICE REGIONS (SH-06)
  // -------------------------------------------------------------------------

  app.get(
    "/v1/dispatch/technicians/:technicianId/calendar",
    { preHandler: authenticate },
    async (request, reply) => {
      const { technicianId } = parse(
        z.object({ technicianId: uuid }),
        request.params,
      );

      const [tech] = await db
        .select({
          id: technicians.id,
          displayName: technicians.displayName,
          contractorId: technicians.contractorId,
          contractorName: contractors.name,
        })
        .from(technicians)
        .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
        .where(eq(technicians.id, technicianId))
        .limit(1);

      if (!tech) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Technician not found",
        });
      }

      // Weekly schedules
      const schedules = await db
        .select()
        .from(technicianSchedules)
        .where(eq(technicianSchedules.technicianId, technicianId));

      // Exceptions
      const exceptions = await db
        .select()
        .from(technicianScheduleExceptions)
        .where(eq(technicianScheduleExceptions.technicianId, technicianId))
        .orderBy(desc(technicianScheduleExceptions.startDate));

      // Service Regions
      const regions = await db
        .select()
        .from(technicianServiceRegions)
        .where(eq(technicianServiceRegions.technicianId, technicianId));

      // Scheduled Jobs
      const now = new Date();
      const scheduledJobs = await db
        .select({
          id: jobs.id,
          serviceRequestId: jobs.serviceRequestId,
          scheduledStartsAt: jobs.scheduledStartsAt,
          scheduledEndsAt: jobs.scheduledEndsAt,
          travelBufferMinutes: jobs.travelBufferMinutes,
          status: jobs.status,
          addressLine1: properties.addressLine1,
          postalCode: properties.postalCode,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .where(
          and(
            eq(jobs.technicianId, technicianId),
            sql`${jobs.status} NOT IN ('CANCELLED', 'CLOSED')`,
          ),
        );

      // Active Holds
      const activeHolds = await db
        .select()
        .from(dispatchSlotHolds)
        .where(
          and(
            eq(dispatchSlotHolds.technicianId, technicianId),
            eq(dispatchSlotHolds.status, "HELD"),
            gt(dispatchSlotHolds.holdExpiresAt, now),
          ),
        );

      return reply.code(200).send({
        technicianId: tech.id,
        technicianName: tech.displayName,
        contractorId: tech.contractorId,
        contractorName: tech.contractorName,
        weeklySchedule: schedules.map((s) => ({
          id: s.id,
          technicianId: s.technicianId,
          contractorId: s.contractorId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          timezone: s.timezone,
          active: s.active,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        exceptions: exceptions.map((e) => ({
          id: e.id,
          technicianId: e.technicianId,
          exceptionType: e.exceptionType as any,
          startDate: e.startDate,
          endDate: e.endDate,
          startTime: e.startTime ?? null,
          endTime: e.endTime ?? null,
          allDay: e.allDay,
          reason: e.reason ?? null,
          approvedByUserId: e.approvedByUserId ?? null,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        })),
        serviceRegions: regions.map((r) => ({
          id: r.id,
          technicianId: r.technicianId,
          contractorId: r.contractorId,
          postalFsa: r.postalFsa,
          maxTravelRadiusKm: r.maxTravelRadiusKm,
          travelBufferMinutes: r.travelBufferMinutes,
          active: r.active,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        scheduledJobs: scheduledJobs.map((j) => ({
          id: j.id,
          serviceRequestId: j.serviceRequestId,
          startsAt: (j.scheduledStartsAt ?? now).toISOString(),
          endsAt: (j.scheduledEndsAt ?? new Date(now.getTime() + 7200000)).toISOString(),
          status: j.status,
          customerAddress: `${j.addressLine1}, ${j.postalCode}`,
          travelBufferMinutes: j.travelBufferMinutes ?? 30,
        })),
        activeHolds: activeHolds.map((h) => ({
          id: h.id,
          serviceRequestId: h.serviceRequestId,
          technicianId: h.technicianId,
          contractorId: h.contractorId,
          slotStartsAt: h.slotStartsAt.toISOString(),
          slotEndsAt: h.slotEndsAt.toISOString(),
          travelBufferMinutes: h.travelBufferMinutes,
          bufferedStartsAt: h.bufferedStartsAt.toISOString(),
          bufferedEndsAt: h.bufferedEndsAt.toISOString(),
          status: h.status as any,
          holdExpiresAt: h.holdExpiresAt.toISOString(),
          heldByUserId: h.heldByUserId ?? null,
          createdAt: h.createdAt.toISOString(),
          updatedAt: h.updatedAt.toISOString(),
        })),
      });
    },
  );

  app.put(
    "/v1/dispatch/technicians/:technicianId/schedules",
    { preHandler: authenticate },
    async (request, reply) => {
      const { technicianId } = parse(
        z.object({ technicianId: uuid }),
        request.params,
      );
      const body = parse(
        z.object({
          schedules: z.array(createTechnicianScheduleSchema),
        }),
        request.body,
      );

      const [tech] = await db
        .select({ id: technicians.id, contractorId: technicians.contractorId })
        .from(technicians)
        .where(eq(technicians.id, technicianId))
        .limit(1);

      if (!tech) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Technician not found",
        });
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(technicianSchedules)
          .where(eq(technicianSchedules.technicianId, technicianId));

        if (body.schedules.length > 0) {
          await tx.insert(technicianSchedules).values(
            body.schedules.map((s) => ({
              technicianId,
              contractorId: tech.contractorId,
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
              timezone: s.timezone,
              active: s.active,
            })),
          );
        }
      });

      const updated = await db
        .select()
        .from(technicianSchedules)
        .where(eq(technicianSchedules.technicianId, technicianId));

      return reply.code(200).send({
        technicianId,
        schedules: updated,
      });
    },
  );

  app.post(
    "/v1/dispatch/technicians/:technicianId/exceptions",
    { preHandler: authenticate },
    async (request, reply) => {
      const { technicianId } = parse(
        z.object({ technicianId: uuid }),
        request.params,
      );
      const body = parse(createScheduleExceptionSchema, request.body);

      const [tech] = await db
        .select({ id: technicians.id })
        .from(technicians)
        .where(eq(technicians.id, technicianId))
        .limit(1);

      if (!tech) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Technician not found" });
      }

      const [created] = await db
        .insert(technicianScheduleExceptions)
        .values({
          technicianId,
          exceptionType: body.exceptionType,
          startDate: body.startDate,
          endDate: body.endDate,
          startTime: body.startTime ?? null,
          endTime: body.endTime ?? null,
          allDay: body.allDay,
          reason: body.reason ?? null,
          approvedByUserId: actor(request).id,
        })
        .returning();

      return reply.code(201).send(created);
    },
  );

  app.delete(
    "/v1/dispatch/technicians/:technicianId/exceptions/:exceptionId",
    { preHandler: authenticate },
    async (request, reply) => {
      const { technicianId, exceptionId } = parse(
        z.object({ technicianId: uuid, exceptionId: uuid }),
        request.params,
      );

      await db
        .delete(technicianScheduleExceptions)
        .where(
          and(
            eq(technicianScheduleExceptions.id, exceptionId),
            eq(technicianScheduleExceptions.technicianId, technicianId),
          ),
        );

      return reply.code(200).send({ deleted: true });
    },
  );

  app.post(
    "/v1/dispatch/technicians/:technicianId/service-regions",
    { preHandler: authenticate },
    async (request, reply) => {
      const { technicianId } = parse(
        z.object({ technicianId: uuid }),
        request.params,
      );
      const body = parse(createServiceRegionSchema, request.body);

      const [tech] = await db
        .select({ id: technicians.id, contractorId: technicians.contractorId })
        .from(technicians)
        .where(eq(technicians.id, technicianId))
        .limit(1);

      if (!tech) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Technician not found" });
      }

      const [region] = await db
        .insert(technicianServiceRegions)
        .values({
          technicianId,
          contractorId: tech.contractorId,
          postalFsa: body.postalFsa.toUpperCase(),
          maxTravelRadiusKm: body.maxTravelRadiusKm,
          travelBufferMinutes: body.travelBufferMinutes,
          active: true,
        })
        .onConflictDoUpdate({
          target: [technicianServiceRegions.technicianId, technicianServiceRegions.postalFsa],
          set: {
            maxTravelRadiusKm: body.maxTravelRadiusKm,
            travelBufferMinutes: body.travelBufferMinutes,
            active: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      return reply.code(201).send(region);
    },
  );

  // -------------------------------------------------------------------------
  // ATOMIC SLOT HOLDS & OVERLAP PROTECTION (SH-06)
  // -------------------------------------------------------------------------

  app.post(
    "/v1/dispatch/slots/hold",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = parse(acquireSlotHoldSchema, request.body);

      const [tech] = await db
        .select({
          id: technicians.id,
          contractorId: technicians.contractorId,
          active: technicians.active,
        })
        .from(technicians)
        .where(eq(technicians.id, body.technicianId))
        .limit(1);

      if (!tech || !tech.active) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Active technician not found",
        });
      }

      const slotStartsAt = new Date(body.slotStartsAt);
      const slotEndsAt = new Date(body.slotEndsAt);
      const travelBufferMinutes = body.travelBufferMinutes ?? 30;

      const holdResult = await db.transaction(async (tx) => {
        // Lock technician row to serialize concurrent holds
        await tx
          .select({ id: technicians.id })
          .from(technicians)
          .where(eq(technicians.id, body.technicianId))
          .for("update");

        // 1. Fetch active jobs
        const existingJobs = await tx
          .select({
            id: jobs.id,
            startsAt: jobs.scheduledStartsAt,
            endsAt: jobs.scheduledEndsAt,
            travelBufferMinutes: jobs.travelBufferMinutes,
            status: jobs.status,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.technicianId, body.technicianId),
              sql`${jobs.status} NOT IN ('CANCELLED', 'COMPLETED', 'CLOSED')`,
            ),
          );

        // 2. Fetch active holds
        const now = new Date();
        const activeHolds = await tx
          .select({
            id: dispatchSlotHolds.id,
            bufferedStartsAt: dispatchSlotHolds.bufferedStartsAt,
            bufferedEndsAt: dispatchSlotHolds.bufferedEndsAt,
            holdExpiresAt: dispatchSlotHolds.holdExpiresAt,
          })
          .from(dispatchSlotHolds)
          .where(
            and(
              eq(dispatchSlotHolds.technicianId, body.technicianId),
              eq(dispatchSlotHolds.status, "HELD"),
              gt(dispatchSlotHolds.holdExpiresAt, now),
            ),
          );

        // 3. Weekly schedules & exceptions
        const schedules = await tx
          .select({
            dayOfWeek: technicianSchedules.dayOfWeek,
            startTime: technicianSchedules.startTime,
            endTime: technicianSchedules.endTime,
            active: technicianSchedules.active,
          })
          .from(technicianSchedules)
          .where(eq(technicianSchedules.technicianId, body.technicianId));

        const exceptions = await tx
          .select({
            exceptionType: technicianScheduleExceptions.exceptionType,
            startDate: technicianScheduleExceptions.startDate,
            endDate: technicianScheduleExceptions.endDate,
            startTime: technicianScheduleExceptions.startTime,
            endTime: technicianScheduleExceptions.endTime,
            allDay: technicianScheduleExceptions.allDay,
            reason: technicianScheduleExceptions.reason,
          })
          .from(technicianScheduleExceptions)
          .where(eq(technicianScheduleExceptions.technicianId, body.technicianId));

        // Perform conflict check
        const conflict = checkSlotConflict(
          {
            startsAt: slotStartsAt,
            endsAt: slotEndsAt,
            travelBufferMinutes,
          },
          {
            existingJobs: existingJobs
              .filter((j) => j.startsAt && j.endsAt)
              .map((j) => ({
                id: j.id,
                startsAt: j.startsAt!,
                endsAt: j.endsAt!,
                travelBufferMinutes: j.travelBufferMinutes ?? 30,
                status: j.status,
              })),
            activeHolds,
            weeklySchedules: schedules,
            exceptions,
            now,
          },
        );

        if (conflict.hasConflict) {
          const err = new Error(conflict.conflictDetails || "Slot conflict detected");
          (err as any).statusCode = 409;
          (err as any).code = "SLOT_CONFLICT";
          (err as any).details = conflict;
          throw err;
        }

        const bufferedStartsAt = new Date(
          slotStartsAt.getTime() - travelBufferMinutes * 60 * 1000,
        );
        const bufferedEndsAt = new Date(
          slotEndsAt.getTime() + travelBufferMinutes * 60 * 1000,
        );
        const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        const [createdHold] = await tx
          .insert(dispatchSlotHolds)
          .values({
            serviceRequestId: body.serviceRequestId,
            technicianId: body.technicianId,
            contractorId: tech.contractorId,
            slotStartsAt,
            slotEndsAt,
            travelBufferMinutes,
            bufferedStartsAt,
            bufferedEndsAt,
            status: "HELD",
            holdExpiresAt,
            heldByUserId: actor(request).id,
          })
          .returning();

        return createdHold;
      });

      await audit(
        actor(request).id,
        "SLOT_HOLD_ACQUIRED",
        "SERVICE_REQUEST",
        body.serviceRequestId,
        null,
        { holdId: holdResult?.id, technicianId: body.technicianId },
      );

      return reply.code(201).send(holdResult);
    },
  );

  app.post(
    "/v1/dispatch/slots/:holdId/release",
    { preHandler: authenticate },
    async (request, reply) => {
      const { holdId } = parse(z.object({ holdId: uuid }), request.params);

      const [updated] = await db
        .update(dispatchSlotHolds)
        .set({ status: "RELEASED", updatedAt: new Date() })
        .where(eq(dispatchSlotHolds.id, holdId))
        .returning();

      if (!updated) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Hold not found" });
      }

      return reply.code(200).send({ released: true, holdId });
    },
  );

  // -------------------------------------------------------------------------
  // DISPATCH OFFERS & FALLBACK CASCADE (SH-06)
  // -------------------------------------------------------------------------

  app.post(
    "/v1/dispatch/:requestId/offers/generate",
    { preHandler: authenticate },
    async (request, reply) => {
      const { requestId } = parse(z.object({ requestId: uuid }), request.params);
      const rawBody = typeof request.body === "object" && request.body !== null ? request.body : {};
      const body = parse(generateDispatchOffersSchema, { ...rawBody, serviceRequestId: requestId });

      const [service] = await db
        .select({
          id: serviceRequests.id,
          verticalId: serviceRequests.verticalId,
          region: properties.region,
          postalCode: properties.postalCode,
          urgency: serviceRequests.urgency,
          verticalSlug: verticals.slug,
        })
        .from(serviceRequests)
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
        .where(eq(serviceRequests.id, requestId))
        .limit(1);

      if (!service) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Service request not found" });
      }

      const slotStartsAt = new Date(body.slotStartsAt);
      const slotEndsAt = new Date(body.slotEndsAt);
      const travelBufferMinutes = computeTravelBufferMinutes(15);
      const now = new Date();

      // Find active certified technicians in region
      const techRows = await db
        .select({
          id: technicians.id,
          displayName: technicians.displayName,
          contractorId: technicians.contractorId,
          contractorName: contractors.name,
          ratingBps: contractors.ratingBps,
          completionRateBps: contractors.completionRateBps,
          avgResponseMinutes: contractors.avgResponseMinutes,
          workload: technicians.workload,
        })
        .from(technicians)
        .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
        .where(
          and(
            eq(technicians.active, true),
            eq(contractors.status, "VERIFIED"),
            sql`${contractors.verticalIds} ? ${service.verticalId}`,
          ),
        );

      const candidateEvals: Array<{
        technicianId: string;
        technicianName: string;
        contractorId: string;
        contractorName: string;
        ratingBps: number;
        completionRateBps: number;
        avgResponseMinutes: number;
        distanceKm: number;
        currentWorkload: number;
        conflict: any;
      }> = [];

      for (const t of techRows) {
        const [activeJobs, activeHolds, schedules, exceptions] = await Promise.all([
          db
            .select({
              id: jobs.id,
              startsAt: jobs.scheduledStartsAt,
              endsAt: jobs.scheduledEndsAt,
              travelBufferMinutes: jobs.travelBufferMinutes,
              status: jobs.status,
            })
            .from(jobs)
            .where(
              and(
                eq(jobs.technicianId, t.id),
                sql`${jobs.status} NOT IN ('CANCELLED', 'COMPLETED', 'CLOSED')`,
              ),
            ),
          db
            .select({
              id: dispatchSlotHolds.id,
              bufferedStartsAt: dispatchSlotHolds.bufferedStartsAt,
              bufferedEndsAt: dispatchSlotHolds.bufferedEndsAt,
              holdExpiresAt: dispatchSlotHolds.holdExpiresAt,
            })
            .from(dispatchSlotHolds)
            .where(
              and(
                eq(dispatchSlotHolds.technicianId, t.id),
                eq(dispatchSlotHolds.status, "HELD"),
                gt(dispatchSlotHolds.holdExpiresAt, now),
              ),
            ),
          db
            .select({
              dayOfWeek: technicianSchedules.dayOfWeek,
              startTime: technicianSchedules.startTime,
              endTime: technicianSchedules.endTime,
              active: technicianSchedules.active,
            })
            .from(technicianSchedules)
            .where(eq(technicianSchedules.technicianId, t.id)),
          db
            .select({
              exceptionType: technicianScheduleExceptions.exceptionType,
              startDate: technicianScheduleExceptions.startDate,
              endDate: technicianScheduleExceptions.endDate,
              startTime: technicianScheduleExceptions.startTime,
              endTime: technicianScheduleExceptions.endTime,
              allDay: technicianScheduleExceptions.allDay,
              reason: technicianScheduleExceptions.reason,
            })
            .from(technicianScheduleExceptions)
            .where(eq(technicianScheduleExceptions.technicianId, t.id)),
        ]);

        const conflict = checkSlotConflict(
          {
            startsAt: slotStartsAt,
            endsAt: slotEndsAt,
            travelBufferMinutes,
          },
          {
            existingJobs: activeJobs
              .filter((j) => j.startsAt && j.endsAt)
              .map((j) => ({
                id: j.id,
                startsAt: j.startsAt!,
                endsAt: j.endsAt!,
                travelBufferMinutes: j.travelBufferMinutes ?? 30,
                status: j.status,
              })),
            activeHolds,
            weeklySchedules: schedules,
            exceptions,
            now,
          },
        );

        candidateEvals.push({
          technicianId: t.id,
          technicianName: t.displayName,
          contractorId: t.contractorId,
          contractorName: t.contractorName,
          ratingBps: t.ratingBps,
          completionRateBps: t.completionRateBps,
          avgResponseMinutes: t.avgResponseMinutes,
          distanceKm: 8.5,
          currentWorkload: t.workload,
          conflict,
        });
      }

      const ranked = rankCandidatesForSlot(candidateEvals);

      if (ranked.length === 0) {
        // Enqueue into Fallback Queue
        const [fallbackItem] = await db
          .insert(dispatchFallbackQueue)
          .values({
            serviceRequestId: requestId,
            failedOfferCount: 0,
            reason: "NO_ELIGIBLE_CANDIDATES",
            status: "PENDING_TRIAGE",
          })
          .onConflictDoUpdate({
            target: [dispatchFallbackQueue.serviceRequestId],
            set: {
              reason: "NO_ELIGIBLE_CANDIDATES",
              status: "PENDING_TRIAGE",
              updatedAt: new Date(),
            },
          })
          .returning();

        return reply.code(200).send({
          offers: [],
          fallbackQueue: {
            enrolled: true,
            id: fallbackItem?.id,
            reason: "NO_ELIGIBLE_CANDIDATES",
          },
        });
      }

      // Top candidate offer creation
      const topCandidate = ranked[0]!;
      const offerTtlMinutes = body.offerTtlMinutes ?? 15;
      const offerExpiresAt = new Date(Date.now() + offerTtlMinutes * 60 * 1000);

      const offerResult = await db.transaction(async (tx) => {
        const bufferedStartsAt = new Date(
          slotStartsAt.getTime() - travelBufferMinutes * 60 * 1000,
        );
        const bufferedEndsAt = new Date(
          slotEndsAt.getTime() + travelBufferMinutes * 60 * 1000,
        );

        const [slotHold] = await tx
          .insert(dispatchSlotHolds)
          .values({
            serviceRequestId: requestId,
            technicianId: topCandidate.technicianId,
            contractorId: topCandidate.contractorId,
            slotStartsAt,
            slotEndsAt,
            travelBufferMinutes,
            bufferedStartsAt,
            bufferedEndsAt,
            status: "HELD",
            holdExpiresAt: offerExpiresAt,
            heldByUserId: actor(request).id,
          })
          .returning();

        const [offer] = await tx
          .insert(dispatchOffers)
          .values({
            serviceRequestId: requestId,
            technicianId: topCandidate.technicianId,
            contractorId: topCandidate.contractorId,
            slotHoldId: slotHold?.id,
            candidateRank: 1,
            candidateScore: topCandidate.score,
            status: "OFFERED",
            expiresAt: offerExpiresAt,
          })
          .returning();

        return { offer, slotHold };
      });

      await audit(
        actor(request).id,
        "DISPATCH_OFFER_GENERATED",
        "SERVICE_REQUEST",
        requestId,
        null,
        {
          offerId: offerResult.offer?.id,
          technicianId: topCandidate.technicianId,
          score: topCandidate.score,
        },
      );

      return reply.code(201).send({
        offer: {
          ...offerResult.offer,
          technicianName: topCandidate.technicianName,
          contractorName: topCandidate.contractorName,
        },
        slotHold: offerResult.slotHold,
        totalEligibleCandidates: ranked.length,
      });
    },
  );

  app.get(
    "/v1/dispatch/:requestId/offers",
    { preHandler: authenticate },
    async (request, reply) => {
      const { requestId } = parse(z.object({ requestId: uuid }), request.params);

      const offers = await db
        .select({
          id: dispatchOffers.id,
          serviceRequestId: dispatchOffers.serviceRequestId,
          technicianId: dispatchOffers.technicianId,
          technicianName: technicians.displayName,
          contractorId: dispatchOffers.contractorId,
          contractorName: contractors.name,
          slotHoldId: dispatchOffers.slotHoldId,
          candidateRank: dispatchOffers.candidateRank,
          candidateScore: dispatchOffers.candidateScore,
          status: dispatchOffers.status,
          offeredAt: dispatchOffers.offeredAt,
          expiresAt: dispatchOffers.expiresAt,
          respondedAt: dispatchOffers.respondedAt,
          declineReason: dispatchOffers.declineReason,
          declineNotes: dispatchOffers.declineNotes,
          createdAt: dispatchOffers.createdAt,
          updatedAt: dispatchOffers.updatedAt,
        })
        .from(dispatchOffers)
        .innerJoin(technicians, eq(technicians.id, dispatchOffers.technicianId))
        .innerJoin(contractors, eq(contractors.id, dispatchOffers.contractorId))
        .where(eq(dispatchOffers.serviceRequestId, requestId))
        .orderBy(desc(dispatchOffers.createdAt));

      return reply.code(200).send({ offers });
    },
  );

  app.get(
    "/v1/dispatch/offers/incoming",
    { preHandler: authenticate },
    async (request, reply) => {
      const now = new Date();

      // Find active offers for contractor or technician
      const offers = await db
        .select({
          id: dispatchOffers.id,
          serviceRequestId: dispatchOffers.serviceRequestId,
          technicianId: dispatchOffers.technicianId,
          technicianName: technicians.displayName,
          contractorId: dispatchOffers.contractorId,
          contractorName: contractors.name,
          slotHoldId: dispatchOffers.slotHoldId,
          status: dispatchOffers.status,
          offeredAt: dispatchOffers.offeredAt,
          expiresAt: dispatchOffers.expiresAt,
          description: serviceRequests.description,
          urgency: serviceRequests.urgency,
          postalCode: properties.postalCode,
          region: properties.region,
          slotStartsAt: dispatchSlotHolds.slotStartsAt,
          slotEndsAt: dispatchSlotHolds.slotEndsAt,
        })
        .from(dispatchOffers)
        .innerJoin(technicians, eq(technicians.id, dispatchOffers.technicianId))
        .innerJoin(contractors, eq(contractors.id, dispatchOffers.contractorId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, dispatchOffers.serviceRequestId))
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .leftJoin(dispatchSlotHolds, eq(dispatchSlotHolds.id, dispatchOffers.slotHoldId))
        .where(
          and(
            eq(dispatchOffers.status, "OFFERED"),
            gt(dispatchOffers.expiresAt, now),
          ),
        )
        .orderBy(desc(dispatchOffers.createdAt));

      return reply.code(200).send({ offers });
    },
  );

  app.post(
    "/v1/dispatch/offers/:offerId/respond",
    { preHandler: authenticate },
    async (request, reply) => {
      const { offerId } = parse(z.object({ offerId: uuid }), request.params);
      const body = parse(respondDispatchOfferSchema, request.body);

      const result = await db.transaction(async (tx) => {
        const [offer] = await tx
          .select()
          .from(dispatchOffers)
          .where(eq(dispatchOffers.id, offerId))
          .for("update");

        if (!offer) {
          throw new Error("NOT_FOUND");
        }

        if (offer.status !== "OFFERED") {
          const err = new Error(`Offer is no longer active (status: ${offer.status})`);
          (err as any).statusCode = 409;
          throw err;
        }

        const now = new Date();
        if (offer.expiresAt.getTime() <= now.getTime()) {
          await tx
            .update(dispatchOffers)
            .set({ status: "TIMED_OUT", updatedAt: now })
            .where(eq(dispatchOffers.id, offerId));

          if (offer.slotHoldId) {
            await tx
              .update(dispatchSlotHolds)
              .set({ status: "EXPIRED", updatedAt: now })
              .where(eq(dispatchSlotHolds.id, offer.slotHoldId));
          }

          const err = new Error("Offer has expired.");
          (err as any).statusCode = 410;
          (err as any).code = "OFFER_EXPIRED";
          throw err;
        }

        if (body.action === "ACCEPT") {
          // 1. Confirm hold
          let slotStartsAt: Date | null = null;
          let slotEndsAt: Date | null = null;
          let travelBuffer = 30;

          if (offer.slotHoldId) {
            const [hold] = await tx
              .update(dispatchSlotHolds)
              .set({ status: "CONFIRMED", updatedAt: now })
              .where(eq(dispatchSlotHolds.id, offer.slotHoldId))
              .returning();
            if (hold) {
              slotStartsAt = hold.slotStartsAt;
              slotEndsAt = hold.slotEndsAt;
              travelBuffer = hold.travelBufferMinutes;
            }
          }

          // 2. Mark offer ACCEPTED
          const [acceptedOffer] = await tx
            .update(dispatchOffers)
            .set({
              status: "ACCEPTED",
              respondedAt: now,
              updatedAt: now,
            })
            .where(eq(dispatchOffers.id, offerId))
            .returning();

          // 3. Create or update jobs
          const [existingJob] = await tx
            .select({ id: jobs.id })
            .from(jobs)
            .where(eq(jobs.serviceRequestId, offer.serviceRequestId))
            .limit(1);

          let jobId = existingJob?.id;
          if (!existingJob) {
            const [newJob] = await tx
              .insert(jobs)
              .values({
                serviceRequestId: offer.serviceRequestId,
                contractorId: offer.contractorId,
                technicianId: offer.technicianId,
                status: "ASSIGNED",
                scheduledStartsAt: slotStartsAt,
                scheduledEndsAt: slotEndsAt,
                travelBufferMinutes: travelBuffer,
              })
              .returning();
            jobId = newJob?.id;
          } else {
            await tx
              .update(jobs)
              .set({
                contractorId: offer.contractorId,
                technicianId: offer.technicianId,
                status: "ASSIGNED",
                scheduledStartsAt: slotStartsAt,
                scheduledEndsAt: slotEndsAt,
                travelBufferMinutes: travelBuffer,
                updatedAt: now,
              })
              .where(eq(jobs.id, existingJob.id));
          }

          // 4. Update service request
          await tx
            .update(serviceRequests)
            .set({ status: "ASSIGNED", updatedAt: now })
            .where(eq(serviceRequests.id, offer.serviceRequestId));

          return {
            status: "ACCEPTED",
            offer: acceptedOffer,
            jobId,
            scheduledStartsAt: slotStartsAt?.toISOString(),
            scheduledEndsAt: slotEndsAt?.toISOString(),
          };
        } else {
          // DECLINE
          if (offer.slotHoldId) {
            await tx
              .update(dispatchSlotHolds)
              .set({ status: "RELEASED", updatedAt: now })
              .where(eq(dispatchSlotHolds.id, offer.slotHoldId));
          }

          const [declinedOffer] = await tx
            .update(dispatchOffers)
            .set({
              status: "DECLINED",
              declineReason: body.declineReason ?? "NOT_AVAILABLE",
              declineNotes: body.declineNotes ?? null,
              respondedAt: now,
              updatedAt: now,
            })
            .where(eq(dispatchOffers.id, offerId))
            .returning();

          // Update fallback queue
          await tx
            .insert(dispatchFallbackQueue)
            .values({
              serviceRequestId: offer.serviceRequestId,
              failedOfferCount: 1,
              reason: "DECLINED_BY_ALL",
              status: "PENDING_TRIAGE",
            })
            .onConflictDoUpdate({
              target: [dispatchFallbackQueue.serviceRequestId],
              set: {
                failedOfferCount: sql`${dispatchFallbackQueue.failedOfferCount} + 1`,
                reason: "DECLINED_BY_ALL",
                status: "PENDING_TRIAGE",
                updatedAt: now,
              },
            });

          return {
            status: "DECLINED",
            offer: declinedOffer,
          };
        }
      });

      await audit(
        actor(request).id,
        body.action === "ACCEPT" ? "DISPATCH_OFFER_ACCEPTED" : "DISPATCH_OFFER_DECLINED",
        "DISPATCH_OFFER",
        offerId,
        null,
        { action: body.action, reason: body.declineReason },
      );

      return reply.code(200).send(result);
    },
  );

  app.post(
    "/v1/dispatch/offers/:offerId/timeout",
    { preHandler: authenticate },
    async (request, reply) => {
      const { offerId } = parse(z.object({ offerId: uuid }), request.params);

      const timedOut = await db.transaction(async (tx) => {
        const [offer] = await tx
          .select()
          .from(dispatchOffers)
          .where(eq(dispatchOffers.id, offerId))
          .for("update");

        if (!offer || offer.status !== "OFFERED") {
          return null;
        }

        const now = new Date();
        const [updated] = await tx
          .update(dispatchOffers)
          .set({ status: "TIMED_OUT", updatedAt: now })
          .where(eq(dispatchOffers.id, offerId))
          .returning();

        if (offer.slotHoldId) {
          await tx
            .update(dispatchSlotHolds)
            .set({ status: "EXPIRED", updatedAt: now })
            .where(eq(dispatchSlotHolds.id, offer.slotHoldId));
        }

        await tx
          .insert(dispatchFallbackQueue)
          .values({
            serviceRequestId: offer.serviceRequestId,
            failedOfferCount: 1,
            reason: "TIMED_OUT",
            status: "PENDING_TRIAGE",
          })
          .onConflictDoUpdate({
            target: [dispatchFallbackQueue.serviceRequestId],
            set: {
              failedOfferCount: sql`${dispatchFallbackQueue.failedOfferCount} + 1`,
              reason: "TIMED_OUT",
              status: "PENDING_TRIAGE",
              updatedAt: now,
            },
          });

        return updated;
      });

      if (!timedOut) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Active offer not found" });
      }

      return reply.code(200).send({ status: "TIMED_OUT", offerId });
    },
  );

  // -------------------------------------------------------------------------
  // OPERATIONS FALLBACK QUEUE TRIAGE (SH-06)
  // -------------------------------------------------------------------------

  app.get(
    "/v1/dispatch/fallback-queue",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const items = await db
        .select({
          id: dispatchFallbackQueue.id,
          serviceRequestId: dispatchFallbackQueue.serviceRequestId,
          failedOfferCount: dispatchFallbackQueue.failedOfferCount,
          reason: dispatchFallbackQueue.reason,
          status: dispatchFallbackQueue.status,
          assignedTechnicianId: dispatchFallbackQueue.assignedTechnicianId,
          triagedByUserId: dispatchFallbackQueue.triagedByUserId,
          triagedAt: dispatchFallbackQueue.triagedAt,
          resolutionNotes: dispatchFallbackQueue.resolutionNotes,
          createdAt: dispatchFallbackQueue.createdAt,
          updatedAt: dispatchFallbackQueue.updatedAt,
          description: serviceRequests.description,
          urgency: serviceRequests.urgency,
          postalCode: properties.postalCode,
          region: properties.region,
          verticalName: verticals.name,
          preferredStartsAt: serviceRequests.preferredStartsAt,
          preferredEndsAt: serviceRequests.preferredEndsAt,
        })
        .from(dispatchFallbackQueue)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, dispatchFallbackQueue.serviceRequestId),
        )
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
        .where(
          or(
            eq(dispatchFallbackQueue.status, "PENDING_TRIAGE"),
            eq(dispatchFallbackQueue.status, "RE_DISPATCHED"),
          ),
        )
        .orderBy(desc(dispatchFallbackQueue.createdAt));

      return reply.code(200).send({
        queue: items.map((i) => ({
          id: i.id,
          serviceRequestId: i.serviceRequestId,
          failedOfferCount: i.failedOfferCount,
          reason: i.reason as any,
          status: i.status as any,
          assignedTechnicianId: i.assignedTechnicianId ?? null,
          triagedByUserId: i.triagedByUserId ?? null,
          triagedAt: i.triagedAt ? i.triagedAt.toISOString() : null,
          resolutionNotes: i.resolutionNotes ?? null,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
          serviceRequest: {
            id: i.serviceRequestId,
            description: i.description,
            urgency: i.urgency,
            postalCode: i.postalCode,
            region: i.region,
            verticalName: i.verticalName,
            preferredStartsAt: i.preferredStartsAt ? i.preferredStartsAt.toISOString() : null,
            preferredEndsAt: i.preferredEndsAt ? i.preferredEndsAt.toISOString() : null,
          },
        })),
      });
    },
  );

  app.post(
    "/v1/dispatch/fallback-queue/:requestId/triage",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const { requestId } = parse(z.object({ requestId: uuid }), request.params);
      const body = parse(triageFallbackQueueSchema, request.body);
      const now = new Date();

      const triaged = await db.transaction(async (tx) => {
        if (body.action === "MANUAL_ASSIGN") {
          if (!body.technicianId) {
            const err = new Error("technicianId is required for manual assignment");
            (err as any).statusCode = 400;
            throw err;
          }

          const [tech] = await tx
            .select({ id: technicians.id, contractorId: technicians.contractorId })
            .from(technicians)
            .where(eq(technicians.id, body.technicianId))
            .limit(1);

          if (!tech) {
            throw new Error("Technician not found");
          }

          // Assign job
          const [existingJob] = await tx
            .select({ id: jobs.id })
            .from(jobs)
            .where(eq(jobs.serviceRequestId, requestId))
            .limit(1);

          if (!existingJob) {
            await tx.insert(jobs).values({
              serviceRequestId: requestId,
              contractorId: tech.contractorId,
              technicianId: tech.id,
              status: "ASSIGNED",
              scheduledStartsAt: now,
              scheduledEndsAt: new Date(now.getTime() + 7200000),
            });
          } else {
            await tx
              .update(jobs)
              .set({
                contractorId: tech.contractorId,
                technicianId: tech.id,
                status: "ASSIGNED",
                updatedAt: now,
              })
              .where(eq(jobs.id, existingJob.id));
          }

          await tx
            .update(serviceRequests)
            .set({ status: "ASSIGNED", updatedAt: now })
            .where(eq(serviceRequests.id, requestId));

          const [updatedQueue] = await tx
            .update(dispatchFallbackQueue)
            .set({
              status: "MANUALLY_ASSIGNED",
              assignedTechnicianId: tech.id,
              triagedByUserId: actor(request).id,
              triagedAt: now,
              resolutionNotes: body.resolutionNotes ?? body.overrideReason ?? "Manual ops override",
              updatedAt: now,
            })
            .where(eq(dispatchFallbackQueue.serviceRequestId, requestId))
            .returning();

          return updatedQueue;
        } else if (body.action === "CANCEL") {
          await tx
            .update(serviceRequests)
            .set({ status: "CANCELLED", updatedAt: now })
            .where(eq(serviceRequests.id, requestId));

          const [updatedQueue] = await tx
            .update(dispatchFallbackQueue)
            .set({
              status: "CANCELLED",
              triagedByUserId: actor(request).id,
              triagedAt: now,
              resolutionNotes: body.resolutionNotes ?? "Cancelled by Operations",
              updatedAt: now,
            })
            .where(eq(dispatchFallbackQueue.serviceRequestId, requestId))
            .returning();

          return updatedQueue;
        } else {
          // RE_DISPATCH
          const [updatedQueue] = await tx
            .update(dispatchFallbackQueue)
            .set({
              status: "RE_DISPATCHED",
              triagedByUserId: actor(request).id,
              triagedAt: now,
              resolutionNotes: body.resolutionNotes ?? "Re-dispatch queued",
              updatedAt: now,
            })
            .where(eq(dispatchFallbackQueue.serviceRequestId, requestId))
            .returning();

          return updatedQueue;
        }
      });

      await audit(
        actor(request).id,
        "FALLBACK_QUEUE_TRIAGED",
        "SERVICE_REQUEST",
        requestId,
        null,
        { action: body.action, resolutionNotes: body.resolutionNotes },
      );

      return reply.code(200).send(triaged);
    },
  );
};
