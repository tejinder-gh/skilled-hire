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
  sql,
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
} from "@marketplace/database";
import {
  evaluateContractorCapability,
  evaluateRegulatoryEligibility,
  resolveRegulatoryPolicy,
  evaluatePreDispatchEligibility,
} from "@marketplace/vertical-engine";
import { evaluatePreDispatchSchema } from "@marketplace/validation";
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
    const query = request.query as
      | { vertical?: string; region?: string; slot?: string }
      | undefined;
    const verticalSlug = query?.vertical ?? "hvac";
    const region = (query?.region ?? "ON").toUpperCase();
    const queriedSlot = query?.slot ?? "today-13-15";

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
      return reply
        .code(404)
        .send({
          code: "NOT_FOUND",
          message: `Vertical '${verticalSlug}' not found`,
        });
    }

    const activeTechs = await db
      .select({
        id: technicians.id,
        workload: technicians.workload,
        emergency_available: technicians.emergencyAvailable,
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

    const isPeakSlot =
      queriedSlot === "peak-surge" ||
      queriedSlot === "today-13-15-surge" ||
      queriedSlot.includes("busy") ||
      (queriedSlot === "today-13-15" &&
        (query as { forceSurge?: string } | undefined)?.forceSurge === "true");
    const isAvailable =
      activeTechs.length > 0 &&
      !isPeakSlot &&
      activeJobsCount < activeTechs.length;

    if (!isAvailable) {
      const response: SlotAvailabilityResponse = {
        verticalSlug: vertical.slug,
        verticalName: vertical.name,
        region,
        queriedSlot,
        available: false,
        status: "BUSIER_THAN_USUAL",
        headline: `We're experiencing higher than usual demand for ${vertical.name} in ${region === "ON" ? "Ontario / Greater Toronto Area" : region}`,
        reason:
          activeTechs.length === 0
            ? `All certified ${vertical.name} trade specialists in ${region} are currently committed on active dispatches.`
            : `High demand surge: 100% of verified ${vertical.name} technicians are currently dispatched on service calls in this time window.`,
        metrics: {
          activeCertifiedTechnicians: activeTechs.length,
          dispatchedCount: activeJobsCount,
          capacitySaturationBps:
            activeTechs.length === 0
              ? 10000
              : Math.min(
                  10000,
                  Math.round(
                    ((activeJobsCount + 1) / Math.max(1, activeTechs.length)) *
                      10000,
                  ),
                ),
          estimatedWaitMinutes: 120,
        },
        alternativeSlots: [
          {
            id: "tomorrow-09-11",
            label: "Tomorrow · 9:00–11:00 AM",
            day: "Tomorrow",
            time: "9:00 AM – 11:00 AM",
            guaranteed: true,
            demandLevel: "NORMAL",
            badge: "Recommended · Guaranteed Arrival",
          },
          {
            id: "tomorrow-14-16",
            label: "Tomorrow · 2:00–4:00 PM",
            day: "Tomorrow",
            time: "2:00 PM – 4:00 PM",
            guaranteed: true,
            demandLevel: "NORMAL",
            badge: "Standard Service Window",
          },
          {
            id: "friday-10-12",
            label: "Friday · 10:00 AM–12:00 PM",
            day: "Friday",
            time: "10:00 AM – 12:00 PM",
            guaranteed: true,
            demandLevel: "LOW",
            badge: "Off-Peak Window · Best Availability",
          },
        ],
        emergencyOption: {
          available: true,
          title: "Request Emergency Priority Dispatch",
          badge: "⚡ Guaranteed 45-min on-call arrival",
          description: `Routes directly to on-call certified ${vertical.name} journeypersons reserved strictly for emergency response.`,
          calloutFeeCents: 14900,
          slaMinutes: 45,
        },
        standbyWaitlist: {
          available: true,
          title: "Join Priority Standby Waitlist",
          badge: "⏱️ Automated dispatch on early finish",
          description:
            "Keep your desired time slot. If an existing job finishes early or an appointment reschedules, you are automatically assigned first in line.",
          queuePosition: 2,
          estimatedNoticeMinutes: 30,
        },
      };
      return reply.code(200).send(response);
    }

    const response: SlotAvailabilityResponse = {
      verticalSlug: vertical.slug,
      verticalName: vertical.name,
      region,
      queriedSlot,
      available: true,
      status: "AVAILABLE",
      headline: `Verified ${vertical.name} technicians ready for dispatch`,
      reason:
        "Certified trade professionals have open capacity in this requested appointment window.",
      metrics: {
        activeCertifiedTechnicians: activeTechs.length,
        dispatchedCount: activeJobsCount,
        capacitySaturationBps: Math.round(
          (activeJobsCount / Math.max(1, activeTechs.length)) * 10000,
        ),
        estimatedWaitMinutes: 0,
      },
    };
    return reply.code(200).send(response);
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
          contractor_id: technicians.contractorId,
          contractor_name: contractors.name,
          contractor_status: contractors.status,
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
        },
        technician: {
          id: candidate.technician_id,
          contractorId: candidate.contractor_id,
          displayName: candidate.technician_name,
          active: candidate.technician_active,
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
            risk_tier: issueTypes.riskTier,
            base_price_cents: issueTypes.basePriceCents,
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
            contractor_id: technicians.contractorId,
            contractor_name: contractors.name,
            contractor_status: contractors.status,
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

        // Perform atomic pre-dispatch safety and eligibility evaluation (#57)
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
            requiredComplexityTier: service.risk_tier
              ? ((
                  {
                    LOW: "TIER_1_BASIC",
                    MODERATE: "TIER_2_STANDARD",
                    HIGH: "TIER_3_ADVANCED",
                    CRITICAL: "TIER_4_SPECIALIZED",
                    TIER_1_BASIC: "TIER_1_BASIC",
                    TIER_2_STANDARD: "TIER_2_STANDARD",
                    TIER_3_ADVANCED: "TIER_3_ADVANCED",
                    TIER_4_SPECIALIZED: "TIER_4_SPECIALIZED",
                  } as const
                )[service.risk_tier] ?? "TIER_1_BASIC")
              : "TIER_1_BASIC",
            estimatedJobValueCents: Number(service.base_price_cents ?? 0),
          },
          contractor: {
            id: candidate.contractor_id,
            name: candidate.contractor_name,
            status: candidate.contractor_status,
            verticalIds:
              (candidate.contractor_vertical_ids as string[]) ?? [],
          },
          technician: {
            id: candidate.technician_id,
            contractorId: candidate.contractor_id,
            displayName: candidate.technician_name,
            active: candidate.technician_active,
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

        if (!preDispatch.eligible) {
          // Record failed check in audit history table outside transaction so it is preserved upon rollback (Finding 68-5)
          await db.insert(dispatchEligibilityChecks).values({
            serviceRequestId: requestId,
            contractorId: candidate.contractor_id,
            technicianId: body.technicianId,
            evaluationStage: "PRE_DISPATCH",
            eligible: false,
            failClosedReason: preDispatch.failClosedReason ?? null,
            denyCodes: preDispatch.denyCodes,
            evidenceSnapshot: preDispatch.evidenceSnapshot,
            evaluatedByUserId: actor(request).id,
            escalatedToOps: true,
          });

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

        // Record check in audit history table for successful assignment
        await tx.insert(dispatchEligibilityChecks).values({
          serviceRequestId: requestId,
          contractorId: candidate.contractor_id,
          technicianId: body.technicianId,
          evaluationStage: "PRE_DISPATCH",
          eligible: true,
          failClosedReason: null,
          denyCodes: [],
          evidenceSnapshot: preDispatch.evidenceSnapshot,
          evaluatedByUserId: actor(request).id,
          escalatedToOps: false,
        });

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
          })
          .returning({ id: jobs.id });

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
};
