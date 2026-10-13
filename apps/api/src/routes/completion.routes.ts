// apps/api/src/routes/completion.routes.ts

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
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
  jobCompletionReports,
  serviceRecords,
  propertySystems,
  electricalPermits,
} from "@marketplace/database";
import {
  createCompletionReportSchema,
  contractorAttestationSchema,
  customerAcceptanceSchema,
  disputeCompletionReportSchema,
} from "@marketplace/validation";
import {
  validateCompletionReport,
} from "@marketplace/vertical-engine";
import type {
  JobCompletionReport,
  InstalledPart,
  PerformedTest,
  CompletionPhoto,
  OutstandingIssue,
  MaintenanceRecommendation,
  ContractorAttestation,
  CustomerAcceptance,
} from "@marketplace/contracts";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

function mapCompletionReportRow(row: typeof jobCompletionReports.$inferSelect): JobCompletionReport {
  return {
    id: row.id,
    jobId: row.jobId,
    serviceRequestId: row.serviceRequestId,
    contractorId: row.contractorId,
    technicianId: row.technicianId,
    propertyId: row.propertyId,
    reportNumber: row.reportNumber,
    version: row.version,
    status: row.status as JobCompletionReport["status"],
    syncStatus: row.syncStatus as JobCompletionReport["syncStatus"],
    clientMutationId: row.clientMutationId,
    workSummary: row.workSummary,
    diagnosis: row.diagnosis,
    workStartedAt: row.workStartedAt.toISOString(),
    workCompletedAt: row.workCompletedAt.toISOString(),
    assetId: row.assetId,
    partsInstalled: (row.partsInstalled as InstalledPart[]) ?? [],
    testsPerformed: (row.testsPerformed as PerformedTest[]) ?? [],
    beforePhotos: (row.beforePhotos as CompletionPhoto[]) ?? [],
    afterPhotos: (row.afterPhotos as CompletionPhoto[]) ?? [],
    permitId: row.permitId,
    outstandingIssues: (row.outstandingIssues as OutstandingIssue[]) ?? [],
    maintenanceRecommendations:
      (row.maintenanceRecommendations as MaintenanceRecommendation[]) ?? [],
    contractorAttestation:
      (row.contractorAttestation as ContractorAttestation) ?? { attested: false },
    customerAcceptance:
      (row.customerAcceptance as CustomerAcceptance) ?? { accepted: false },
    disputeReason: row.disputeReason,
    disputedAt: row.disputedAt ? row.disputedAt.toISOString() : undefined,
    disputedByUserId: row.disputedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const completionRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/jobs/:id/completion-report
  app.get(
    "/v1/jobs/:id/completion-report",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;

      const [jobRow] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          technicianId: jobs.technicianId,
          technicianUserId: technicians.userId,
          serviceRequestId: jobs.serviceRequestId,
          customerId: serviceRequests.customerId,
          propertyId: serviceRequests.propertyId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .leftJoin(technicians, eq(technicians.id, jobs.technicianId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Tenant isolation: Ops, Job Customer, or Job Contractor/Technician
      const isJobCustomer = user.id === jobRow.customerId;
      const isJobContractor =
        user.contractorId && user.contractorId === jobRow.contractorId;
      const isJobTech = jobRow.technicianUserId === user.id;

      if (!isOps(user) && !isJobCustomer && !isJobContractor && !isJobTech) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to view completion report for this job",
        });
      }

      const [reportRow] = await db
        .select()
        .from(jobCompletionReports)
        .where(eq(jobCompletionReports.jobId, jobId))
        .orderBy(desc(jobCompletionReports.version))
        .limit(1);

      if (!reportRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "No completion report on file for this job",
        });
      }

      return reply.code(200).send({
        completionReport: mapCompletionReportRow(reportRow),
      });
    },
  );

  // POST /v1/jobs/:id/completion-report
  app.post(
    "/v1/jobs/:id/completion-report",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createCompletionReportSchema, request.body);

      const [jobRow] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          technicianId: jobs.technicianId,
          technicianUserId: technicians.userId,
          serviceRequestId: jobs.serviceRequestId,
          propertyId: serviceRequests.propertyId,
          verticalSlug: serviceRequests.verticalId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .leftJoin(technicians, eq(technicians.id, jobs.technicianId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      const isJobContractor =
        user.contractorId && user.contractorId === jobRow.contractorId;
      const isJobTech = jobRow.technicianUserId === user.id;

      if (!isOps(user) && !isJobContractor && !isJobTech) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only assigned contractor or operations can submit completion reports",
        });
      }

      // Check existing report
      const [existing] = await db
        .select()
        .from(jobCompletionReports)
        .where(eq(jobCompletionReports.jobId, jobId))
        .orderBy(desc(jobCompletionReports.version))
        .limit(1);

      // Check if already accepted
      if (existing && existing.status === "ACCEPTED") {
        return reply.code(409).send({
          statusCode: 409,
          code: "CONFLICT",
          message: "Accepted completion report is immutable and cannot be overwritten",
        });
      }

      const isDraft = body.isDraft ?? false;
      const reportStatus = isDraft ? "DRAFT" : "SUBMITTED";

      if (!isDraft) {
        // Validate required fields before submission
        const validation = validateCompletionReport({
          workSummary: body.workSummary,
          diagnosis: body.diagnosis,
          workStartedAt: body.workStartedAt,
          workCompletedAt: body.workCompletedAt,
          partsInstalled: body.partsInstalled,
          testsPerformed: body.testsPerformed,
          beforePhotos: body.beforePhotos,
          afterPhotos: body.afterPhotos,
          permitId: body.permitId,
          outstandingIssues: body.outstandingIssues,
          maintenanceRecommendations: body.maintenanceRecommendations,
          contractorAttestation: {
            attested: true,
            technicianName: "Assigned Technician",
          },
        });

        if (!validation.valid) {
          return reply.code(400).send({
            statusCode: 400,
            code: "VALIDATION_FAILED",
            message: "Completion report requirements not fulfilled",
            errors: validation.errors,
            warnings: validation.warnings,
          });
        }
      }

      const reportNumber =
        existing?.reportNumber ??
        `JCR-2026-${Math.floor(100000 + Math.random() * 900000)}`;

      let savedRow: typeof jobCompletionReports.$inferSelect;

      if (existing) {
        const [updated] = await db
          .update(jobCompletionReports)
          .set({
            version: existing.version + 1,
            status: reportStatus,
            syncStatus: "SYNCED",
            clientMutationId: body.clientMutationId ?? null,
            workSummary: body.workSummary,
            diagnosis: body.diagnosis,
            workStartedAt: new Date(body.workStartedAt),
            workCompletedAt: new Date(body.workCompletedAt),
            assetId: body.assetId ?? existing.assetId,
            partsInstalled: body.partsInstalled,
            testsPerformed: body.testsPerformed,
            beforePhotos: body.beforePhotos,
            afterPhotos: body.afterPhotos,
            permitId: body.permitId ?? existing.permitId,
            outstandingIssues: body.outstandingIssues,
            maintenanceRecommendations: body.maintenanceRecommendations,
            updatedAt: new Date(),
          })
          .where(eq(jobCompletionReports.id, existing.id))
          .returning();
        savedRow = updated!;
      } else {
        const [inserted] = await db
          .insert(jobCompletionReports)
          .values({
            jobId,
            serviceRequestId: jobRow.serviceRequestId,
            contractorId: jobRow.contractorId,
            technicianId: jobRow.technicianId,
            propertyId: jobRow.propertyId,
            reportNumber,
            version: 1,
            status: reportStatus,
            syncStatus: "SYNCED",
            clientMutationId: body.clientMutationId ?? null,
            workSummary: body.workSummary,
            diagnosis: body.diagnosis,
            workStartedAt: new Date(body.workStartedAt),
            workCompletedAt: new Date(body.workCompletedAt),
            assetId: body.assetId ?? null,
            partsInstalled: body.partsInstalled,
            testsPerformed: body.testsPerformed,
            beforePhotos: body.beforePhotos,
            afterPhotos: body.afterPhotos,
            permitId: body.permitId ?? null,
            outstandingIssues: body.outstandingIssues,
            maintenanceRecommendations: body.maintenanceRecommendations,
            contractorAttestation: isDraft
              ? {}
              : {
                  attested: true,
                  attestedByUserId: user.id,
                  attestedAt: new Date().toISOString(),
                  technicianName: "Technician",
                },
          })
          .returning();
        savedRow = inserted!;
      }

      await audit(
        user.id,
        isDraft ? "COMPLETION_REPORT_DRAFT_SAVED" : "COMPLETION_REPORT_SUBMITTED",
        "JOB_COMPLETION_REPORT",
        savedRow.id,
        null,
        { jobId, version: savedRow.version, status: savedRow.status },
      );

      return reply.code(existing ? 200 : 201).send({
        completionReport: mapCompletionReportRow(savedRow),
      });
    },
  );

  // POST /v1/jobs/:id/completion-report/attest
  app.post(
    "/v1/jobs/:id/completion-report/attest",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(contractorAttestationSchema, request.body);

      const [reportRow] = await db
        .select()
        .from(jobCompletionReports)
        .where(eq(jobCompletionReports.jobId, jobId))
        .orderBy(desc(jobCompletionReports.version))
        .limit(1);

      if (!reportRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Completion report not found",
        });
      }

      const attestation: ContractorAttestation = {
        attested: true,
        attestedByUserId: user.id,
        attestedAt: new Date().toISOString(),
        technicianName: body.technicianName,
        licenseNumber: body.licenseNumber,
      };

      const [updated] = await db
        .update(jobCompletionReports)
        .set({
          contractorAttestation: attestation,
          status: "SUBMITTED",
          updatedAt: new Date(),
        })
        .where(eq(jobCompletionReports.id, reportRow.id))
        .returning();

      await audit(
        user.id,
        "COMPLETION_REPORT_ATTESTED",
        "JOB_COMPLETION_REPORT",
        reportRow.id,
        null,
        attestation,
      );

      return reply.code(200).send({
        completionReport: mapCompletionReportRow(updated!),
      });
    },
  );

  // POST /v1/jobs/:id/completion-report/accept
  app.post(
    "/v1/jobs/:id/completion-report/accept",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(customerAcceptanceSchema, request.body);

      const [jobRow] = await db
        .select({
          id: jobs.id,
          customerId: serviceRequests.customerId,
          propertyId: serviceRequests.propertyId,
          verticalId: serviceRequests.verticalId,
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

      // Only customer of job or ops can accept completion
      if (!isOps(user) && user.id !== jobRow.customerId) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only customer or operations can accept the completion report",
        });
      }

      const [reportRow] = await db
        .select()
        .from(jobCompletionReports)
        .where(eq(jobCompletionReports.jobId, jobId))
        .orderBy(desc(jobCompletionReports.version))
        .limit(1);

      if (!reportRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Completion report not found",
        });
      }

      if (reportRow.status === "ACCEPTED") {
        return reply.code(200).send({
          message: "Completion report is already accepted",
          completionReport: mapCompletionReportRow(reportRow),
        });
      }

      const acceptance: CustomerAcceptance = {
        accepted: body.accepted,
        acceptedByUserId: user.id,
        acceptedAt: new Date().toISOString(),
        notes: body.notes,
        signatureDigest: body.signatureDigest,
      };

      const [updated] = await db
        .update(jobCompletionReports)
        .set({
          status: "ACCEPTED",
          customerAcceptance: acceptance,
          updatedAt: new Date(),
        })
        .where(eq(jobCompletionReports.id, reportRow.id))
        .returning();

      // Upsert into service_records for Property Service Passport linkage
      await db
        .insert(serviceRecords)
        .values({
          propertyId: reportRow.propertyId,
          jobId: reportRow.jobId,
          verticalId: jobRow.verticalId,
          summary: reportRow.workSummary,
          equipment: {
            partsInstalled: reportRow.partsInstalled,
            testsPerformed: reportRow.testsPerformed,
          },
          completedAt: reportRow.workCompletedAt,
        })
        .onConflictDoUpdate({
          target: serviceRecords.jobId,
          set: {
            summary: reportRow.workSummary,
            equipment: {
              partsInstalled: reportRow.partsInstalled,
              testsPerformed: reportRow.testsPerformed,
            },
          },
        });

      await audit(
        user.id,
        "COMPLETION_REPORT_ACCEPTED",
        "JOB_COMPLETION_REPORT",
        reportRow.id,
        null,
        acceptance,
      );

      return reply.code(200).send({
        completionReport: mapCompletionReportRow(updated!),
      });
    },
  );

  // POST /v1/jobs/:id/completion-report/dispute
  app.post(
    "/v1/jobs/:id/completion-report/dispute",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(disputeCompletionReportSchema, request.body);

      const [jobRow] = await db
        .select({
          id: jobs.id,
          customerId: serviceRequests.customerId,
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

      if (!isOps(user) && user.id !== jobRow.customerId) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only customer or operations can dispute the completion report",
        });
      }

      const [reportRow] = await db
        .select()
        .from(jobCompletionReports)
        .where(eq(jobCompletionReports.jobId, jobId))
        .orderBy(desc(jobCompletionReports.version))
        .limit(1);

      if (!reportRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Completion report not found",
        });
      }

      const [updated] = await db
        .update(jobCompletionReports)
        .set({
          status: "DISPUTED",
          disputeReason: body.reason,
          disputedAt: new Date(),
          disputedByUserId: user.id,
          updatedAt: new Date(),
        })
        .where(eq(jobCompletionReports.id, reportRow.id))
        .returning();

      await audit(
        user.id,
        "COMPLETION_REPORT_DISPUTED",
        "JOB_COMPLETION_REPORT",
        reportRow.id,
        null,
        { reason: body.reason },
      );

      return reply.code(200).send({
        completionReport: mapCompletionReportRow(updated!),
      });
    },
  );
};
