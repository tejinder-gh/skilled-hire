import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole, hasRole } from "@marketplace/auth";
import type {
  ComplianceStandard,
  EntityLevel,
} from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  or,
  inArray,
  asc,
  desc,
  sql,
  credentialGroups,
  complianceStandards,
  complianceEvaluations,
  tradeRegulatoryPolicies,
  credentials,
  contractors,
  technicians,
  verticals,
} from "@marketplace/database";
import {
  CREDENTIAL_GROUPS,
  DEFAULT_COMPLIANCE_STANDARDS,
  evaluateCompliance,
  evaluateRegulatoryEligibility,
  filterComplianceStandards,
  resolveRegulatoryPolicy,
} from "@marketplace/vertical-engine";
import {
  evaluateComplianceSchema,
  submitCredentialSchema,
} from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const complianceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/compliance/groups", async () => {
    try {
      const result = await db
        .select({
          code: credentialGroups.code,
          name: credentialGroups.name,
          description: credentialGroups.description,
          displayOrder: credentialGroups.displayOrder,
          icon: credentialGroups.icon,
        })
        .from(credentialGroups)
        .orderBy(asc(credentialGroups.displayOrder));

      if (result.length) {
        return result.map((r) => ({
          code: r.code,
          name: r.name,
          description: r.description,
          displayOrder: r.displayOrder,
          icon: r.icon,
        }));
      }
    } catch {
      /* Fall back to in-memory groups */
    }
    return CREDENTIAL_GROUPS;
  });

  app.get("/v1/compliance/standards", async (request) => {
    const querySchema = z.object({
      vertical: z.string().default("*"),
      geography: z.string().default("*"),
      entityLevel: z.enum(["CONTRACTOR", "TECHNICIAN", "EITHER"]).optional(),
    });
    const q = querySchema.parse(request.query);
    try {
      const stdWhere = [eq(complianceStandards.active, true)];
      if (q.vertical !== "*") {
        stdWhere.push(
          or(
            eq(complianceStandards.verticalSlug, "*"),
            sql`lower(${complianceStandards.verticalSlug}) = lower(${q.vertical})`,
          )!,
        );
      }
      if (q.geography !== "*") {
        stdWhere.push(
          or(
            eq(complianceStandards.geography, "*"),
            sql`upper(${complianceStandards.geography}) = upper(${q.geography})`,
          )!,
        );
      }
      if (q.entityLevel && q.entityLevel !== "EITHER") {
        stdWhere.push(
          or(
            eq(complianceStandards.entityLevel, "EITHER"),
            eq(complianceStandards.entityLevel, q.entityLevel),
          )!,
        );
      }

      const result = await db
        .select()
        .from(complianceStandards)
        .where(and(...stdWhere))
        .orderBy(
          asc(complianceStandards.groupCode),
          desc(complianceStandards.requirementLevel),
          asc(complianceStandards.name),
        );

      if (result.length) {
        return result.map(
          (r): ComplianceStandard => ({
            id: r.id,
            groupCode: r.groupCode as any,
            credentialCode: r.credentialCode,
            name: r.name,
            description: r.description,
            verticalSlug: r.verticalSlug,
            geography: r.geography,
            entityLevel: r.entityLevel as EntityLevel,
            requirementLevel: r.requirementLevel as any,
            issuingAuthority: r.issuingAuthority,
            legalReference: r.legalReference ?? undefined,
            verificationMethod: r.verificationMethod as any,
            validityPeriodMonths: r.validityPeriodMonths,
            active: r.active,
          }),
        );
      }
    } catch {
      /* Fall back to built-in catalog */
    }
    return filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      q.vertical,
      q.geography,
      q.entityLevel,
    );
  });

  app.post("/v1/compliance/evaluate", async (request, reply) => {
    const body = parse(evaluateComplianceSchema, request.body);
    const applicable = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      body.verticalSlug,
      body.geography,
      body.entityLevel,
    );
    const scorecard = evaluateCompliance(applicable, body.credentials ?? [], {
      verticalSlug: body.verticalSlug,
      geography: body.geography,
      entityLevel: body.entityLevel,
    });
    let breakdowns: { contractor: unknown; technician: unknown } | undefined;
    if (!body.entityLevel || body.entityLevel === "EITHER") {
      const contractorStandards = filterComplianceStandards(
        DEFAULT_COMPLIANCE_STANDARDS,
        body.verticalSlug,
        body.geography,
        "CONTRACTOR",
      );
      const techStandards = filterComplianceStandards(
        DEFAULT_COMPLIANCE_STANDARDS,
        body.verticalSlug,
        body.geography,
        "TECHNICIAN",
      );
      breakdowns = {
        contractor: evaluateCompliance(
          contractorStandards,
          body.credentials ?? [],
          { ...body, entityLevel: "CONTRACTOR" },
        ),
        technician: evaluateCompliance(techStandards, body.credentials ?? [], {
          ...body,
          entityLevel: "TECHNICIAN",
        }),
      };
    }
    try {
      await db.insert(complianceEvaluations).values({
        verticalSlug: body.verticalSlug,
        geography: body.geography,
        overallStatus: scorecard.overallStatus,
        scoreBps: scorecard.scoreBps,
        summary: scorecard,
      });
    } catch {
      /* Evaluation log table non-blocking */
    }
    return reply
      .code(200)
      .send({ ...scorecard, ...(breakdowns ? { breakdowns } : {}) });
  });

  // Trade Regulatory Policies Matrix (Ticket #55)
  app.get("/v1/compliance/policy/matrix", async (request) => {
    const querySchema = z.object({
      geography: z.string().default("ON"),
      vertical: z.string().optional(),
    });
    const q = querySchema.parse(request.query);
    const polWhere = [eq(tradeRegulatoryPolicies.active, true)];
    if (q.geography !== "*") {
      polWhere.push(eq(tradeRegulatoryPolicies.geography, q.geography));
    }
    if (q.vertical) {
      polWhere.push(eq(tradeRegulatoryPolicies.verticalSlug, q.vertical));
    }

    const rows = await db
      .select()
      .from(tradeRegulatoryPolicies)
      .where(and(...polWhere))
      .orderBy(
        asc(tradeRegulatoryPolicies.verticalSlug),
        desc(tradeRegulatoryPolicies.policyVersion),
      );

    return {
      geography: q.geography,
      policies: rows.map((r) => ({
        id: r.id,
        verticalSlug: r.verticalSlug,
        categorySlug: r.categorySlug,
        variantSlug: r.variantSlug,
        geography: r.geography,
        policyVersion: r.policyVersion,
        contractorMandatoryCodes:
          (r.contractorMandatoryCodes as string[]) ?? [],
        technicianMandatoryCodes:
          (r.technicianMandatoryCodes as string[]) ?? [],
        apprenticeEligible: r.apprenticeEligible,
        supervisorRatio: r.supervisorRatio,
        permitRequired: r.permitRequired,
        inspectionAuthority: r.inspectionAuthority,
        legalAuthorityDisclaimer: r.legalAuthorityDisclaimer,
        active: r.active,
      })),
    };
  });

  // Authoritative Credential Verification (Ticket #55)
  app.post(
    "/v1/compliance/verify-credential",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT");
      const body = parse(
        z.object({
          credentialId: uuid,
          verificationSource: z.enum(["MANUAL_AUDIT", "REGULATOR_API"]),
          regulatorReference: z.string().trim().min(3),
          status: z.enum(["VERIFIED", "REJECTED", "EXPIRED", "SUSPENDED"]),
          limitations: z.string().optional(),
          auditorNotes: z.string().optional(),
        }),
        request.body,
      );

      const [existing] = await db
        .select()
        .from(credentials)
        .where(eq(credentials.id, body.credentialId))
        .limit(1);

      if (!existing) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Credential not found" });
      }

      const [cred] = await db
        .update(credentials)
        .set({
          status: body.status,
          verificationSource: body.verificationSource,
          regulatorReference: body.regulatorReference,
          verifiedByUserId: actor(request).id,
          checkedAt: new Date(),
          verifiedAt: body.status === "VERIFIED" ? new Date() : null,
          limitations: body.limitations ?? null,
          auditorNotes: body.auditorNotes ?? null,
        })
        .where(eq(credentials.id, body.credentialId))
        .returning();

      await audit(
        actor(request).id,
        "CREDENTIAL_VERIFIED",
        "CREDENTIAL",
        body.credentialId,
        existing,
        cred,
        {
          verificationSource: body.verificationSource,
          regulatorReference: body.regulatorReference,
        },
      );

      return {
        credential: {
          id: cred?.id,
          contractorId: cred?.contractorId,
          technicianId: cred?.technicianId,
          code: cred?.code,
          geography: cred?.geography,
          status: cred?.status,
          verificationSource: cred?.verificationSource,
          regulatorReference: cred?.regulatorReference,
          verifiedByUserId: cred?.verifiedByUserId,
          checkedAt: cred?.checkedAt ? cred.checkedAt.toISOString() : null,
          verifiedAt: cred?.verifiedAt ? cred.verifiedAt.toISOString() : null,
          expiryDate: cred?.expiryDate ?? null,
          limitations: cred?.limitations,
          auditorNotes: cred?.auditorNotes,
        },
      };
    },
  );

  // Trade-Specific Regulatory Eligibility Dispatch Check (Ticket #55)
  app.post(
    "/v1/compliance/eligibility-check",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const body = parse(
        z.object({
          verticalSlug: z.string(),
          categorySlug: z.string().optional(),
          variantSlug: z.string().optional(),
          geography: z.string().default("ON"),
          contractorId: uuid,
          technicianId: uuid,
          isApprentice: z.boolean().default(false),
          supervisorTechnicianId: uuid.optional(),
        }),
        request.body,
      );

      // Enforce role / tenancy authorization
      const isOwner = currentActor.contractorId === body.contractorId;
      if (!isOwner && !isOps(currentActor)) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message:
            "Not permitted to inspect regulatory eligibility for this contractor",
        });
      }

      // Verify contractor exists
      const [contractorRec] = await db
        .select({ id: contractors.id })
        .from(contractors)
        .where(eq(contractors.id, body.contractorId))
        .limit(1);

      if (!contractorRec) {
        return reply.code(404).send({
          code: "CONTRACTOR_NOT_FOUND",
          message: "Contractor not found",
        });
      }

      // Verify technician exists and belongs to the specified contractor
      const [technicianRec] = await db
        .select({ id: technicians.id, contractorId: technicians.contractorId })
        .from(technicians)
        .where(eq(technicians.id, body.technicianId))
        .limit(1);

      if (!technicianRec) {
        return reply.code(404).send({
          code: "TECHNICIAN_NOT_FOUND",
          message: "Technician not found",
        });
      }

      if (technicianRec.contractorId !== body.contractorId) {
        return reply.code(422).send({
          code: "CONTRACTOR_TECHNICIAN_MISMATCH",
          message: "Technician does not belong to the specified contractor",
        });
      }

      // Verify supervisor technician if provided
      let supervisorCreds: any[] = [];
      if (body.supervisorTechnicianId) {
        const [supRec] = await db
          .select({
            id: technicians.id,
            contractorId: technicians.contractorId,
          })
          .from(technicians)
          .where(eq(technicians.id, body.supervisorTechnicianId))
          .limit(1);

        if (!supRec || supRec.contractorId !== body.contractorId) {
          return reply.code(422).send({
            code: "CONTRACTOR_TECHNICIAN_MISMATCH",
            message:
              "Supervisor technician does not belong to the specified contractor",
          });
        }

        const supRows = await db
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
          .where(eq(credentials.technicianId, body.supervisorTechnicianId));

        supervisorCreds = supRows.map((c) => ({
          id: c.id,
          code: c.code,
          geography: c.geography,
          status: c.status,
          verificationSource: c.verificationSource as any,
          regulatorReference: c.regulatorReference ?? null,
          expiryDate: c.expiryDate ?? null,
          checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
        }));
      }

      const geography = body.geography ?? "ON";

      const policyRows = await db
        .select()
        .from(tradeRegulatoryPolicies)
        .where(
          and(
            eq(tradeRegulatoryPolicies.verticalSlug, body.verticalSlug),
            eq(tradeRegulatoryPolicies.geography, geography),
            eq(tradeRegulatoryPolicies.active, true),
          ),
        );

      const resolvedPolicy = resolveRegulatoryPolicy(
        policyRows.map((p) => ({
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
          verticalSlug: body.verticalSlug,
          categorySlug: body.categorySlug,
          variantSlug: body.variantSlug,
          geography,
        },
      );

      if (!resolvedPolicy) {
        return reply.code(404).send({
          code: "POLICY_NOT_FOUND",
          message: `No active regulatory policy found for ${body.verticalSlug} in ${geography}`,
        });
      }

      const contractorCreds = await db
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
        .where(eq(credentials.contractorId, body.contractorId));

      const technicianCreds = await db
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

      const cCreds = contractorCreds.map((c) => ({
        id: c.id,
        code: c.code,
        geography: c.geography,
        status: c.status,
        verificationSource: c.verificationSource as any,
        regulatorReference: c.regulatorReference ?? null,
        expiryDate: c.expiryDate ?? null,
        checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
      }));

      const tCreds = technicianCreds.map((c) => ({
        id: c.id,
        code: c.code,
        geography: c.geography,
        status: c.status,
        verificationSource: c.verificationSource as any,
        regulatorReference: c.regulatorReference ?? null,
        expiryDate: c.expiryDate ?? null,
        checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
      }));

      const eligibility = evaluateRegulatoryEligibility({
        policy: resolvedPolicy,
        contractorCredentials: cCreds,
        technicianCredentials: tCreds,
        isApprentice: body.isApprentice,
        supervisorCredentials: supervisorCreds,
      });

      return reply.code(200).send(eligibility);
    },
  );

  app.get(
    "/v1/contractors/:id/compliance",
    { preHandler: authenticate },
    async (request, reply) => {
      const contractorId = parse(z.object({ id: uuid }), request.params).id;
      const isOwner = actor(request).contractorId === contractorId;
      if (!isOwner && !isOps(actor(request)))
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted" });

      const [contractor] = await db
        .select({
          name: contractors.name,
          service_areas: contractors.serviceAreas,
          vertical_ids: contractors.verticalIds,
        })
        .from(contractors)
        .where(eq(contractors.id, contractorId))
        .limit(1);

      if (!contractor)
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Contractor not found" });

      const techSubquery = db
        .select({ id: technicians.id })
        .from(technicians)
        .where(eq(technicians.contractorId, contractorId));

      const credRows = await db
        .select({
          code: credentials.code,
          geography: credentials.geography,
          status: credentials.status,
          expiry_date: credentials.expiryDate,
          document_key: credentials.documentKey,
        })
        .from(credentials)
        .where(
          or(
            eq(credentials.contractorId, contractorId),
            inArray(credentials.technicianId, techSubquery),
          ),
        );

      const regions = (
        Array.isArray(contractor.service_areas)
          ? contractor.service_areas
          : ["ON"]
      ) as string[];
      const geography = regions[0] ?? "ON";
      const query = request.query as
        | { vertical?: string; entityLevel?: EntityLevel }
        | undefined;
      const queryVertical = query?.vertical;
      let verticalSlug = queryVertical ?? "hvac";
      if (
        !queryVertical &&
        Array.isArray(contractor.vertical_ids) &&
        contractor.vertical_ids.length > 0
      ) {
        const [vRow] = await db
          .select({ slug: verticals.slug })
          .from(verticals)
          .where(eq(verticals.id, contractor.vertical_ids[0] as string))
          .limit(1);
        if (vRow?.slug) verticalSlug = vRow.slug;
      }
      const entityLevel = query?.entityLevel;
      const applicable = filterComplianceStandards(
        DEFAULT_COMPLIANCE_STANDARDS,
        verticalSlug,
        geography,
        entityLevel,
      );
      const creds = credRows.map((c) => ({
        code: c.code,
        geography: c.geography,
        status: c.status,
        expiryDate: c.expiry_date,
        documentKey: c.document_key,
      }));
      const scorecard = evaluateCompliance(applicable, creds, {
        verticalSlug,
        geography,
        entityLevel,
      });
      const contractorStandards = filterComplianceStandards(
        DEFAULT_COMPLIANCE_STANDARDS,
        verticalSlug,
        geography,
        "CONTRACTOR",
      );
      const techStandards = filterComplianceStandards(
        DEFAULT_COMPLIANCE_STANDARDS,
        verticalSlug,
        geography,
        "TECHNICIAN",
      );
      const breakdowns = {
        contractor: evaluateCompliance(contractorStandards, creds, {
          verticalSlug,
          geography,
          entityLevel: "CONTRACTOR",
        }),
        technician: evaluateCompliance(techStandards, creds, {
          verticalSlug,
          geography,
          entityLevel: "TECHNICIAN",
        }),
      };
      return {
        contractorId,
        contractorName: contractor.name,
        scorecard,
        breakdowns,
      };
    },
  );

  app.post(
    "/v1/credentials/submit",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
        "TECHNICIAN",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const body = parse(submitCredentialSchema, request.body);
      const actorId = currentActor.id;
      let callerContractorId = currentActor.contractorId;
      const isTech = hasRole(currentActor, "TECHNICIAN");
      const isStaff = hasRole(currentActor, "ADMIN", "SUPER_ADMIN");
      const isContractor = hasRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
      );

      // If standalone manager without direct contractorId on actor, resolve contractor context
      if (!callerContractorId && isContractor) {
        const headerId =
          typeof request.headers["x-contractor-id"] === "string"
            ? request.headers["x-contractor-id"]
            : undefined;
        const candidateId = headerId ?? body.contractorId;
        if (candidateId) {
          const [found] = await db
            .select({ id: contractors.id })
            .from(contractors)
            .where(eq(contractors.id, candidateId))
            .limit(1);
          if (found) {
            callerContractorId = found.id;
          }
        } else if (body.technicianId) {
          const [techContractor] = await db
            .select({ contractorId: technicians.contractorId })
            .from(technicians)
            .where(eq(technicians.id, body.technicianId))
            .limit(1);
          if (techContractor) {
            callerContractorId = techContractor.contractorId;
          }
        }
      }

      let targetContractorId: string | null = null;
      let targetTechnicianId: string | null = null;

      if (body.entityType === "CONTRACTOR") {
        if (isTech && !isContractor && !isStaff) {
          return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Technicians cannot submit contractor-level credentials",
          });
        }

        if (isStaff) {
          const desiredContractorId = body.contractorId ?? callerContractorId;
          if (!desiredContractorId) {
            return reply.code(400).send({
              code: "CONTRACTOR_REQUIRED",
              message: "Target contractorId is required for contractor credentials",
            });
          }
          const [contractor] = await db
            .select({ id: contractors.id })
            .from(contractors)
            .where(eq(contractors.id, desiredContractorId))
            .limit(1);
          if (!contractor) {
            return reply.code(404).send({
              code: "CONTRACTOR_NOT_FOUND",
              message: "Target contractor not found",
            });
          }
          targetContractorId = contractor.id;
        } else {
          // CONTRACTOR_OWNER or CONTRACTOR_MANAGER
          if (!callerContractorId) {
            return reply.code(400).send({
              code: "CONTRACTOR_REQUIRED",
              message: "Must belong to a contractor organization",
            });
          }
          if (body.contractorId && body.contractorId !== callerContractorId) {
            return reply.code(403).send({
              code: "FORBIDDEN",
              message: "Cannot submit credentials for another contractor organization",
            });
          }
          targetContractorId = callerContractorId;
        }
      } else {
        // entityType === "TECHNICIAN"
        if (isTech && !isStaff && !isContractor) {
          const [ownTech] = await db
            .select({ id: technicians.id, contractorId: technicians.contractorId })
            .from(technicians)
            .where(eq(technicians.userId, actorId))
            .limit(1);

          if (!ownTech) {
            return reply.code(404).send({
              code: "TECHNICIAN_NOT_FOUND",
              message: "No technician profile linked to current user",
            });
          }

          if (body.technicianId && body.technicianId !== ownTech.id) {
            return reply.code(403).send({
              code: "FORBIDDEN",
              message: "Technicians may only submit credentials for their own profile",
            });
          }

          targetTechnicianId = ownTech.id;
        } else if (isStaff) {
          if (!body.technicianId) {
            return reply.code(400).send({
              code: "TECHNICIAN_ID_REQUIRED",
              message: "technicianId is required for technician credential submission",
            });
          }
          const [targetTech] = await db
            .select({ id: technicians.id, contractorId: technicians.contractorId })
            .from(technicians)
            .where(eq(technicians.id, body.technicianId))
            .limit(1);

          if (!targetTech) {
            return reply.code(404).send({
              code: "TECHNICIAN_NOT_FOUND",
              message: "Target technician not found",
            });
          }

          targetTechnicianId = targetTech.id;
        } else {
          // CONTRACTOR_OWNER or CONTRACTOR_MANAGER
          if (!callerContractorId) {
            return reply.code(400).send({
              code: "CONTRACTOR_REQUIRED",
              message: "Must belong to a contractor organization",
            });
          }
          if (!body.technicianId) {
            return reply.code(400).send({
              code: "TECHNICIAN_ID_REQUIRED",
              message: "technicianId is required when contractor submits technician credentials",
            });
          }
          const [targetTech] = await db
            .select({ id: technicians.id, contractorId: technicians.contractorId })
            .from(technicians)
            .where(eq(technicians.id, body.technicianId))
            .limit(1);

          if (!targetTech) {
            return reply.code(404).send({
              code: "TECHNICIAN_NOT_FOUND",
              message: "Target technician not found",
            });
          }

          if (targetTech.contractorId !== callerContractorId) {
            return reply.code(403).send({
              code: "FORBIDDEN",
              message: "Technician does not belong to your contractor organization",
            });
          }

          targetTechnicianId = targetTech.id;
        }
      }

      const [inserted] = await db
        .insert(credentials)
        .values({
          contractorId: targetContractorId,
          technicianId: targetTechnicianId,
          code: body.code,
          geography: body.geography,
          status: "PENDING",
          expiryDate: body.expiryDate ?? null,
          documentKey: body.documentKey,
        })
        .returning({ id: credentials.id });

      const credId = inserted?.id;
      if (!credId) throw new Error("INSERT_FAILED");

      await audit(
        actorId,
        "CREDENTIAL_SUBMITTED",
        "CREDENTIAL",
        credId,
        null,
        {
          ...body,
          targetContractorId,
          targetTechnicianId,
        },
        {
          isStaffOverride: isStaff,
        },
      );

      return reply.code(201).send({ id: credId, status: "PENDING" });
    },
  );
};
