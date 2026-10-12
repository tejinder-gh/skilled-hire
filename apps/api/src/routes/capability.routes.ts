import type { FastifyPluginAsync } from "fastify";
import { hasRole } from "@marketplace/auth";
import type {
  CapabilityAssessmentStatus,
  ContractorCapabilityAssessment,
  WorkSampleRecord,
  ReferenceVerificationRecord,
  ToolEquipmentRecord,
} from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  desc,
  contractorCapabilityAssessments,
  contractors,
  issueTypes,
} from "@marketplace/database";
import {
  appealCapabilityAssessmentSchema,
  createCapabilityAssessmentSchema,
  evaluateCapabilitySchema,
  reviewCapabilityAssessmentSchema,
} from "@marketplace/validation";
import { evaluateContractorCapability } from "@marketplace/vertical-engine";
import { actor, authenticate, isOps, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

export const capabilityRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Submit contractor technical capability assessment for a specific service variant.
   * Scoped to (contractorId, issueTypeId, geography).
   */
  app.post(
    "/v1/capability/assessments",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const body = parse(createCapabilityAssessmentSchema, request.body);
      const geography = body.geography ?? "ON";

      // Resolve target contractor ID with strict tenant isolation
      let targetContractorId: string;
      const isAssessorOrAdmin =
        hasRole(currentActor, "ADMIN", "SUPER_ADMIN") || isOps(currentActor);
      const isContractor = hasRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
      );

      if (isContractor) {
        const ownedContractorId = currentActor.contractorId;
        if (!ownedContractorId) {
          return reply.status(404).send({
            error: "CONTRACTOR_PROFILE_NOT_FOUND",
            message: "No contractor profile found for current user",
          });
        }

        if (body.contractorId && body.contractorId !== ownedContractorId) {
          return reply.status(403).send({
            error: "FORBIDDEN",
            message: "Cross-contractor assessment submission is prohibited",
          });
        }
        targetContractorId = ownedContractorId;
      } else if (isAssessorOrAdmin) {
        if (!body.contractorId) {
          return reply.status(400).send({
            error: "CONTRACTOR_ID_REQUIRED",
            message: "Staff must provide contractorId in submission",
          });
        }
        targetContractorId = body.contractorId;
      } else {
        return reply.status(403).send({
          error: "FORBIDDEN",
          message:
            "Only licensed contractor owners or staff may submit capability assessments",
        });
      }

      // Verify contractor exists
      const contractorRecord = await db
        .select({ id: contractors.id, name: contractors.name })
        .from(contractors)
        .where(eq(contractors.id, targetContractorId))
        .limit(1);

      if (contractorRecord.length === 0 || !contractorRecord[0]) {
        return reply.status(404).send({
          error: "CONTRACTOR_NOT_FOUND",
          message: "Contractor does not exist",
        });
      }

      // Verify issue type exists
      const issueTypeRecord = await db
        .select({ id: issueTypes.id, slug: issueTypes.slug })
        .from(issueTypes)
        .where(eq(issueTypes.id, body.issueTypeId))
        .limit(1);

      if (issueTypeRecord.length === 0 || !issueTypeRecord[0]) {
        return reply.status(404).send({
          error: "ISSUE_TYPE_NOT_FOUND",
          message: "Issue type does not exist",
        });
      }

      // Check existing assessment
      const existing = await db
        .select()
        .from(contractorCapabilityAssessments)
        .where(
          and(
            eq(
              contractorCapabilityAssessments.contractorId,
              targetContractorId,
            ),
            eq(contractorCapabilityAssessments.issueTypeId, body.issueTypeId),
            eq(contractorCapabilityAssessments.geography, geography),
          ),
        )
        .limit(1);

      const now = new Date();

      if (existing.length > 0 && existing[0]) {
        const current = existing[0];
        const activeStatuses: CapabilityAssessmentStatus[] = [
          "APPROVED",
          "PROVISIONAL",
          "SUPERVISED",
          "UNDER_REVIEW",
          "SUBMITTED",
          "APPEALED",
        ];

        if (
          activeStatuses.includes(current.status as CapabilityAssessmentStatus)
        ) {
          return reply.status(409).send({
            error: "ACTIVE_ASSESSMENT_EXISTS",
            message:
              "An active assessment is already on file for this service variant. Submit an appeal or request reassessment.",
            existingAssessmentId: current.id,
            status: current.status,
          });
        }

        // Re-submission over REJECTED, EXPIRED, or REVOKED assessment
        const [updated] = await db
          .update(contractorCapabilityAssessments)
          .set({
            status: "SUBMITTED",
            complexityTier: body.complexityTier,
            yearsExperience: body.yearsExperience,
            maxJobValueCents: body.maxJobValueCents,
            workSamples: body.workSamples as unknown as WorkSampleRecord[],
            references:
              body.references as unknown as ReferenceVerificationRecord[],
            toolsEquipment:
              body.toolsEquipment as unknown as ToolEquipmentRecord[],
            supervisedRequirements: {},
            denialReasons: [],
            assessedByUserId: null,
            assessedAt: null,
            validUntil: null,
            decisionNotes: null,
            updatedAt: now,
          })
          .where(eq(contractorCapabilityAssessments.id, current.id))
          .returning();

        await audit(
          currentActor.id,
          "CAPABILITY_ASSESSMENT_RESUBMITTED",
          "contractor_capability_assessments",
          current.id,
          current,
          updated,
          { contractorId: targetContractorId, issueTypeId: body.issueTypeId },
        );

        return reply.status(200).send(updated);
      }

      // Create fresh assessment
      const [inserted] = await db
        .insert(contractorCapabilityAssessments)
        .values({
          contractorId: targetContractorId,
          issueTypeId: body.issueTypeId,
          geography,
          status: "SUBMITTED",
          complexityTier: body.complexityTier,
          yearsExperience: body.yearsExperience,
          maxJobValueCents: body.maxJobValueCents,
          workSamples: body.workSamples as unknown as WorkSampleRecord[],
          references:
            body.references as unknown as ReferenceVerificationRecord[],
          toolsEquipment:
            body.toolsEquipment as unknown as ToolEquipmentRecord[],
          supervisedRequirements: {},
          denialReasons: [],
          appealHistory: [],
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!inserted) {
        return reply.status(500).send({ error: "FAILED_TO_CREATE_ASSESSMENT" });
      }

      await audit(
        currentActor.id,
        "CAPABILITY_ASSESSMENT_SUBMITTED",
        "contractor_capability_assessments",
        inserted.id,
        null,
        inserted,
        { contractorId: targetContractorId, issueTypeId: body.issueTypeId },
      );

      return reply.status(201).send(inserted);
    },
  );

  /**
   * List assessments with tenant isolation and filtering.
   */
  app.get(
    "/v1/capability/assessments",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const query = request.query as {
        contractorId?: string;
        issueTypeId?: string;
        status?: string;
        geography?: string;
      };

      const isAssessorOrAdmin =
        hasRole(currentActor, "ADMIN", "SUPER_ADMIN") || isOps(currentActor);
      let allowedContractorId: string | null = null;

      if (hasRole(currentActor, "CONTRACTOR_OWNER", "CONTRACTOR_MANAGER")) {
        allowedContractorId = currentActor.contractorId ?? null;
        if (!allowedContractorId) {
          return reply.status(404).send({
            error: "CONTRACTOR_PROFILE_NOT_FOUND",
            message: "No contractor profile found for current user",
          });
        }

        if (query.contractorId && query.contractorId !== allowedContractorId) {
          return reply.status(403).send({
            error: "FORBIDDEN",
            message:
              "Cannot access capability assessments of another contractor",
          });
        }
      } else if (!isAssessorOrAdmin) {
        return reply.status(403).send({
          error: "FORBIDDEN",
          message: "Insufficient permissions to view capability assessments",
        });
      }

      const conditions = [];

      const contractorFilter = allowedContractorId ?? query.contractorId;
      if (contractorFilter) {
        conditions.push(
          eq(contractorCapabilityAssessments.contractorId, contractorFilter),
        );
      }
      if (query.issueTypeId) {
        conditions.push(
          eq(contractorCapabilityAssessments.issueTypeId, query.issueTypeId),
        );
      }
      if (query.status) {
        conditions.push(
          eq(contractorCapabilityAssessments.status, query.status),
        );
      }
      if (query.geography) {
        conditions.push(
          eq(contractorCapabilityAssessments.geography, query.geography),
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const assessments = await db
        .select()
        .from(contractorCapabilityAssessments)
        .where(whereClause)
        .orderBy(desc(contractorCapabilityAssessments.createdAt));

      return { assessments };
    },
  );

  /**
   * Get single capability assessment by ID.
   */
  app.get(
    "/v1/capability/assessments/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const { id } = request.params as { id: string };

      const assessment = await db
        .select()
        .from(contractorCapabilityAssessments)
        .where(eq(contractorCapabilityAssessments.id, id))
        .limit(1);

      if (assessment.length === 0 || !assessment[0]) {
        return reply.status(404).send({
          error: "CAPABILITY_ASSESSMENT_NOT_FOUND",
          message: "Capability assessment not found",
        });
      }

      const record = assessment[0];
      const isAssessorOrAdmin =
        hasRole(currentActor, "ADMIN", "SUPER_ADMIN") || isOps(currentActor);

      if (hasRole(currentActor, "CONTRACTOR_OWNER", "CONTRACTOR_MANAGER")) {
        if (
          !currentActor.contractorId ||
          currentActor.contractorId !== record.contractorId
        ) {
          return reply.status(403).send({
            error: "FORBIDDEN",
            message:
              "Cannot access capability assessment of another contractor",
          });
        }
      } else if (!isAssessorOrAdmin) {
        return reply.status(403).send({
          error: "FORBIDDEN",
          message:
            "Insufficient permissions to view this capability assessment",
        });
      }

      return record;
    },
  );

  /**
   * Qualified assessor review and decision on capability assessment.
   * Supports APPROVED, PROVISIONAL, SUPERVISED, REJECTED, and REVOKED.
   */
  app.post(
    "/v1/capability/assessments/:id/review",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const { id } = request.params as { id: string };

      // Strictly require qualified assessor / admin / ops
      if (
        !hasRole(currentActor, "ADMIN", "SUPER_ADMIN") &&
        !isOps(currentActor)
      ) {
        return reply.status(403).send({
          error: "FORBIDDEN",
          message:
            "Only qualified platform assessors may review capability assessments",
        });
      }

      const body = parse(reviewCapabilityAssessmentSchema, request.body);
      const denialReasons = body.denialReasons ?? [];
      const verifiedWorkSampleIds = body.verifiedWorkSampleIds ?? [];
      const verifiedReferenceIds = body.verifiedReferenceIds ?? [];
      const verifiedToolNames = body.verifiedToolNames ?? [];

      const existing = await db
        .select()
        .from(contractorCapabilityAssessments)
        .where(eq(contractorCapabilityAssessments.id, id))
        .limit(1);

      if (existing.length === 0 || !existing[0]) {
        return reply.status(404).send({
          error: "CAPABILITY_ASSESSMENT_NOT_FOUND",
          message: "Capability assessment not found",
        });
      }

      const current = existing[0];
      const now = new Date();

      // Rejection or Revocation requires at least one denial reason
      if (
        (body.decision === "REJECTED" || body.decision === "REVOKED") &&
        denialReasons.length === 0
      ) {
        return reply.status(400).send({
          error: "DENIAL_REASONS_REQUIRED",
          message:
            "At least one criteria-based denial reason code is required when rejecting or revoking",
        });
      }

      // Default 1-year validity for approvals
      const validUntilDate =
        body.decision === "REJECTED" || body.decision === "REVOKED"
          ? null
          : body.validUntil
            ? new Date(body.validUntil)
            : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      // Update verification flags on work samples, references, tools
      const currentWorkSamples =
        (current.workSamples as WorkSampleRecord[]) || [];
      const updatedWorkSamples = currentWorkSamples.map((sample) => {
        if (verifiedWorkSampleIds.includes(sample.id)) {
          return { ...sample, verified: true, verifiedAt: now.toISOString() };
        }
        return sample;
      });

      const currentReferences =
        (current.references as ReferenceVerificationRecord[]) || [];
      const updatedReferences = currentReferences.map((ref) => {
        if (verifiedReferenceIds.includes(ref.id)) {
          return { ...ref, verified: true, verifiedAt: now.toISOString() };
        }
        return ref;
      });

      const currentTools =
        (current.toolsEquipment as ToolEquipmentRecord[]) || [];
      const updatedTools = currentTools.map((tool) => {
        if (verifiedToolNames.includes(tool.toolName)) {
          return { ...tool, verified: true };
        }
        return tool;
      });

      const [updated] = await db
        .update(contractorCapabilityAssessments)
        .set({
          status: body.decision,
          complexityTier: body.complexityTier ?? current.complexityTier,
          maxJobValueCents: body.maxJobValueCents ?? current.maxJobValueCents,
          assessedByUserId: currentActor.id,
          assessedAt: now,
          validUntil: validUntilDate,
          supervisedRequirements: (body.supervisedRequirements ??
            current.supervisedRequirements) as any,
          denialReasons: denialReasons as any,
          decisionNotes: body.decisionNotes ?? current.decisionNotes,
          workSamples: updatedWorkSamples as any,
          references: updatedReferences as any,
          toolsEquipment: updatedTools as any,
          updatedAt: now,
        })
        .where(eq(contractorCapabilityAssessments.id, id))
        .returning();

      await audit(
        currentActor.id,
        "CAPABILITY_ASSESSMENT_REVIEWED",
        "contractor_capability_assessments",
        id,
        current,
        updated,
        {
          decision: body.decision,
          complexityTier: updated?.complexityTier,
          assessedBy: currentActor.id,
        },
      );

      return reply.status(200).send(updated);
    },
  );

  /**
   * Contractor appeal against REJECTED, REVOKED, or SUPERVISED assessment.
   */
  app.post(
    "/v1/capability/assessments/:id/appeal",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const { id } = request.params as { id: string };

      const body = parse(appealCapabilityAssessmentSchema, request.body);
      const additionalWorkSamples = body.additionalWorkSamples ?? [];
      const additionalReferences = body.additionalReferences ?? [];

      const existing = await db
        .select()
        .from(contractorCapabilityAssessments)
        .where(eq(contractorCapabilityAssessments.id, id))
        .limit(1);

      if (existing.length === 0 || !existing[0]) {
        return reply.status(404).send({
          error: "CAPABILITY_ASSESSMENT_NOT_FOUND",
          message: "Capability assessment not found",
        });
      }

      const current = existing[0];
      const isAssessorOrAdmin =
        hasRole(currentActor, "ADMIN", "SUPER_ADMIN") || isOps(currentActor);

      // Tenant check
      if (hasRole(currentActor, "CONTRACTOR_OWNER", "CONTRACTOR_MANAGER")) {
        if (
          !currentActor.contractorId ||
          currentActor.contractorId !== current.contractorId
        ) {
          return reply.status(403).send({
            error: "FORBIDDEN",
            message:
              "Cannot appeal capability assessment of another contractor",
          });
        }
      } else if (!isAssessorOrAdmin) {
        return reply.status(403).send({
          error: "FORBIDDEN",
          message: "Insufficient permissions to submit appeal",
        });
      }

      // Can only appeal non-approved decisions
      const appealableStatuses = ["REJECTED", "REVOKED", "SUPERVISED"];
      if (!appealableStatuses.includes(current.status)) {
        return reply.status(400).send({
          error: "INVALID_APPEAL_STATE",
          message: `Can only appeal assessments with ${appealableStatuses.join(", ")} status`,
        });
      }

      const now = new Date();
      const appealRecord = {
        id: crypto.randomUUID(),
        submittedAt: now.toISOString(),
        appellantUserId: currentActor.id,
        reason: body.reason,
        additionalWorkSamples,
        additionalReferences,
      };

      const currentAppealHistory = (current.appealHistory as any[]) || [];
      const currentWorkSamples = (current.workSamples as any[]) || [];
      const currentReferences = (current.references as any[]) || [];

      const [updated] = await db
        .update(contractorCapabilityAssessments)
        .set({
          status: "APPEALED",
          appealHistory: [...currentAppealHistory, appealRecord] as any,
          workSamples: [...currentWorkSamples, ...additionalWorkSamples] as any,
          references: [...currentReferences, ...additionalReferences] as any,
          updatedAt: now,
        })
        .where(eq(contractorCapabilityAssessments.id, id))
        .returning();

      await audit(
        currentActor.id,
        "CAPABILITY_ASSESSMENT_APPEALED",
        "contractor_capability_assessments",
        id,
        current,
        updated,
        { appellantUserId: currentActor.id, reason: body.reason },
      );

      return reply.status(200).send(updated);
    },
  );

  /**
   * Evaluate contractor technical capability eligibility for a given scope.
   */
  app.post(
    "/v1/capability/evaluate",
    { preHandler: authenticate },
    async (request, reply) => {
      const body = parse(evaluateCapabilitySchema, request.body);
      const geography = body.geography ?? "ON";
      const requiredComplexityTier =
        body.requiredComplexityTier ?? "TIER_1_BASIC";
      const estimatedJobValueCents = body.estimatedJobValueCents ?? 0;

      const record = await db
        .select()
        .from(contractorCapabilityAssessments)
        .where(
          and(
            eq(contractorCapabilityAssessments.contractorId, body.contractorId),
            eq(contractorCapabilityAssessments.issueTypeId, body.issueTypeId),
            eq(contractorCapabilityAssessments.geography, geography),
          ),
        )
        .limit(1);

      const assessment: ContractorCapabilityAssessment | null =
        record.length > 0 && record[0]
          ? {
              id: record[0].id,
              contractorId: record[0].contractorId,
              issueTypeId: record[0].issueTypeId,
              geography: record[0].geography,
              status: record[0].status as CapabilityAssessmentStatus,
              complexityTier: record[0].complexityTier as any,
              yearsExperience: record[0].yearsExperience,
              maxJobValueCents: Number(record[0].maxJobValueCents),
              workSamples: (record[0].workSamples as any) || [],
              references: (record[0].references as any) || [],
              toolsEquipment: (record[0].toolsEquipment as any) || [],
              supervisedRequirements:
                (record[0].supervisedRequirements as any) || null,
              denialReasons: (record[0].denialReasons as any) || [],
              assessedByUserId: record[0].assessedByUserId,
              assessedAt: record[0].assessedAt
                ? record[0].assessedAt.toISOString()
                : null,
              validUntil: record[0].validUntil
                ? record[0].validUntil.toISOString()
                : null,
              decisionNotes: record[0].decisionNotes,
              appealHistory: (record[0].appealHistory as any) || [],
              createdAt: record[0].createdAt.toISOString(),
              updatedAt: record[0].updatedAt.toISOString(),
            }
          : null;

      const evaluation = evaluateContractorCapability({
        assessment,
        requiredComplexityTier,
        estimatedJobValueCents,
      });

      return reply.status(200).send(evaluation);
    },
  );
};
