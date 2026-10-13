import type { FastifyPluginAsync } from "fastify";
import { hasRole, requireRole } from "@marketplace/auth";
import type {
  DefectSeverity,
  DefectStatus,
  ElectricalPermit,
  InspectionStatus,
  PermitDeficiency,
  PermitStatus,
  RegulatorySignOffStatus,
} from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  desc,
  jobs,
  electricalPermits,
  permitDeficiencies,
  properties,
  serviceRecords,
  contractors,
  technicians,
  serviceRequests,
} from "@marketplace/database";
import {
  clearPermitDeficiencySchema,
  coordinateUtilitySchema,
  documentRegulatoryExceptionSchema,
  fileElectricalPermitSchema,
  recordPermitDeficiencySchema,
  rectifyPermitDeficiencySchema,
  uploadCertificateOfAcceptanceSchema,
  uuid,
} from "@marketplace/validation";
import { evaluateElectricalAcceptance } from "@marketplace/vertical-engine";
import { z } from "zod";
import { actor, authenticate, isOps, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

function toElectricalPermit(
  row: typeof electricalPermits.$inferSelect,
): ElectricalPermit {
  return {
    id: row.id,
    permitNumber: row.permitNumber,
    jobId: row.jobId,
    propertyId: row.propertyId,
    contractorId: row.contractorId,
    technicianId: row.technicianId,
    jurisdiction: row.jurisdiction,
    permitAuthority: row.permitAuthority,
    permitType: row.permitType,
    esaNotificationNumber: row.esaNotificationNumber,
    ecraLicenseNumber: row.ecraLicenseNumber,
    designatedMasterElectrician: row.designatedMasterElectrician,
    scopeOfWork: row.scopeOfWork,
    status: row.status as PermitStatus,
    utilityDisconnectRequired: row.utilityDisconnectRequired,
    utilityProvider: row.utilityProvider,
    utilityMeterNumber: row.utilityMeterNumber,
    utilityDisconnectDate: row.utilityDisconnectDate?.toISOString() ?? null,
    utilityReconnectAuthorizationCode: row.utilityReconnectAuthorizationCode,
    utilityReconnectDate: row.utilityReconnectDate?.toISOString() ?? null,
    inspectionStatus: row.inspectionStatus as InspectionStatus,
    inspectorName: row.inspectorName,
    inspectorBadgeNumber: row.inspectorBadgeNumber,
    inspectedAt: row.inspectedAt?.toISOString() ?? null,
    certificateOfAcceptanceNumber: row.certificateOfAcceptanceNumber,
    certificateOfAcceptanceUrl: row.certificateOfAcceptanceUrl,
    certificateOfAcceptanceIssuedAt:
      row.certificateOfAcceptanceIssuedAt?.toISOString() ?? null,
    documentedExceptionReason: row.documentedExceptionReason,
    documentedExceptionApprovedByUserId: row.documentedExceptionApprovedByUserId,
    documentedExceptionAt: row.documentedExceptionAt?.toISOString() ?? null,
    regulatorySignOffStatus: row.regulatorySignOffStatus as RegulatorySignOffStatus,
    provenanceAudit: (row.provenanceAudit as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPermitDeficiency(
  row: typeof permitDeficiencies.$inferSelect,
): PermitDeficiency {
  return {
    id: row.id,
    permitId: row.permitId,
    defectCode: row.defectCode,
    severity: row.severity as DefectSeverity,
    description: row.description,
    correctiveActionRequired: row.correctiveActionRequired,
    status: row.status as DefectStatus,
    issuedAt: row.issuedAt.toISOString(),
    rectifiedAt: row.rectifiedAt?.toISOString() ?? null,
    rectifiedByUserId: row.rectifiedByUserId,
    rectificationNotes: row.rectificationNotes,
    rectificationEvidenceUrl: row.rectificationEvidenceUrl,
    clearedAt: row.clearedAt?.toISOString() ?? null,
    clearedByInspector: row.clearedByInspector,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function generatePermitNumber(): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `PERM-${yearMonth}-${randomSuffix}`;
}

export const permitsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * 1. File Electrical Permit / Notification with ESA
   */
  app.post(
    "/v1/permits/electrical",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
        "TECHNICIAN",
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const body = parse(fileElectricalPermitSchema, request.body);

      // Verify job exists
      const [job] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          technicianId: jobs.technicianId,
          serviceRequestId: jobs.serviceRequestId,
          propertyId: serviceRequests.propertyId,
        })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(eq(jobs.id, body.jobId))
        .limit(1);

      if (!job) {
        return reply.status(404).send({
          code: "JOB_NOT_FOUND",
          message: "Job not found",
        });
      }

      // Tenant isolation: if contractor actor, must match job's contractor
      if (
        hasRole(currentActor, "CONTRACTOR_OWNER", "CONTRACTOR_MANAGER") &&
        currentActor.contractorId &&
        currentActor.contractorId !== job.contractorId
      ) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }

      const permitNumber = generatePermitNumber();

      const result = await db.transaction(async (tx) => {
        const [permitRow] = await tx
          .insert(electricalPermits)
          .values({
            permitNumber,
            jobId: job.id,
            propertyId: job.propertyId,
            contractorId: job.contractorId,
            technicianId: job.technicianId,
            jurisdiction: "ON",
            permitAuthority: "ESA",
            permitType: "ESA_LEC_NOTIFICATION",
            esaNotificationNumber: body.esaNotificationNumber,
            ecraLicenseNumber: body.ecraLicenseNumber,
            designatedMasterElectrician: body.designatedMasterElectrician,
            scopeOfWork: body.scopeOfWork,
            status: "FILED",
            utilityDisconnectRequired: body.utilityDisconnectRequired,
            utilityProvider: body.utilityProvider ?? null,
            utilityMeterNumber: body.utilityMeterNumber ?? null,
            utilityDisconnectDate: body.utilityDisconnectDate
              ? new Date(body.utilityDisconnectDate)
              : null,
            inspectionStatus: "NOT_REQUESTED",
            regulatorySignOffStatus: "PENDING",
            provenanceAudit: {
              filedByUserId: currentActor.id,
              filedAt: new Date().toISOString(),
            },
          })
          .returning();

        if (!permitRow) throw new Error("Failed to insert electrical permit");

        // Mark job as permit_required and sign-off pending
        await tx
          .update(jobs)
          .set({
            permitRequired: true,
            regulatorySignOffStatus: "PENDING",
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, job.id));

        return permitRow;
      });

      await audit(
        currentActor.id,
        "ELECTRICAL_PERMIT_FILED",
        "electrical_permits",
        result.id,
        null,
        result,
        {
          esaNotificationNumber: body.esaNotificationNumber,
          ecraLicenseNumber: body.ecraLicenseNumber,
        },
      );

      return reply.status(201).send(result);
    },
  );

  /**
   * 2. Get Electrical Permit & Acceptance Status for a Job
   */
  app.get(
    "/v1/permits/jobs/:jobId",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const jobId = parse(z.object({ jobId: uuid }), request.params).jobId;

      const [job] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          permitRequired: jobs.permitRequired,
          regulatorySignOffStatus: jobs.regulatorySignOffStatus,
          certificateOfAcceptanceNumber: jobs.certificateOfAcceptanceNumber,
          serviceRequestId: jobs.serviceRequestId,
          customerId: serviceRequests.customerId,
        })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Tenant isolation
      if (
        hasRole(currentActor, "CUSTOMER") &&
        currentActor.id !== job.customerId
      ) {
        return reply.status(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      }
      if (
        hasRole(currentActor, "CONTRACTOR_OWNER") &&
        currentActor.contractorId !== job.contractorId
      ) {
        return reply.status(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      }

      const [permit] = await db
        .select()
        .from(electricalPermits)
        .where(eq(electricalPermits.jobId, jobId))
        .limit(1);

      let deficiencies: PermitDeficiency[] = [];
      if (permit) {
        const rawDeficiencies = await db
          .select()
          .from(permitDeficiencies)
          .where(eq(permitDeficiencies.permitId, permit.id))
          .orderBy(desc(permitDeficiencies.createdAt));
        deficiencies = rawDeficiencies.map(toPermitDeficiency);
      }

      const evaluation = evaluateElectricalAcceptance({
        isPermitRequired: job.permitRequired,
        permit: permit ? toElectricalPermit(permit) : null,
        deficiencies,
      });

      return reply.status(200).send({
        job: {
          id: job.id,
          permitRequired: job.permitRequired,
          regulatorySignOffStatus: job.regulatorySignOffStatus,
          certificateOfAcceptanceNumber: job.certificateOfAcceptanceNumber,
        },
        permit: permit ?? null,
        deficiencies,
        acceptanceEvaluation: evaluation,
      });
    },
  );

  /**
   * 3. Coordinate Utility Disconnect & Reconnect Authorization
   */
  app.post(
    "/v1/permits/electrical/:id/utility",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "TECHNICIAN",
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const permitId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(coordinateUtilitySchema, request.body);

      const [permit] = await db
        .select()
        .from(electricalPermits)
        .where(eq(electricalPermits.id, permitId))
        .limit(1);

      if (!permit) {
        return reply.status(404).send({
          code: "PERMIT_NOT_FOUND",
          message: "Electrical permit not found",
        });
      }

      const [updated] = await db
        .update(electricalPermits)
        .set({
          utilityProvider: body.utilityProvider,
          utilityMeterNumber: body.utilityMeterNumber,
          utilityDisconnectDate: body.utilityDisconnectDate
            ? new Date(body.utilityDisconnectDate)
            : permit.utilityDisconnectDate,
          utilityReconnectAuthorizationCode:
            body.utilityReconnectAuthorizationCode,
          utilityReconnectDate: body.utilityReconnectDate
            ? new Date(body.utilityReconnectDate)
            : new Date(),
          status: "WORK_COMPLETED",
          updatedAt: new Date(),
        })
        .where(eq(electricalPermits.id, permitId))
        .returning();

      await audit(
        currentActor.id,
        "UTILITY_RECONNECT_COORDINATED",
        "electrical_permits",
        permitId,
        permit,
        updated,
        {
          reconnectAuthCode: body.utilityReconnectAuthorizationCode,
          provider: body.utilityProvider,
        },
      );

      return reply.status(200).send(updated);
    },
  );

  /**
   * 4. Record ESA Inspector Deficiency / Defect Notice
   */
  app.post(
    "/v1/permits/electrical/:id/deficiencies",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const permitId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(recordPermitDeficiencySchema, request.body);

      const [permit] = await db
        .select()
        .from(electricalPermits)
        .where(eq(electricalPermits.id, permitId))
        .limit(1);

      if (!permit) {
        return reply.status(404).send({
          code: "PERMIT_NOT_FOUND",
          message: "Electrical permit not found",
        });
      }

      const result = await db.transaction(async (tx) => {
        const [defRow] = await tx
          .insert(permitDeficiencies)
          .values({
            permitId,
            defectCode: body.defectCode,
            severity: body.severity,
            description: body.description,
            correctiveActionRequired: body.correctiveActionRequired,
            status: "OPEN",
          })
          .returning();

        // Update permit status to DEFICIENCIES_RECORDED & DEFICIENCIES_OUTSTANDING
        await tx
          .update(electricalPermits)
          .set({
            status: "DEFICIENCIES_RECORDED",
            inspectionStatus: "DEFICIENCIES_ISSUED",
            regulatorySignOffStatus: "DEFICIENCIES_OUTSTANDING",
            updatedAt: new Date(),
          })
          .where(eq(electricalPermits.id, permitId));

        // Update job status to DEFICIENCIES_OUTSTANDING
        await tx
          .update(jobs)
          .set({
            regulatorySignOffStatus: "DEFICIENCIES_OUTSTANDING",
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, permit.jobId));

        return defRow;
      });

      return reply.status(201).send(result);
    },
  );

  /**
   * 5. Contractor Rectifies Defect
   */
  app.post(
    "/v1/permits/electrical/:id/deficiencies/:defectId/rectify",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "TECHNICIAN",
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const params = parse(
        z.object({ id: uuid, defectId: uuid }),
        request.params,
      );
      const body = parse(rectifyPermitDeficiencySchema, request.body);

      const [defect] = await db
        .select()
        .from(permitDeficiencies)
        .where(
          and(
            eq(permitDeficiencies.id, params.defectId),
            eq(permitDeficiencies.permitId, params.id),
          ),
        )
        .limit(1);

      if (!defect) {
        return reply.status(404).send({
          code: "DEFICIENCY_NOT_FOUND",
          message: "Deficiency not found",
        });
      }

      const [updated] = await db
        .update(permitDeficiencies)
        .set({
          status: "RECTIFIED",
          rectifiedAt: new Date(),
          rectifiedByUserId: currentActor.id,
          rectificationNotes: body.rectificationNotes,
          rectificationEvidenceUrl: body.rectificationEvidenceUrl ?? null,
          updatedAt: new Date(),
        })
        .where(eq(permitDeficiencies.id, params.defectId))
        .returning();

      return reply.status(200).send(updated);
    },
  );

  /**
   * 6. Inspector Clears Defect
   */
  app.post(
    "/v1/permits/electrical/:id/deficiencies/:defectId/clear",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const params = parse(
        z.object({ id: uuid, defectId: uuid }),
        request.params,
      );
      const body = parse(clearPermitDeficiencySchema, request.body);

      const [defect] = await db
        .select()
        .from(permitDeficiencies)
        .where(
          and(
            eq(permitDeficiencies.id, params.defectId),
            eq(permitDeficiencies.permitId, params.id),
          ),
        )
        .limit(1);

      if (!defect) {
        return reply.status(404).send({
          code: "DEFICIENCY_NOT_FOUND",
          message: "Deficiency not found",
        });
      }

      const [updated] = await db
        .update(permitDeficiencies)
        .set({
          status: "CLEARED_BY_INSPECTOR",
          clearedAt: new Date(),
          clearedByInspector: body.clearedByInspector,
          updatedAt: new Date(),
        })
        .where(eq(permitDeficiencies.id, params.defectId))
        .returning();

      return reply.status(200).send(updated);
    },
  );

  /**
   * 7. Upload & Verify Official Certificate of Acceptance (ESA Regulatory Sign-Off)
   */
  app.post(
    "/v1/permits/electrical/:id/certificate-of-acceptance",
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
      );

      const permitId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(uploadCertificateOfAcceptanceSchema, request.body);

      const [permit] = await db
        .select()
        .from(electricalPermits)
        .where(eq(electricalPermits.id, permitId))
        .limit(1);

      if (!permit) {
        return reply.status(404).send({
          code: "PERMIT_NOT_FOUND",
          message: "Electrical permit not found",
        });
      }

      // Check if any open or un-cleared defects remain
      const activeDefects = await db
        .select()
        .from(permitDeficiencies)
        .where(
          and(
            eq(permitDeficiencies.permitId, permitId),
            eq(permitDeficiencies.status, "OPEN"),
          ),
        );

      if (activeDefects.length > 0) {
        return reply.status(422).send({
          code: "UNRESOLVED_ESA_DEFICIENCIES",
          message:
            "Cannot register Certificate of Acceptance while open inspector defect notices exist",
          details: { openDefectsCount: activeDefects.length },
        });
      }

      const issuedAt = body.issuedAt ? new Date(body.issuedAt) : new Date();

      const result = await db.transaction(async (tx) => {
        // Update permit
        const [updatedPermit] = await tx
          .update(electricalPermits)
          .set({
            certificateOfAcceptanceNumber: body.certificateOfAcceptanceNumber,
            certificateOfAcceptanceUrl: body.certificateOfAcceptanceUrl ?? null,
            certificateOfAcceptanceIssuedAt: issuedAt,
            inspectorName: body.inspectorName,
            inspectorBadgeNumber: body.inspectorBadgeNumber ?? null,
            inspectedAt: issuedAt,
            inspectionStatus: "PASSED",
            status: "CERTIFICATE_ISSUED",
            regulatorySignOffStatus: "FULLY_ACCEPTED",
            updatedAt: new Date(),
          })
          .where(eq(electricalPermits.id, permitId))
          .returning();

        // Update jobs table
        await tx
          .update(jobs)
          .set({
            certificateOfAcceptanceNumber: body.certificateOfAcceptanceNumber,
            regulatorySignOffStatus: "FULLY_ACCEPTED",
            regulatorySignedOffAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, permit.jobId));

        // Update service_records table if exists
        await tx
          .update(serviceRecords)
          .set({
            permitId,
            certificateOfAcceptanceNumber: body.certificateOfAcceptanceNumber,
            regulatorySignOffStatus: "FULLY_ACCEPTED",
          })
          .where(eq(serviceRecords.jobId, permit.jobId));

        return updatedPermit;
      });

      await audit(
        currentActor.id,
        "CERTIFICATE_OF_ACCEPTANCE_ISSUED",
        "electrical_permits",
        permitId,
        permit,
        result,
        {
          certificateNumber: body.certificateOfAcceptanceNumber,
          inspectorName: body.inspectorName,
        },
      );

      return reply.status(200).send(result);
    },
  );

  /**
   * 8. Document Regulatory Exception (Admin / Ops only)
   */
  app.post(
    "/v1/permits/electrical/:id/exception",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "ADMIN", "SUPER_ADMIN");

      const permitId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(documentRegulatoryExceptionSchema, request.body);

      const [permit] = await db
        .select()
        .from(electricalPermits)
        .where(eq(electricalPermits.id, permitId))
        .limit(1);

      if (!permit) {
        return reply.status(404).send({
          code: "PERMIT_NOT_FOUND",
          message: "Electrical permit not found",
        });
      }

      const result = await db.transaction(async (tx) => {
        const [updatedPermit] = await tx
          .update(electricalPermits)
          .set({
            documentedExceptionReason: `${body.exceptionRuleReference}: ${body.documentedExceptionReason}`,
            documentedExceptionApprovedByUserId: currentActor.id,
            documentedExceptionAt: new Date(),
            status: "EXCEPTION_APPROVED",
            inspectionStatus: "WAIVED_EXCEPTION",
            regulatorySignOffStatus: "EXCEPTION_APPROVED",
            updatedAt: new Date(),
          })
          .where(eq(electricalPermits.id, permitId))
          .returning();

        await tx
          .update(jobs)
          .set({
            regulatorySignOffStatus: "EXCEPTION_APPROVED",
            regulatorySignedOffAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, permit.jobId));

        await tx
          .update(serviceRecords)
          .set({
            permitId,
            regulatorySignOffStatus: "EXCEPTION_APPROVED",
          })
          .where(eq(serviceRecords.jobId, permit.jobId));

        return updatedPermit;
      });

      await audit(
        currentActor.id,
        "REGULATORY_EXCEPTION_DOCUMENTED",
        "electrical_permits",
        permitId,
        permit,
        result,
        {
          reason: body.documentedExceptionReason,
          reference: body.exceptionRuleReference,
        },
      );

      return reply.status(200).send(result);
    },
  );

  /**
   * 9. Accept Job Completion Gate
   * Prevents customer/platform full acceptance if inspection-required work
   * lacks Certificate of Acceptance or documented exception (#59 acceptance criteria).
   */
  app.post(
    "/v1/jobs/:id/accept-completion",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;

      const [job] = await db
        .select({
          id: jobs.id,
          status: jobs.status,
          contractorId: jobs.contractorId,
          permitRequired: jobs.permitRequired,
          regulatorySignOffStatus: jobs.regulatorySignOffStatus,
          serviceRequestId: jobs.serviceRequestId,
          customerId: serviceRequests.customerId,
        })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Check tenant authorization
      if (
        hasRole(currentActor, "CUSTOMER") &&
        currentActor.id !== job.customerId
      ) {
        return reply.status(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      }

      // Check electrical regulatory evaluation
      const [permit] = await db
        .select()
        .from(electricalPermits)
        .where(eq(electricalPermits.jobId, jobId))
        .limit(1);

      let deficiencies: PermitDeficiency[] = [];
      if (permit) {
        const rawDeficiencies = await db
          .select()
          .from(permitDeficiencies)
          .where(eq(permitDeficiencies.permitId, permit.id));
        deficiencies = rawDeficiencies.map(toPermitDeficiency);
      }

      const evaluation = evaluateElectricalAcceptance({
        isPermitRequired: job.permitRequired,
        permit: permit ? toElectricalPermit(permit) : null,
        deficiencies,
      });

      if (!evaluation.canFullyAccept) {
        return reply.status(422).send({
          code: "REGULATORY_SIGN_OFF_REQUIRED",
          message:
            "Electrical work cannot be fully accepted without required regulatory sign-off or documented exception",
          details: {
            missingItems: evaluation.missingItems,
            regulatorySignOffStatus: evaluation.regulatorySignOffStatus,
            customerSummary: evaluation.customerSummary,
          },
        });
      }

      // Regulatory sign-off achieved: mark job closed/fully accepted
      await db
        .update(jobs)
        .set({
          status: "CLOSED",
          regulatorySignOffStatus: evaluation.regulatorySignOffStatus,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      return reply.status(200).send({
        jobId,
        status: "CLOSED",
        fullyAccepted: true,
        regulatorySignOffStatus: evaluation.regulatorySignOffStatus,
        certificateOfAcceptanceNumber:
          permit?.certificateOfAcceptanceNumber ?? null,
      });
    },
  );
};
