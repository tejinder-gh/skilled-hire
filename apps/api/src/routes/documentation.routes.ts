// apps/api/src/routes/documentation.routes.ts

import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "@marketplace/auth";
import type {
  JobDocumentationPackage,
  DocumentationRiskTier,
  JobDocumentationStatus,
  QaAuditStatus,
  EvidencePhoto,
  RiskChecklistItem,
  CustomerSignoff,
  DocumentationDeficiency,
  ExceptionAuditEntry,
} from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  desc,
  jobs,
  serviceRequests,
  contractors,
  technicians,
  properties,
  serviceRecords,
  jobRiskAssessments,
  jobDocumentationPackages,
  electricalPermits,
  qualityAudits,
  safetyIncidents,
  contractorSafetyQuarantines,
  users,
} from "@marketplace/database";
import {
  submitJobDocumentationSchema,
  customerSignoffSchema,
  reviewJobDocumentationSchema,
  exceptionApprovalSchema,
  qaSampleJobSchema,
  uuid,
} from "@marketplace/validation";
import {
  evaluateJobDocumentationGate,
  evaluateQaSamplingEligibility,
  calculateQaMetrics,
} from "@marketplace/vertical-engine";
import { z } from "zod";
import { actor, authenticate, isOps, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

function toDocumentationPackageContract(
  row: typeof jobDocumentationPackages.$inferSelect,
): JobDocumentationPackage {
  return {
    id: row.id,
    jobId: row.jobId,
    serviceRequestId: row.serviceRequestId,
    contractorId: row.contractorId,
    technicianId: row.technicianId,
    propertyId: row.propertyId,
    riskTier: row.riskTier as DocumentationRiskTier,
    status: row.status as JobDocumentationStatus,
    beforePhotos: (row.beforePhotos as unknown as EvidencePhoto[]) ?? [],
    inProgressPhotos: (row.inProgressPhotos as unknown as EvidencePhoto[]) ?? [],
    afterPhotos: (row.afterPhotos as unknown as EvidencePhoto[]) ?? [],
    workerIdentityConfirmed: row.workerIdentityConfirmed,
    workerIdentityNotes: row.workerIdentityNotes,
    riskChecklist: (row.riskChecklist as unknown as RiskChecklistItem[]) ?? [],
    customerSignoff: (row.customerSignoff as unknown as CustomerSignoff) ?? { signed: false },
    permitId: row.permitId,
    permitVerified: row.permitVerified,
    qaAuditId: row.qaAuditId,
    qaAuditRequired: row.qaAuditRequired,
    qaAuditStatus: row.qaAuditStatus as QaAuditStatus,
    incidentEscalationId: row.incidentEscalationId,
    incidentEscalated: row.incidentEscalated,
    deficiencies: (row.deficiencies as unknown as DocumentationDeficiency[]) ?? [],
    exceptionAuditLog: (row.exceptionAuditLog as unknown as ExceptionAuditEntry[]) ?? [],
    submittedByUserId: row.submittedByUserId,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewNotes: row.reviewNotes,
    propertyPassportLinked: row.propertyPassportLinked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const documentationRoutes: FastifyPluginAsync = async (app) => {
  // 1. Get or Initialize Job Documentation Package
  app.get(
    "/v1/jobs/:id/documentation",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;

      const [jobRow] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          technicianId: jobs.technicianId,
          serviceRequestId: jobs.serviceRequestId,
          customerId: serviceRequests.customerId,
          propertyId: serviceRequests.propertyId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Tenant authorization check
      const isAuthorized =
        isOps(user) ||
        jobRow.customerId === user.id ||
        (user.contractorId && user.contractorId === jobRow.contractorId);

      if (!isAuthorized) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Tenant isolation: cannot access documentation for this job",
        });
      }

      let [pkgRow] = await db
        .select()
        .from(jobDocumentationPackages)
        .where(eq(jobDocumentationPackages.jobId, jobId))
        .limit(1);

      if (!pkgRow) {
        // Query risk assessment for tier
        const [assessment] = await db
          .select({ riskTier: jobRiskAssessments.riskTier })
          .from(jobRiskAssessments)
          .where(eq(jobRiskAssessments.jobId, jobId))
          .limit(1);

        const riskTier = (assessment?.riskTier as DocumentationRiskTier) ?? "LOW";

        const [inserted] = await db
          .insert(jobDocumentationPackages)
          .values({
            jobId,
            serviceRequestId: jobRow.serviceRequestId,
            contractorId: jobRow.contractorId,
            technicianId: jobRow.technicianId,
            propertyId: jobRow.propertyId,
            riskTier,
            status: "IN_PROGRESS",
          })
          .returning();

        pkgRow = inserted!;
      }

      const contractPkg = toDocumentationPackageContract(pkgRow);
      const gateEvaluation = evaluateJobDocumentationGate({
        riskTier: contractPkg.riskTier,
        beforePhotos: contractPkg.beforePhotos,
        inProgressPhotos: contractPkg.inProgressPhotos,
        afterPhotos: contractPkg.afterPhotos,
        workerIdentityConfirmed: contractPkg.workerIdentityConfirmed,
        riskChecklist: contractPkg.riskChecklist,
        customerSignoff: contractPkg.customerSignoff,
        permitId: contractPkg.permitId,
        permitVerified: contractPkg.permitVerified,
        deficiencies: contractPkg.deficiencies,
      });

      return reply.code(200).send({
        documentationPackage: contractPkg,
        gateEvaluation,
      });
    },
  );

  // 2. Submit / Update Job Documentation Package
  app.post(
    "/v1/jobs/:id/documentation",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(submitJobDocumentationSchema, request.body);

      const [jobRow] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          technicianId: jobs.technicianId,
          serviceRequestId: jobs.serviceRequestId,
          propertyId: serviceRequests.propertyId,
          contractorRatingBps: contractors.ratingBps,
          contractorSafetyStatus: contractors.safetyStatus,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Only assigned technician, contractor manager/owner, or ops can submit evidence
      const canSubmit =
        isOps(user) ||
        (user.contractorId && user.contractorId === jobRow.contractorId);

      if (!canSubmit) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only assigned contractor personnel or operations can submit job documentation",
        });
      }

      // Check or create package
      let [pkgRow] = await db
        .select()
        .from(jobDocumentationPackages)
        .where(eq(jobDocumentationPackages.jobId, jobId))
        .limit(1);

      let riskTier: DocumentationRiskTier = "LOW";
      if (!pkgRow) {
        const [assessment] = await db
          .select({ riskTier: jobRiskAssessments.riskTier })
          .from(jobRiskAssessments)
          .where(eq(jobRiskAssessments.jobId, jobId))
          .limit(1);
        riskTier = (assessment?.riskTier as DocumentationRiskTier) ?? "LOW";
      } else {
        riskTier = pkgRow.riskTier as DocumentationRiskTier;
      }

      // Verify permit if permitId is supplied
      let permitVerified = false;
      if (body.permitId) {
        const [permit] = await db
          .select()
          .from(electricalPermits)
          .where(eq(electricalPermits.id, body.permitId))
          .limit(1);
        if (permit && permit.status !== "DEFICIENCIES_OUTSTANDING") {
          permitVerified = true;
        }
      }

      // Evaluate gate
      const gateResult = evaluateJobDocumentationGate({
        riskTier,
        beforePhotos: body.beforePhotos as unknown as EvidencePhoto[],
        inProgressPhotos: body.inProgressPhotos as unknown as EvidencePhoto[],
        afterPhotos: body.afterPhotos as unknown as EvidencePhoto[],
        workerIdentityConfirmed: body.workerIdentityConfirmed,
        riskChecklist: body.riskChecklist as unknown as RiskChecklistItem[],
        permitId: body.permitId ?? null,
        permitVerified,
        contractorRatingBps: jobRow.contractorRatingBps,
      });

      let incidentId: string | null = null;
      let incidentEscalated = false;

      // Handle severe hazard automated escalation (#58)
      if (gateResult.incidentEscalationRequired) {
        incidentEscalated = true;
        const incidentNumber = `INC-2026-DOC-${Math.floor(100000 + Math.random() * 900000)}`;

        const [createdIncident] = await db
          .insert(safetyIncidents)
          .values({
            incidentNumber,
            jobId,
            serviceRequestId: jobRow.serviceRequestId,
            contractorId: jobRow.contractorId,
            technicianId: jobRow.technicianId,
            propertyId: jobRow.propertyId,
            reportedByUserId: user.id,
            reporterRole: "ADMIN",
            incidentType: "ELECTRICAL_HAZARD_SHOCK",
            title: "Severe Hazard Detected in Job Documentation",
            severity: "CRITICAL_EMERGENCY",
            status: "REPORTED",
            description:
              gateResult.escalationReason ??
              "Severe safety hazard detected in documentation",
            occurredAt: new Date(),
            insurerNotified: true,
          })
          .returning();

        incidentId = createdIncident!.id;

        // Automatically quarantine contractor
        await db
          .update(contractors)
          .set({ safetyStatus: "SUSPENDED" })
          .where(eq(contractors.id, jobRow.contractorId));

        await db.insert(contractorSafetyQuarantines).values({
          contractorId: jobRow.contractorId,
          incidentId,
          quarantineType: "FULL_CONTRACTOR_SUSPENSION",
          reason:
            "Automated safety quarantine triggered by critical job documentation hazard",
          issuedByUserId: user.id,
          active: true,
        });
      }

      const updatedStatus = incidentEscalated
        ? "DEFICIENT"
        : gateResult.passed
          ? "VERIFIED_COMPLIANT"
          : "SUBMITTED";

      let updatedPkg: typeof jobDocumentationPackages.$inferSelect;

      if (!pkgRow) {
        const [inserted] = await db
          .insert(jobDocumentationPackages)
          .values({
            jobId,
            serviceRequestId: jobRow.serviceRequestId,
            contractorId: jobRow.contractorId,
            technicianId: jobRow.technicianId,
            propertyId: jobRow.propertyId,
            riskTier,
            status: updatedStatus,
            beforePhotos: body.beforePhotos,
            inProgressPhotos: body.inProgressPhotos,
            afterPhotos: body.afterPhotos,
            workerIdentityConfirmed: body.workerIdentityConfirmed,
            workerIdentityNotes: body.workerIdentityNotes ?? null,
            riskChecklist: body.riskChecklist,
            permitId: body.permitId ?? null,
            permitVerified,
            qaAuditRequired: gateResult.qaAuditRequired,
            incidentEscalationId: incidentId,
            incidentEscalated,
            submittedByUserId: user.id,
            submittedAt: new Date(),
          })
          .returning();
        updatedPkg = inserted!;
      } else {
        const [updated] = await db
          .update(jobDocumentationPackages)
          .set({
            beforePhotos: body.beforePhotos,
            inProgressPhotos: body.inProgressPhotos,
            afterPhotos: body.afterPhotos,
            workerIdentityConfirmed: body.workerIdentityConfirmed,
            workerIdentityNotes: body.workerIdentityNotes ?? pkgRow.workerIdentityNotes,
            riskChecklist: body.riskChecklist,
            permitId: body.permitId ?? pkgRow.permitId,
            permitVerified,
            qaAuditRequired: gateResult.qaAuditRequired,
            incidentEscalationId: incidentId ?? pkgRow.incidentEscalationId,
            incidentEscalated: incidentEscalated || pkgRow.incidentEscalated,
            status: updatedStatus,
            submittedByUserId: user.id,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(jobDocumentationPackages.id, pkgRow.id))
          .returning();
        updatedPkg = updated!;
      }

      await audit(
        user.id,
        "JOB_DOCUMENTATION_SUBMITTED",
        "JOB_DOCUMENTATION",
        updatedPkg.id,
        pkgRow,
        updatedPkg,
        { incidentEscalated },
      );

      return reply.code(200).send({
        documentationPackage: toDocumentationPackageContract(updatedPkg),
        gateEvaluation: gateResult,
      });
    },
  );

  // 3. Customer Sign-off
  app.post(
    "/v1/jobs/:id/documentation/signoff",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(customerSignoffSchema, request.body);

      const [pkgRow] = await db
        .select()
        .from(jobDocumentationPackages)
        .where(eq(jobDocumentationPackages.jobId, jobId))
        .limit(1);

      if (!pkgRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Documentation package not found for this job",
        });
      }

      const [sr] = await db
        .select({ customerId: serviceRequests.customerId })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, pkgRow.serviceRequestId))
        .limit(1);

      if (sr && sr.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Tenant isolation: only the job customer can sign off on documentation",
        });
      }

      const customerSignoff: CustomerSignoff = {
        signed: true,
        customerName: body.customerName,
        signedAt: new Date().toISOString(),
        feedback: body.feedback,
        signatureDigest: body.signatureDigest,
      };

      const gateResult = evaluateJobDocumentationGate({
        riskTier: pkgRow.riskTier as DocumentationRiskTier,
        beforePhotos: pkgRow.beforePhotos as unknown as EvidencePhoto[],
        inProgressPhotos: pkgRow.inProgressPhotos as unknown as EvidencePhoto[],
        afterPhotos: pkgRow.afterPhotos as unknown as EvidencePhoto[],
        workerIdentityConfirmed: pkgRow.workerIdentityConfirmed,
        riskChecklist: pkgRow.riskChecklist as unknown as RiskChecklistItem[],
        customerSignoff,
        permitId: pkgRow.permitId,
        permitVerified: pkgRow.permitVerified,
        deficiencies: pkgRow.deficiencies as unknown as DocumentationDeficiency[],
      });

      const newStatus = gateResult.passed ? "VERIFIED_COMPLIANT" : pkgRow.status;
      const passportLinked = gateResult.passed;

      const [updated] = await db
        .update(jobDocumentationPackages)
        .set({
          customerSignoff,
          status: newStatus,
          propertyPassportLinked: passportLinked,
          updatedAt: new Date(),
        })
        .where(eq(jobDocumentationPackages.id, pkgRow.id))
        .returning();

      // Update service record if linked
      if (passportLinked) {
        await db
          .update(serviceRecords)
          .set({
            documentationPackageId: updated!.id,
            riskTier: pkgRow.riskTier,
            safetySignOffStatus: "CUSTOMER_SIGNED_OFF",
          })
          .where(eq(serviceRecords.jobId, jobId));
      }

      await audit(
        user.id,
        "JOB_DOCUMENTATION_CUSTOMER_SIGNOFF",
        "JOB_DOCUMENTATION",
        pkgRow.id,
        pkgRow,
        updated,
      );

      return reply.code(200).send({
        documentationPackage: toDocumentationPackageContract(updated!),
        gateEvaluation: gateResult,
      });
    },
  );

  // 4. Operations Review / Sign-off
  app.post(
    "/v1/jobs/:id/documentation/verify",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations agents can review and verify job documentation packages",
        });
      }

      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(reviewJobDocumentationSchema, request.body);

      const [pkgRow] = await db
        .select()
        .from(jobDocumentationPackages)
        .where(eq(jobDocumentationPackages.jobId, jobId))
        .limit(1);

      if (!pkgRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Documentation package not found for this job",
        });
      }

      const deficiencies = body.deficiencies ?? (pkgRow.deficiencies as unknown as DocumentationDeficiency[]);
      const passportLinked = body.status === "VERIFIED_COMPLIANT";

      const [updated] = await db
        .update(jobDocumentationPackages)
        .set({
          status: body.status,
          reviewNotes: body.reviewNotes,
          reviewedByUserId: user.id,
          reviewedAt: new Date(),
          deficiencies,
          propertyPassportLinked: passportLinked,
          updatedAt: new Date(),
        })
        .where(eq(jobDocumentationPackages.id, pkgRow.id))
        .returning();

      if (passportLinked) {
        await db
          .update(serviceRecords)
          .set({
            documentationPackageId: updated!.id,
            riskTier: pkgRow.riskTier,
            safetySignOffStatus: "OPS_VERIFIED",
          })
          .where(eq(serviceRecords.jobId, jobId));
      }

      await audit(
        user.id,
        "JOB_DOCUMENTATION_OPS_REVIEWED",
        "JOB_DOCUMENTATION",
        pkgRow.id,
        pkgRow,
        updated,
      );

      return reply.code(200).send({
        documentationPackage: toDocumentationPackageContract(updated!),
      });
    },
  );

  // 5. Operations Exception Approval
  app.post(
    "/v1/jobs/:id/documentation/exception",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations agents can approve documentation exceptions",
        });
      }

      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(exceptionApprovalSchema, request.body);

      const [pkgRow] = await db
        .select()
        .from(jobDocumentationPackages)
        .where(eq(jobDocumentationPackages.jobId, jobId))
        .limit(1);

      if (!pkgRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Documentation package not found for this job",
        });
      }

      const exceptionLog = [
        ...((pkgRow.exceptionAuditLog as unknown as ExceptionAuditEntry[]) ?? []),
        {
          approvedByUserId: user.id,
          reason: body.reason,
          timestamp: new Date().toISOString(),
          conditions: body.conditions,
        },
      ];

      const [updated] = await db
        .update(jobDocumentationPackages)
        .set({
          status: "OPS_APPROVED_EXCEPTION",
          exceptionAuditLog: exceptionLog,
          propertyPassportLinked: true,
          updatedAt: new Date(),
        })
        .where(eq(jobDocumentationPackages.id, pkgRow.id))
        .returning();

      await db
        .update(serviceRecords)
        .set({
          documentationPackageId: updated!.id,
          riskTier: pkgRow.riskTier,
          safetySignOffStatus: "OPS_APPROVED_EXCEPTION",
        })
        .where(eq(serviceRecords.jobId, jobId));

      await audit(
        user.id,
        "JOB_DOCUMENTATION_EXCEPTION_APPROVED",
        "JOB_DOCUMENTATION",
        pkgRow.id,
        pkgRow,
        updated,
        { reason: body.reason },
      );

      return reply.code(200).send({
        documentationPackage: toDocumentationPackageContract(updated!),
        exceptionApproved: true,
      });
    },
  );

  // 6. QA Sample Job for Independent Audit
  app.post(
    "/v1/jobs/:id/documentation/qa-sample",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations agents can sample jobs for QA audit",
        });
      }

      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(qaSampleJobSchema, request.body);

      const [pkgRow] = await db
        .select()
        .from(jobDocumentationPackages)
        .where(eq(jobDocumentationPackages.jobId, jobId))
        .limit(1);

      if (!pkgRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Documentation package not found for this job",
        });
      }

      const auditNumber = `QA-AUDIT-2026-${Math.floor(100000 + Math.random() * 900000)}`;

      const [qaAudit] = await db
        .insert(qualityAudits)
        .values({
          auditNumber,
          jobId,
          contractorId: pkgRow.contractorId,
          technicianId: pkgRow.technicianId,
          triggerType: body.triggerType ?? "HIGH_RISK_TRADE",
          inspectorUserId: body.inspectorUserId ?? user.id,
          status: "SCHEDULED",
          reportNotes: body.notes ?? "Sampled for risk-based QA review",
        })
        .returning();

      const [updated] = await db
        .update(jobDocumentationPackages)
        .set({
          qaAuditId: qaAudit!.id,
          qaAuditRequired: true,
          qaAuditStatus: "PENDING",
          updatedAt: new Date(),
        })
        .where(eq(jobDocumentationPackages.id, pkgRow.id))
        .returning();

      await db
        .update(serviceRecords)
        .set({ qaAuditStatus: "SAMPLED_PENDING" })
        .where(eq(serviceRecords.jobId, jobId));

      await audit(
        user.id,
        "JOB_QA_AUDIT_SAMPLED",
        "QUALITY_AUDIT",
        qaAudit!.id,
        null,
        qaAudit,
      );

      return reply.code(201).send({
        documentationPackage: toDocumentationPackageContract(updated!),
        qaAudit,
      });
    },
  );

  // 7. Operations QA & Documentation Metrics
  app.get(
    "/v1/jobs/documentation/qa-metrics",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations agents can access QA metrics",
        });
      }

      const rows = await db.select().from(jobDocumentationPackages);
      const packages = rows.map(toDocumentationPackageContract);
      const metrics = calculateQaMetrics(packages);

      return reply.code(200).send({ metrics });
    },
  );
};
