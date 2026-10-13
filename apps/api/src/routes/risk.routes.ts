import type { FastifyPluginAsync } from "fastify";
import { hasRole, requireRole } from "@marketplace/auth";
import type {
  JobRiskAssessment,
  MandatoryControlItem,
  ManualApprovalStatus,
  RiskPolicy,
  RiskTier,
} from "@marketplace/contracts";
import {
  db,
  eq,
  ne,
  and,
  desc,
  jobs,
  riskPolicies,
  jobRiskAssessments,
  properties,
  serviceRequests,
  serviceCategories,
  issueTypes,
  verticals,
  contractors,
  technicians,
  users,
} from "@marketplace/database";
import {
  assessJobRiskSchema,
  createRiskPolicySchema,
  fulfillMandatoryControlSchema,
  reviewJobRiskAssessmentSchema,
  uuid,
} from "@marketplace/validation";
import { evaluateJobRisk } from "@marketplace/vertical-engine";
import { z } from "zod";
import { actor, authenticate, isOps, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

function toJobRiskAssessment(
  row: typeof jobRiskAssessments.$inferSelect,
): JobRiskAssessment {
  return {
    id: row.id,
    jobId: row.jobId ?? null,
    serviceRequestId: row.serviceRequestId ?? null,
    policyId: row.policyId,
    policyVersion: row.policyVersion,
    inherentScore: row.inherentScore,
    mitigationsScore: row.mitigationsScore,
    residualScore: row.residualScore,
    riskTier: row.riskTier as RiskTier,
    hazardFlags: (row.hazardFlags as unknown as JobRiskAssessment["hazardFlags"]) ?? [],
    mandatoryControls:
      (row.mandatoryControls as unknown as MandatoryControlItem[]) ?? [],
    verifiedControls:
      (row.verifiedControls as unknown as MandatoryControlItem[]) ?? [],
    decisionLog:
      (row.decisionLog as unknown as JobRiskAssessment["decisionLog"]) ?? {
        baseScore: 0,
        complexityAdjustment: 0,
        valueAdjustment: 0,
        hazardFlagAdjustments: [],
        totalInherent: row.inherentScore,
        mitigationsApplied: [],
        totalMitigations: row.mitigationsScore,
        residualScore: row.residualScore,
        calculatedTier: row.riskTier as RiskTier,
        redFlagTriggered: false,
        triggerReasons: [],
        mandatoryControlsMandated: [],
      },
    requiresManualApproval: row.requiresManualApproval,
    manualApprovalStatus: row.manualApprovalStatus as ManualApprovalStatus,
    manualApprovedByUserId: row.manualApprovedByUserId,
    manualApprovedAt: row.manualApprovedAt?.toISOString() ?? null,
    manualApprovalNotes: row.manualApprovalNotes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const riskRoutes: FastifyPluginAsync = async (app) => {
  /**
   * 1. Create or Version a Risk Policy (Admin / Ops only)
   */
  app.post(
    "/v1/risk/policies",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT");

      const body = parse(createRiskPolicySchema, request.body);

      // Create new policy and switch active flag atomically in a transaction
      const policy = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(riskPolicies)
          .values({
            version: body.version,
            name: body.name,
            isActive: true,
            dimensionsConfig: body.dimensionsConfig,
            hazardFlagRules: body.hazardFlagRules,
            tierThresholds: body.tierThresholds,
            mandatoryControlsConfig: body.mandatoryControlsConfig,
            calibrationNotes: body.calibrationNotes ?? null,
            provenanceAudit: {
              createdByUser: currentActor.id,
              timestamp: new Date().toISOString(),
            },
          })
          .returning();

        if (!inserted) {
          throw new Error("POLICY_CREATION_FAILED");
        }

        // Deactivate previous active policies
        await tx
          .update(riskPolicies)
          .set({ isActive: false })
          .where(
            and(
              eq(riskPolicies.isActive, true),
              ne(riskPolicies.id, inserted.id),
            ),
          );

        return inserted;
      });

      if (!policy) {
        return reply.status(500).send({
          code: "POLICY_CREATION_FAILED",
          message: "Could not create risk policy",
        });
      }

      await audit(
        currentActor.id,
        "RISK_POLICY_VERSION_CREATED",
        "RISK_POLICY",
        policy.id,
        {},
        { version: policy.version, name: policy.name },
      );

      return reply.status(201).send({
        policy: {
          id: policy.id,
          version: policy.version,
          name: policy.name,
          isActive: policy.isActive,
          effectiveDate: policy.effectiveDate.toISOString(),
          tierThresholds: policy.tierThresholds,
          hazardFlagRules: policy.hazardFlagRules,
          mandatoryControlsConfig: policy.mandatoryControlsConfig,
          createdAt: policy.createdAt.toISOString(),
        },
      });
    },
  );

  /**
   * 2. Get Currently Active Risk Policy
   */
  app.get(
    "/v1/risk/policies/active",
    { preHandler: authenticate },
    async (_request, reply) => {
      const [policy] = await db
        .select()
        .from(riskPolicies)
        .where(eq(riskPolicies.isActive, true))
        .orderBy(desc(riskPolicies.createdAt))
        .limit(1);

      if (!policy) {
        return reply.status(404).send({
          code: "ACTIVE_POLICY_NOT_FOUND",
          message: "No active risk policy is on file",
        });
      }

      return reply.status(200).send({
        policy: {
          id: policy.id,
          version: policy.version,
          name: policy.name,
          isActive: policy.isActive,
          effectiveDate: policy.effectiveDate.toISOString(),
          tierThresholds: policy.tierThresholds,
          hazardFlagRules: policy.hazardFlagRules,
          mandatoryControlsConfig: policy.mandatoryControlsConfig,
          calibrationNotes: policy.calibrationNotes,
          createdAt: policy.createdAt.toISOString(),
        },
      });
    },
  );

  /**
   * 3. Evaluate & Record Job Risk Assessment
   */
  app.post(
    "/v1/risk/jobs/:id/assess",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
      );

      const params = parse(z.object({ id: uuid }), request.params);
      const jobId = params.id;
      const body = parse(assessJobRiskSchema, request.body);

      const [job] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          technicianId: jobs.technicianId,
          serviceRequestId: jobs.serviceRequestId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        return reply.status(404).send({
          code: "JOB_NOT_FOUND",
          message: `Job ${jobId} was not found`,
        });
      }

      const [reqData] = await db
        .select({
          id: serviceRequests.id,
          verticalId: serviceRequests.verticalId,
          categoryId: serviceRequests.categoryId,
          issueTypeId: serviceRequests.issueTypeId,
          propertyId: serviceRequests.propertyId,
        })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, job.serviceRequestId))
        .limit(1);

      const [vertical] = reqData
        ? await db
            .select({ slug: verticals.slug })
            .from(verticals)
            .where(eq(verticals.id, reqData.verticalId))
            .limit(1)
        : [null];

      const [contractorData] = await db
        .select({
          ratingBps: contractors.ratingBps,
          completionRateBps: contractors.completionRateBps,
        })
        .from(contractors)
        .where(eq(contractors.id, job.contractorId))
        .limit(1);

      // Fetch active policy or fall back to version specified
      const [policy] = await db
        .select()
        .from(riskPolicies)
        .where(
          body.policyVersion
            ? eq(riskPolicies.version, body.policyVersion)
            : eq(riskPolicies.isActive, true),
        )
        .orderBy(desc(riskPolicies.createdAt))
        .limit(1);

      if (!policy) {
        return reply.status(422).send({
          code: "RISK_POLICY_NOT_FOUND",
          message: "No active risk policy could be found to score the job",
        });
      }

      // Check existing assessment for verified controls and approval status
      const [existingAssessment] = await db
        .select()
        .from(jobRiskAssessments)
        .where(eq(jobRiskAssessments.jobId, jobId))
        .limit(1);

      const verifiedControls =
        (existingAssessment?.verifiedControls as Array<{
          control: string;
          fulfilledAt?: string | null;
          notes?: string | null;
          evidenceUrl?: string | null;
        }>) ?? [];

      const manualApprovalStatus =
        (existingAssessment?.manualApprovalStatus as ManualApprovalStatus) ??
        "NOT_REQUIRED";

      const evaluation = evaluateJobRisk({
        serviceVariant: {
          verticalSlug: vertical?.slug ?? "general",
        },
        jobDetails: {
          jobValueCents: body.jobValueCents,
          propertyAgeYears: body.propertyAgeYears,
          isCommercialOrIndustrial: body.isCommercialOrIndustrial,
          heightMeters: body.heightMeters,
          confinedSpaceAccess: body.confinedSpaceAccess,
          voltageLevelVolts: body.voltageLevelVolts,
          gasApplianceInvolved: body.gasApplianceInvolved,
        },
        hazardFlags: body.hazardFlags,
        contractor: {
          ratingBps: contractorData?.ratingBps,
          completedJobsCount: 15,
        },
        mitigationFactors: body.mitigationFactors,
        manualApprovalStatus,
        verifiedControls,
      });

      const initialManualStatus: ManualApprovalStatus =
        evaluation.requiresManualApproval
          ? manualApprovalStatus === "APPROVED"
            ? "APPROVED"
            : "PENDING_REVIEW"
          : "NOT_REQUIRED";

      let assessmentRecord: typeof jobRiskAssessments.$inferSelect;

      if (existingAssessment) {
        const [updated] = await db
          .update(jobRiskAssessments)
          .set({
            jobId,
            serviceRequestId: job.serviceRequestId,
            policyId: policy.id,
            policyVersion: policy.version,
            inherentScore: evaluation.inherentScore,
            mitigationsScore: evaluation.mitigationsScore,
            residualScore: evaluation.residualScore,
            riskTier: evaluation.riskTier,
            hazardFlags: evaluation.hazardFlags,
            mandatoryControls: evaluation.mandatoryControls,
            decisionLog: evaluation.decisionLog,
            requiresManualApproval: evaluation.requiresManualApproval,
            manualApprovalStatus: initialManualStatus,
            updatedAt: new Date(),
          })
          .where(eq(jobRiskAssessments.id, existingAssessment.id))
          .returning();
        assessmentRecord = updated!;
      } else {
        const [inserted] = await db
          .insert(jobRiskAssessments)
          .values({
            jobId,
            serviceRequestId: job.serviceRequestId,
            policyId: policy.id,
            policyVersion: policy.version,
            inherentScore: evaluation.inherentScore,
            mitigationsScore: evaluation.mitigationsScore,
            residualScore: evaluation.residualScore,
            riskTier: evaluation.riskTier,
            hazardFlags: evaluation.hazardFlags,
            mandatoryControls: evaluation.mandatoryControls,
            verifiedControls: [],
            decisionLog: evaluation.decisionLog,
            requiresManualApproval: evaluation.requiresManualApproval,
            manualApprovalStatus: initialManualStatus,
          })
          .returning();
        assessmentRecord = inserted!;
      }

      // Sync jobs table columns
      await db
        .update(jobs)
        .set({
          riskTier: evaluation.riskTier,
          riskScore: evaluation.residualScore,
          riskAssessmentId: assessmentRecord.id,
          riskReviewStatus: initialManualStatus,
        })
        .where(eq(jobs.id, jobId));

      if (job.serviceRequestId) {
        await db
          .update(serviceRequests)
          .set({
            riskTier: evaluation.riskTier,
            riskScore: evaluation.residualScore,
            riskAssessmentId: assessmentRecord.id,
            riskReviewStatus: initialManualStatus,
            updatedAt: new Date(),
          })
          .where(eq(serviceRequests.id, job.serviceRequestId));
      }

      await audit(
        currentActor.id,
        "JOB_RISK_ASSESSED",
        "JOB",
        jobId,
        { previousTier: job },
        {
          riskTier: evaluation.riskTier,
          residualScore: evaluation.residualScore,
          requiresManualApproval: evaluation.requiresManualApproval,
          manualApprovalStatus: initialManualStatus,
        },
      );

      return reply.status(200).send({
        assessment: toJobRiskAssessment(assessmentRecord),
        evaluation,
      });
    },
  );

  /**
   * 4. Get Job Risk Assessment Dossier
   */
  app.get(
    "/v1/risk/jobs/:id/assessment",
    { preHandler: authenticate },
    async (request, reply) => {
      const params = parse(z.object({ id: uuid }), request.params);
      const jobId = params.id;

      const [assessment] = await db
        .select()
        .from(jobRiskAssessments)
        .where(eq(jobRiskAssessments.jobId, jobId))
        .limit(1);

      if (!assessment) {
        return reply.status(404).send({
          code: "RISK_ASSESSMENT_NOT_FOUND",
          message: `No risk assessment on record for job ${jobId}`,
        });
      }

      return reply.status(200).send({
        assessment: toJobRiskAssessment(assessment),
      });
    },
  );

  /**
   * 4b. Evaluate & Record Service Request Risk Assessment (Pre-Dispatch)
   */
  app.post(
    "/v1/risk/service-requests/:id/assess",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
        "CUSTOMER",
      );

      const params = parse(z.object({ id: uuid }), request.params);
      const serviceRequestId = params.id;
      const body = parse(assessJobRiskSchema, request.body);

      const [reqData] = await db
        .select({
          id: serviceRequests.id,
          verticalId: serviceRequests.verticalId,
          categoryId: serviceRequests.categoryId,
          issueTypeId: serviceRequests.issueTypeId,
          propertyId: serviceRequests.propertyId,
        })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, serviceRequestId))
        .limit(1);

      if (!reqData) {
        return reply.status(404).send({
          code: "SERVICE_REQUEST_NOT_FOUND",
          message: `Service request ${serviceRequestId} was not found`,
        });
      }

      const [vertical] = await db
        .select({ slug: verticals.slug })
        .from(verticals)
        .where(eq(verticals.id, reqData.verticalId))
        .limit(1);

      // Check if a job already exists
      const [existingJob] = await db
        .select({ id: jobs.id, contractorId: jobs.contractorId })
        .from(jobs)
        .where(eq(jobs.serviceRequestId, serviceRequestId))
        .limit(1);

      const [contractorData] = existingJob
        ? await db
            .select({
              ratingBps: contractors.ratingBps,
              completionRateBps: contractors.completionRateBps,
            })
            .from(contractors)
            .where(eq(contractors.id, existingJob.contractorId))
            .limit(1)
        : [null];

      const [policy] = await db
        .select()
        .from(riskPolicies)
        .where(
          body.policyVersion
            ? eq(riskPolicies.version, body.policyVersion)
            : eq(riskPolicies.isActive, true),
        )
        .orderBy(desc(riskPolicies.createdAt))
        .limit(1);

      if (!policy) {
        return reply.status(422).send({
          code: "RISK_POLICY_NOT_FOUND",
          message: "No active risk policy could be found to score the service request",
        });
      }

      const [existingAssessment] = await db
        .select()
        .from(jobRiskAssessments)
        .where(eq(jobRiskAssessments.serviceRequestId, serviceRequestId))
        .orderBy(desc(jobRiskAssessments.createdAt))
        .limit(1);

      const verifiedControls =
        (existingAssessment?.verifiedControls as unknown as MandatoryControlItem[]) ?? [];

      const manualApprovalStatus =
        (existingAssessment?.manualApprovalStatus as ManualApprovalStatus) ??
        "NOT_REQUIRED";

      const evaluation = evaluateJobRisk({
        serviceVariant: {
          verticalSlug: vertical?.slug ?? "general",
        },
        jobDetails: {
          jobValueCents: body.jobValueCents,
          propertyAgeYears: body.propertyAgeYears,
          isCommercialOrIndustrial: body.isCommercialOrIndustrial,
          heightMeters: body.heightMeters,
          confinedSpaceAccess: body.confinedSpaceAccess,
          voltageLevelVolts: body.voltageLevelVolts,
          gasApplianceInvolved: body.gasApplianceInvolved,
        },
        hazardFlags: body.hazardFlags,
        contractor: contractorData
          ? {
              ratingBps: contractorData.ratingBps,
              completedJobsCount: 15,
            }
          : undefined,
        mitigationFactors: body.mitigationFactors,
        manualApprovalStatus,
        verifiedControls,
      });

      const initialManualStatus: ManualApprovalStatus =
        evaluation.requiresManualApproval
          ? manualApprovalStatus === "APPROVED"
            ? "APPROVED"
            : "PENDING_REVIEW"
          : "NOT_REQUIRED";

      let assessmentRecord: typeof jobRiskAssessments.$inferSelect;

      if (existingAssessment) {
        const [updated] = await db
          .update(jobRiskAssessments)
          .set({
            jobId: existingJob?.id ?? existingAssessment.jobId ?? null,
            policyId: policy.id,
            policyVersion: policy.version,
            inherentScore: evaluation.inherentScore,
            mitigationsScore: evaluation.mitigationsScore,
            residualScore: evaluation.residualScore,
            riskTier: evaluation.riskTier,
            hazardFlags: evaluation.hazardFlags,
            mandatoryControls: evaluation.mandatoryControls,
            decisionLog: evaluation.decisionLog,
            requiresManualApproval: evaluation.requiresManualApproval,
            manualApprovalStatus: initialManualStatus,
            updatedAt: new Date(),
          })
          .where(eq(jobRiskAssessments.id, existingAssessment.id))
          .returning();
        assessmentRecord = updated!;
      } else {
        const [inserted] = await db
          .insert(jobRiskAssessments)
          .values({
            jobId: existingJob?.id ?? null,
            serviceRequestId,
            policyId: policy.id,
            policyVersion: policy.version,
            inherentScore: evaluation.inherentScore,
            mitigationsScore: evaluation.mitigationsScore,
            residualScore: evaluation.residualScore,
            riskTier: evaluation.riskTier,
            hazardFlags: evaluation.hazardFlags,
            mandatoryControls: evaluation.mandatoryControls,
            verifiedControls: [],
            decisionLog: evaluation.decisionLog,
            requiresManualApproval: evaluation.requiresManualApproval,
            manualApprovalStatus: initialManualStatus,
          })
          .returning();
        assessmentRecord = inserted!;
      }

      // Sync serviceRequests table columns
      await db
        .update(serviceRequests)
        .set({
          riskTier: evaluation.riskTier,
          riskScore: evaluation.residualScore,
          riskAssessmentId: assessmentRecord.id,
          riskReviewStatus: initialManualStatus,
          updatedAt: new Date(),
        })
        .where(eq(serviceRequests.id, serviceRequestId));

      if (existingJob) {
        await db
          .update(jobs)
          .set({
            riskTier: evaluation.riskTier,
            riskScore: evaluation.residualScore,
            riskAssessmentId: assessmentRecord.id,
            riskReviewStatus: initialManualStatus,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, existingJob.id));
      }

      await audit(
        currentActor.id,
        "SERVICE_REQUEST_RISK_ASSESSED",
        "SERVICE_REQUEST",
        serviceRequestId,
        {},
        {
          riskTier: evaluation.riskTier,
          residualScore: evaluation.residualScore,
          requiresManualApproval: evaluation.requiresManualApproval,
          manualApprovalStatus: initialManualStatus,
        },
      );

      return reply.status(200).send({
        assessment: toJobRiskAssessment(assessmentRecord),
        evaluation,
      });
    },
  );

  /**
   * 4c. Get Service Request Risk Assessment Dossier
   */
  app.get(
    "/v1/risk/service-requests/:id/assessment",
    { preHandler: authenticate },
    async (request, reply) => {
      const params = parse(z.object({ id: uuid }), request.params);
      const serviceRequestId = params.id;

      const [assessment] = await db
        .select()
        .from(jobRiskAssessments)
        .where(eq(jobRiskAssessments.serviceRequestId, serviceRequestId))
        .orderBy(desc(jobRiskAssessments.createdAt))
        .limit(1);

      if (!assessment) {
        return reply.status(404).send({
          code: "RISK_ASSESSMENT_NOT_FOUND",
          message: `No risk assessment on record for service request ${serviceRequestId}`,
        });
      }

      return reply.status(200).send({
        assessment: toJobRiskAssessment(assessment),
      });
    },
  );

  /**
   * 5. Review Queue: List Jobs Pending Risk Approval (Ops / Safety Officer)
   */
  app.get(
    "/v1/risk/review-queue",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "OPERATIONS_AGENT", "DISPATCHER", "ADMIN", "SUPER_ADMIN");

      const queue = await db
        .select({
          id: jobRiskAssessments.id,
          jobId: jobRiskAssessments.jobId,
          serviceRequestId: jobRiskAssessments.serviceRequestId,
          policyVersion: jobRiskAssessments.policyVersion,
          inherentScore: jobRiskAssessments.inherentScore,
          residualScore: jobRiskAssessments.residualScore,
          riskTier: jobRiskAssessments.riskTier,
          hazardFlags: jobRiskAssessments.hazardFlags,
          mandatoryControls: jobRiskAssessments.mandatoryControls,
          manualApprovalStatus: jobRiskAssessments.manualApprovalStatus,
          createdAt: jobRiskAssessments.createdAt,
        })
        .from(jobRiskAssessments)
        .where(eq(jobRiskAssessments.manualApprovalStatus, "PENDING_REVIEW"))
        .orderBy(desc(jobRiskAssessments.residualScore));

      return reply.status(200).send({
        pendingReviews: queue.map((q) => ({
          ...q,
          createdAt: q.createdAt.toISOString(),
        })),
        totalPending: queue.length,
      });
    },
  );

  /**
   * 6. Decide on Job Risk Review (Approve / Reject)
   */
  app.post(
    "/v1/risk/assessments/:id/review",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "OPERATIONS_AGENT", "ADMIN", "SUPER_ADMIN");

      const params = parse(z.object({ id: uuid }), request.params);
      const assessmentId = params.id;
      const body = parse(reviewJobRiskAssessmentSchema, request.body);

      const [assessment] = await db
        .select()
        .from(jobRiskAssessments)
        .where(eq(jobRiskAssessments.id, assessmentId))
        .limit(1);

      if (!assessment) {
        return reply.status(404).send({
          code: "RISK_ASSESSMENT_NOT_FOUND",
          message: `Assessment ${assessmentId} was not found`,
        });
      }

      const decisionStatus: ManualApprovalStatus =
        body.decision === "APPROVED" ? "APPROVED" : "REJECTED";

      const [updated] = await db
        .update(jobRiskAssessments)
        .set({
          manualApprovalStatus: decisionStatus,
          manualApprovedByUserId: currentActor.id,
          manualApprovedAt: new Date(),
          manualApprovalNotes: body.approvalNotes,
          updatedAt: new Date(),
        })
        .where(eq(jobRiskAssessments.id, assessmentId))
        .returning();

      // Sync jobs table review status if job exists
      if (assessment.jobId) {
        await db
          .update(jobs)
          .set({
            riskReviewStatus: decisionStatus,
          })
          .where(eq(jobs.id, assessment.jobId));
      }

      // Sync serviceRequests table review status if service request exists
      if (assessment.serviceRequestId) {
        await db
          .update(serviceRequests)
          .set({
            riskReviewStatus: decisionStatus,
            updatedAt: new Date(),
          })
          .where(eq(serviceRequests.id, assessment.serviceRequestId));
      }

      await audit(
        currentActor.id,
        "JOB_RISK_REVIEW_DECIDED",
        "JOB_RISK_ASSESSMENT",
        assessmentId,
        { previousStatus: assessment.manualApprovalStatus },
        { decision: decisionStatus, notes: body.approvalNotes },
      );

      return reply.status(200).send({
        assessment: toJobRiskAssessment(updated!),
        decision: decisionStatus,
      });
    },
  );

  /**
   * 7. Fulfill Mandatory Safety Control (Contractor / Tech / Ops)
   */
  app.post(
    "/v1/risk/assessments/:id/fulfill-control",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
        "TECHNICIAN",
        "OPERATIONS_AGENT",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const params = parse(z.object({ id: uuid }), request.params);
      const assessmentId = params.id;
      const body = parse(fulfillMandatoryControlSchema, request.body);

      const [assessment] = await db
        .select()
        .from(jobRiskAssessments)
        .where(eq(jobRiskAssessments.id, assessmentId))
        .limit(1);

      if (!assessment) {
        return reply.status(404).send({
          code: "RISK_ASSESSMENT_NOT_FOUND",
          message: `Assessment ${assessmentId} was not found`,
        });
      }

      const verified =
        (assessment.verifiedControls as MandatoryControlItem[]) ?? [];
      const mandatory =
        (assessment.mandatoryControls as MandatoryControlItem[]) ?? [];

      const targetControl = mandatory.find((m) => m.control === body.control);
      if (!targetControl) {
        return reply.status(422).send({
          code: "CONTROL_NOT_MANDATED",
          message: `Control ${body.control} is not mandated for this risk assessment`,
        });
      }

      // Mark fulfilled in verifiedControls array
      const existingIdx = verified.findIndex((v) => v.control === body.control);
      const nowIso = new Date().toISOString();
      const updatedControl: MandatoryControlItem = {
        control: body.control,
        description: targetControl.description,
        requiredFor: targetControl.requiredFor,
        fulfilled: true,
        fulfilledAt: nowIso,
        fulfilledByUserId: currentActor.id,
        notes: body.notes ?? null,
        evidenceUrl: body.evidenceUrl ?? null,
      };

      if (existingIdx >= 0) {
        verified[existingIdx] = updatedControl;
      } else {
        verified.push(updatedControl);
      }

      // Update mandatoryControls array to reflect fulfilled status
      const updatedMandatory = mandatory.map((m) =>
        m.control === body.control ? { ...m, ...updatedControl } : m,
      );

      const [updated] = await db
        .update(jobRiskAssessments)
        .set({
          verifiedControls: verified,
          mandatoryControls: updatedMandatory,
          updatedAt: new Date(),
        })
        .where(eq(jobRiskAssessments.id, assessmentId))
        .returning();

      await audit(
        currentActor.id,
        "RISK_CONTROL_FULFILLED",
        "JOB_RISK_ASSESSMENT",
        assessmentId,
        {},
        { control: body.control, evidenceUrl: body.evidenceUrl },
      );

      return reply.status(200).send({
        assessment: toJobRiskAssessment(updated!),
        fulfilledControl: updatedControl,
      });
    },
  );
};
