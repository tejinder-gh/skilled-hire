import type { FastifyPluginAsync } from "fastify";
import { hasRole, requireRole } from "@marketplace/auth";
import type {
  QuarantineScope,
  SafetyActionType,
  SafetyIncidentSeverity,
  SafetyIncidentStatus,
} from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  desc,
  or,
  safetyIncidents,
  safetyIncidentActions,
  contractorSafetyQuarantines,
  qualityAudits,
  contractors,
  technicians,
  jobs,
  serviceRequests,
  properties,
} from "@marketplace/database";
import {
  conductQualityAuditSchema,
  createQualityAuditSchema,
  recordSafetyActionSchema,
  reportSafetyIncidentSchema,
  submitRemediationSchema,
  triageSafetyIncidentSchema,
  uuid,
} from "@marketplace/validation";
import { evaluateIncidentTriage } from "@marketplace/vertical-engine";
import { z } from "zod";
import { actor, authenticate, isOps, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

function generateIncidentNumber(): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `INC-${yearMonth}-${randomSuffix}`;
}

function generateAuditNumber(): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `AUD-${yearMonth}-${randomSuffix}`;
}

export const safetyRoutes: FastifyPluginAsync = async (app) => {
  /**
   * 1. Report a safety incident
   * Accessible by CUSTOMER, CONTRACTOR, TECHNICIAN, DISPATCHER, ADMIN
   */
  app.post(
    "/v1/safety/incidents",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const body = parse(reportSafetyIncidentSchema, request.body);

      // Verify contractor exists
      const [contractor] = await db
        .select({ id: contractors.id, name: contractors.name })
        .from(contractors)
        .where(eq(contractors.id, body.contractorId))
        .limit(1);

      if (!contractor) {
        return reply.status(404).send({
          code: "CONTRACTOR_NOT_FOUND",
          message: "Contractor not found",
        });
      }

      // If job ID provided, verify job
      let propertyId = body.propertyId;
      let serviceRequestId = body.serviceRequestId;
      if (body.jobId) {
        const [job] = await db
          .select({
            id: jobs.id,
            propertyId: properties.id,
            serviceRequestId: jobs.serviceRequestId,
          })
          .from(jobs)
          .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
          .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
          .where(eq(jobs.id, body.jobId))
          .limit(1);

        if (job) {
          propertyId = propertyId ?? job.propertyId;
          serviceRequestId = serviceRequestId ?? job.serviceRequestId;
        }
      }

      // Check repeat defects for contractor
      const pastAudits = await db
        .select({ id: qualityAudits.id })
        .from(qualityAudits)
        .where(
          and(
            eq(qualityAudits.contractorId, body.contractorId),
            or(
              eq(qualityAudits.status, "DEFECTS_IDENTIFIED"),
              eq(qualityAudits.status, "FAILED_CRITICAL"),
            ),
          ),
        );

      const triageAnalysis = evaluateIncidentTriage({
        incidentType: body.incidentType,
        reportedSeverity: (body.severity ?? "MODERATE_DEFECT") as SafetyIncidentSeverity,
        contractorId: body.contractorId,
        technicianId: body.technicianId,
        repeatDefectsCount: pastAudits.length,
      });

      const incidentNumber = generateIncidentNumber();
      const shouldQuarantine =
        body.immediateQuarantine || triageAnalysis.mandatoryQuarantine;

      const incidentStatus: SafetyIncidentStatus = shouldQuarantine
        ? "QUARANTINED"
        : triageAnalysis.emergencyEscalation
          ? "TRIAGED"
          : "REPORTED";

      const created = await db.transaction(async (tx) => {
        const [incidentRow] = await tx
          .insert(safetyIncidents)
          .values({
            incidentNumber,
            jobId: body.jobId ?? null,
            serviceRequestId: serviceRequestId ?? null,
            propertyId: propertyId ?? null,
            contractorId: body.contractorId,
            technicianId: body.technicianId ?? null,
            reportedByUserId: currentActor.id,
            reporterRole: body.reporterRole,
            severity: triageAnalysis.recommendedSeverity,
            status: incidentStatus,
            incidentType: body.incidentType,
            title: body.title,
            description: body.description,
            occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
            containmentActions: body.containmentActions as any,
            evidenceLocker: body.evidenceLocker as any,
            quarantineScope: triageAnalysis.recommendedQuarantineScope as any,
            legalRetentionHold: triageAnalysis.emergencyEscalation,
            triageNotes: triageAnalysis.rationale.join(" | "),
            triagedByUserId: currentActor.id,
            triagedAt: new Date(),
          })
          .returning();

        if (!incidentRow) throw new Error("Failed to create safety incident");

        // Action log
        await tx.insert(safetyIncidentActions).values({
          incidentId: incidentRow.id,
          actorUserId: currentActor.id,
          actionType: triageAnalysis.emergencyEscalation
            ? "EMERGENCY_ESCALATION"
            : "TRIAGE",
          previousStatus: null,
          newStatus: incidentStatus,
          actionPayload: {
            triageAnalysis,
            initialReport: body,
          },
          notes: triageAnalysis.rationale.join(" | "),
        });

        // If quarantine mandated, suspend contractor and/or technician
        if (shouldQuarantine) {
          const qScope = triageAnalysis.recommendedQuarantineScope;
          if (qScope.contractorSuspended) {
            await tx
              .update(contractors)
              .set({
                safetyStatus: "SUSPENDED",
                suspendedAt: new Date(),
                suspensionReason: `Safety incident ${incidentNumber}: ${body.title}`,
              })
              .where(eq(contractors.id, body.contractorId));

            await tx.insert(contractorSafetyQuarantines).values({
              incidentId: incidentRow.id,
              contractorId: body.contractorId,
              technicianId: body.technicianId ?? null,
              quarantineType: "FULL_CONTRACTOR_SUSPENSION",
              restrictedVerticalIds: qScope.restrictedVerticalIds as any,
              restrictedIssueTypeIds: qScope.restrictedIssueTypeIds as any,
              active: true,
              reason: `Mandatory suspension from incident ${incidentNumber}`,
              issuedByUserId: currentActor.id,
            });

            await tx.insert(safetyIncidentActions).values({
              incidentId: incidentRow.id,
              actorUserId: currentActor.id,
              actionType: "CONTRACTOR_SUSPENDED",
              previousStatus: "REPORTED",
              newStatus: "QUARANTINED",
              notes: `Contractor placed under emergency suspension due to safety incident ${incidentNumber}`,
            });
          }

          if (qScope.technicianSuspended && body.technicianId) {
            await tx
              .update(technicians)
              .set({
                safetyStatus: "SUSPENDED",
                suspendedAt: new Date(),
                suspensionReason: `Safety incident ${incidentNumber}: ${body.title}`,
              })
              .where(eq(technicians.id, body.technicianId));

            await tx.insert(safetyIncidentActions).values({
              incidentId: incidentRow.id,
              actorUserId: currentActor.id,
              actionType: "TECHNICIAN_SUSPENDED",
              previousStatus: "REPORTED",
              newStatus: "QUARANTINED",
              notes: `Technician placed under emergency suspension due to safety incident ${incidentNumber}`,
            });
          }
        }

        return incidentRow;
      });

      await audit(
        currentActor.id,
        "SAFETY_INCIDENT_REPORTED",
        "safety_incident",
        created.id,
        null,
        created,
        {
          incidentNumber,
          severity: created.severity,
          status: created.status,
          contractorId: created.contractorId,
        },
      );

      return reply.status(201).send(created);
    },
  );

  /**
   * 2. List safety incidents
   * Scoped by caller role
   */
  app.get(
    "/v1/safety/incidents",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const query = parse(
        z.object({
          contractorId: uuid.optional(),
          propertyId: uuid.optional(),
          severity: z.string().optional(),
          status: z.string().optional(),
        }),
        request.query,
      );

      let conditions: any[] = [];

      // Role isolation
      if (
        !hasRole(currentActor, "ADMIN", "SUPER_ADMIN") &&
        !isOps(currentActor)
      ) {
        if (hasRole(currentActor, "CONTRACTOR_OWNER")) {
          if (!currentActor.contractorId) {
            return reply.status(200).send({ incidents: [] });
          }
          conditions.push(
            eq(safetyIncidents.contractorId, currentActor.contractorId),
          );
        } else if (hasRole(currentActor, "CUSTOMER")) {
          conditions.push(eq(safetyIncidents.reportedByUserId, currentActor.id));
        }
      }

      if (query.contractorId) {
        conditions.push(eq(safetyIncidents.contractorId, query.contractorId));
      }
      if (query.propertyId) {
        conditions.push(eq(safetyIncidents.propertyId, query.propertyId));
      }
      if (query.severity) {
        conditions.push(eq(safetyIncidents.severity, query.severity));
      }
      if (query.status) {
        conditions.push(eq(safetyIncidents.status, query.status));
      }

      const rows = await db
        .select()
        .from(safetyIncidents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(safetyIncidents.createdAt));

      return reply.status(200).send({ incidents: rows });
    },
  );

  /**
   * 3. Get single incident dossier with action history & quarantines
   */
  app.get(
    "/v1/safety/incidents/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const incidentId = parse(z.object({ id: uuid }), request.params).id;

      const [incident] = await db
        .select()
        .from(safetyIncidents)
        .where(eq(safetyIncidents.id, incidentId))
        .limit(1);

      if (!incident) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Safety incident not found",
        });
      }

      // Tenant authorization check
      if (
        !hasRole(currentActor, "ADMIN", "SUPER_ADMIN") &&
        !isOps(currentActor)
      ) {
        if (
          hasRole(currentActor, "CONTRACTOR_OWNER") &&
          currentActor.contractorId !== incident.contractorId
        ) {
          return reply.status(403).send({
            code: "FORBIDDEN",
            message: "Not authorized to view safety incident for other contractor",
          });
        }
        if (
          hasRole(currentActor, "CUSTOMER") &&
          currentActor.id !== incident.reportedByUserId
        ) {
          return reply.status(403).send({
            code: "FORBIDDEN",
            message: "Not authorized to view safety incident",
          });
        }
      }

      const actions = await db
        .select()
        .from(safetyIncidentActions)
        .where(eq(safetyIncidentActions.incidentId, incidentId))
        .orderBy(safetyIncidentActions.createdAt);

      const quarantines = await db
        .select()
        .from(contractorSafetyQuarantines)
        .where(eq(contractorSafetyQuarantines.incidentId, incidentId));

      return reply.status(200).send({
        incident,
        actions,
        quarantines,
      });
    },
  );

  /**
   * 4. Triage and escalate safety incident (Ops / Admin only)
   */
  app.post(
    "/v1/safety/incidents/:id/triage",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "OPERATIONS_AGENT", "DISPATCHER", "ADMIN", "SUPER_ADMIN");
      const incidentId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(triageSafetyIncidentSchema, request.body);

      const [existing] = await db
        .select()
        .from(safetyIncidents)
        .where(eq(safetyIncidents.id, incidentId))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Safety incident not found",
        });
      }

      const newStatus: SafetyIncidentStatus = body.applyQuarantine
        ? "QUARANTINED"
        : "TRIAGED";

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(safetyIncidents)
          .set({
            severity: body.severity,
            status: newStatus,
            triageNotes: body.triageNotes,
            triagedByUserId: currentActor.id,
            triagedAt: new Date(),
            insurerNotified: body.notifyInsurer || existing.insurerNotified,
            insurerNotifiedAt: body.notifyInsurer ? new Date() : existing.insurerNotifiedAt,
            insurerClaimReference: body.insurerClaimReference ?? existing.insurerClaimReference,
            legalRetentionHold: body.legalRetentionHold || existing.legalRetentionHold,
            quarantineScope: body.applyQuarantine
              ? {
                  contractorSuspended:
                    body.quarantineType === "FULL_CONTRACTOR_SUSPENSION",
                  technicianSuspended:
                    body.quarantineType === "TECHNICIAN_SUSPENSION",
                  restrictedVerticalIds: body.restrictedVerticalIds,
                  restrictedIssueTypeIds: body.restrictedIssueTypeIds,
                }
              : existing.quarantineScope,
            updatedAt: new Date(),
          })
          .where(eq(safetyIncidents.id, incidentId))
          .returning();

        // Action log
        await tx.insert(safetyIncidentActions).values({
          incidentId,
          actorUserId: currentActor.id,
          actionType: "TRIAGE",
          previousStatus: existing.status,
          newStatus,
          actionPayload: body as any,
          notes: body.triageNotes,
        });

        if (body.notifyInsurer) {
          await tx.insert(safetyIncidentActions).values({
            incidentId,
            actorUserId: currentActor.id,
            actionType: "INSURER_NOTIFIED",
            previousStatus: existing.status,
            newStatus,
            actionPayload: { claimRef: body.insurerClaimReference },
            notes: `Insurer claims notification recorded with reference: ${body.insurerClaimReference ?? "N/A"}`,
          });
        }

        // Apply quarantine if specified
        if (body.applyQuarantine && body.quarantineType) {
          const qType = body.quarantineType;
          if (qType === "FULL_CONTRACTOR_SUSPENSION") {
            await tx
              .update(contractors)
              .set({
                safetyStatus: "SUSPENDED",
                suspendedAt: new Date(),
                suspensionReason: `Triage suspension order on incident ${existing.incidentNumber}`,
              })
              .where(eq(contractors.id, existing.contractorId));
          } else if (qType === "VERTICAL_SCOPE_RESTRICTION") {
            await tx
              .update(contractors)
              .set({
                safetyStatus: "RESTRICTED",
              })
              .where(eq(contractors.id, existing.contractorId));
          }

          if (qType === "TECHNICIAN_SUSPENSION" && existing.technicianId) {
            await tx
              .update(technicians)
              .set({
                safetyStatus: "SUSPENDED",
                suspendedAt: new Date(),
                suspensionReason: `Triage suspension order on incident ${existing.incidentNumber}`,
              })
              .where(eq(technicians.id, existing.technicianId));
          }

          await tx.insert(contractorSafetyQuarantines).values({
            incidentId,
            contractorId: existing.contractorId,
            technicianId: existing.technicianId,
            quarantineType: qType,
            restrictedVerticalIds: body.restrictedVerticalIds as any,
            restrictedIssueTypeIds: body.restrictedIssueTypeIds as any,
            active: true,
            reason: body.triageNotes,
            issuedByUserId: currentActor.id,
          });

          await tx.insert(safetyIncidentActions).values({
            incidentId,
            actorUserId: currentActor.id,
            actionType:
              qType === "FULL_CONTRACTOR_SUSPENSION"
                ? "CONTRACTOR_SUSPENDED"
                : qType === "TECHNICIAN_SUSPENSION"
                  ? "TECHNICIAN_SUSPENDED"
                  : "SCOPE_RESTRICTED",
            previousStatus: existing.status,
            newStatus,
            notes: `Safety quarantine applied: ${qType}`,
          });
        }

        return row;
      });

      return reply.status(200).send(updated);
    },
  );

  /**
   * 5. Record auditable safety action (Ops / Admin / Inspector)
   */
  app.post(
    "/v1/safety/incidents/:id/actions",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const incidentId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(recordSafetyActionSchema, request.body);

      const [existing] = await db
        .select()
        .from(safetyIncidents)
        .where(eq(safetyIncidents.id, incidentId))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Safety incident not found",
        });
      }

      // Check permissions based on action
      if (body.actionType === "APPEAL_FILED") {
        requireRole(currentActor, "CONTRACTOR_OWNER", "ADMIN", "SUPER_ADMIN");
        if (
          hasRole(currentActor, "CONTRACTOR_OWNER") &&
          currentActor.contractorId !== existing.contractorId
        ) {
          return reply.status(403).send({ code: "FORBIDDEN", message: "Forbidden" });
        }
      } else if (body.actionType === "QUARANTINE_LIFTED") {
        requireRole(currentActor, "ADMIN", "SUPER_ADMIN");
      } else {
        requireRole(currentActor, "OPERATIONS_AGENT", "DISPATCHER", "ADMIN", "SUPER_ADMIN");
      }

      const result = await db.transaction(async (tx) => {
        let newIncidentStatus = existing.status;

        if (body.actionType === "QUARANTINE_LIFTED") {
          newIncidentStatus = "RESOLVED";
          // Deactivate quarantines
          await tx
            .update(contractorSafetyQuarantines)
            .set({
              active: false,
              liftedAt: new Date(),
              liftedByUserId: currentActor.id,
              liftingNotes: body.notes ?? "Quarantine lifted following completed remediation",
            })
            .where(
              and(
                eq(contractorSafetyQuarantines.incidentId, incidentId),
                eq(contractorSafetyQuarantines.active, true),
              ),
            );

          // Restore contractor & technician safety status
          await tx
            .update(contractors)
            .set({ safetyStatus: "ACTIVE", suspendedAt: null, suspensionReason: null })
            .where(eq(contractors.id, existing.contractorId));

          if (existing.technicianId) {
            await tx
              .update(technicians)
              .set({ safetyStatus: "ACTIVE", suspendedAt: null, suspensionReason: null })
              .where(eq(technicians.id, existing.technicianId));
          }

          await tx
            .update(safetyIncidents)
            .set({ status: "RESOLVED", resolvedAt: new Date(), updatedAt: new Date() })
            .where(eq(safetyIncidents.id, incidentId));
        } else if (body.actionType === "EVIDENCE_PRESERVED") {
          await tx
            .update(safetyIncidents)
            .set({ legalRetentionHold: true, updatedAt: new Date() })
            .where(eq(safetyIncidents.id, incidentId));
        } else if (body.actionType === "INSURER_NOTIFIED") {
          const claimRef =
            (body.payload as Record<string, unknown> | undefined)?.claimReference ??
            (body.payload as Record<string, unknown> | undefined)?.claimRef;
          await tx
            .update(safetyIncidents)
            .set({
              insurerNotified: true,
              insurerClaimReference: typeof claimRef === "string" ? claimRef : null,
              insurerNotifiedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(safetyIncidents.id, incidentId));
        } else if (body.actionType === "APPEAL_FILED") {
          newIncidentStatus = "APPEALED";
          await tx
            .update(safetyIncidents)
            .set({ status: "APPEALED", updatedAt: new Date() })
            .where(eq(safetyIncidents.id, incidentId));
        } else if (body.actionType === "CLOSED") {
          newIncidentStatus = "CLOSED";
          await tx
            .update(safetyIncidents)
            .set({ status: "CLOSED", updatedAt: new Date() })
            .where(eq(safetyIncidents.id, incidentId));
        }

        const [actionRow] = await tx
          .insert(safetyIncidentActions)
          .values({
            incidentId,
            actorUserId: currentActor.id,
            actionType: body.actionType,
            previousStatus: existing.status,
            newStatus: newIncidentStatus,
            actionPayload: body.payload as any,
            notes: body.notes ?? null,
          })
          .returning();

        return actionRow;
      });

      return reply.status(200).send(result);
    },
  );

  /**
   * 6. Submit and review corrective action remediation plan
   */
  app.post(
    "/v1/safety/incidents/:id/remediation",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(
        currentActor,
        "CONTRACTOR_OWNER",
        "OPERATIONS_AGENT",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const incidentId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(submitRemediationSchema, request.body);

      const [existing] = await db
        .select()
        .from(safetyIncidents)
        .where(eq(safetyIncidents.id, incidentId))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Safety incident not found",
        });
      }

      if (
        hasRole(currentActor, "CONTRACTOR_OWNER") &&
        currentActor.contractorId !== existing.contractorId
      ) {
        return reply.status(403).send({ code: "FORBIDDEN", message: "Forbidden" });
      }

      const updated = await db.transaction(async (tx) => {
        const evidenceFiles = (body.evidenceFiles as any[]) ?? [];
        const evidenceMerged = [
          ...((existing.evidenceLocker as any[]) ?? []),
          ...evidenceFiles,
        ];

        const [row] = await tx
          .update(safetyIncidents)
          .set({
            status: "REMEDIATING",
            resolutionSummary: body.resolutionSummary,
            evidenceLocker: evidenceMerged as any,
            updatedAt: new Date(),
          })
          .where(eq(safetyIncidents.id, incidentId))
          .returning();

        await tx.insert(safetyIncidentActions).values({
          incidentId,
          actorUserId: currentActor.id,
          actionType: "REMEDIATION_SUBMITTED",
          previousStatus: existing.status,
          newStatus: "REMEDIATING",
          actionPayload: {
            correctiveActionsTaken: body.correctiveActionsTaken,
            evidenceCount: evidenceFiles.length,
          },
          notes: body.resolutionSummary,
        });

        // If inspection requested, auto-schedule audit
        let auditRecord = null;
        if (body.requestInspection) {
          const auditNumber = generateAuditNumber();
          const [aud] = await tx
            .insert(qualityAudits)
            .values({
              auditNumber,
              jobId: existing.jobId,
              contractorId: existing.contractorId,
              technicianId: existing.technicianId,
              incidentId,
              triggerType: "INCIDENT_REMEDIATION",
              status: "SCHEDULED",
              findings: [],
              remediationRequired: false,
              reportNotes: `Post-incident verification inspection for ${existing.incidentNumber}`,
            })
            .returning();
          auditRecord = aud;

          await tx.insert(safetyIncidentActions).values({
            incidentId,
            actorUserId: currentActor.id,
            actionType: "SPOT_INSPECTION_ORDERED",
            previousStatus: "REMEDIATING",
            newStatus: "REMEDIATING",
            actionPayload: { auditNumber },
            notes: `Independent remediation verification audit scheduled: ${auditNumber}`,
          });
        }

        return { incident: row, audit: auditRecord };
      });

      return reply.status(200).send(updated);
    },
  );

  /**
   * 7. Create quality audit / spot inspection
   */
  app.post(
    "/v1/safety/audits",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "OPERATIONS_AGENT", "DISPATCHER", "ADMIN", "SUPER_ADMIN");
      const body = parse(createQualityAuditSchema, request.body);

      const auditNumber = generateAuditNumber();
      const [auditRow] = await db
        .insert(qualityAudits)
        .values({
          auditNumber,
          jobId: body.jobId ?? null,
          contractorId: body.contractorId,
          technicianId: body.technicianId ?? null,
          incidentId: body.incidentId ?? null,
          triggerType: body.triggerType,
          inspectorUserId: body.inspectorUserId ?? currentActor.id,
          status: "SCHEDULED",
          findings: [],
        })
        .returning();

      return reply.status(201).send(auditRow);
    },
  );

  /**
   * 8. List quality audits & repeat defect analytics
   */
  app.get(
    "/v1/safety/audits",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const query = parse(
        z.object({
          contractorId: uuid.optional(),
          status: z.string().optional(),
        }),
        request.query,
      );

      let conditions: any[] = [];
      if (
        !hasRole(currentActor, "ADMIN", "SUPER_ADMIN") &&
        !isOps(currentActor)
      ) {
        if (hasRole(currentActor, "CONTRACTOR_OWNER")) {
          if (!currentActor.contractorId) {
            return reply.status(200).send({ audits: [], repeatDefectSummary: { totalDefects: 0 } });
          }
          conditions.push(
            eq(qualityAudits.contractorId, currentActor.contractorId),
          );
        }
      }

      if (query.contractorId) {
        conditions.push(eq(qualityAudits.contractorId, query.contractorId));
      }
      if (query.status) {
        conditions.push(eq(qualityAudits.status, query.status));
      }

      const rows = await db
        .select()
        .from(qualityAudits)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(qualityAudits.createdAt));

      const defectAudits = rows.filter(
        (a) => a.status === "DEFECTS_IDENTIFIED" || a.status === "FAILED_CRITICAL",
      );

      return reply.status(200).send({
        audits: rows,
        repeatDefectSummary: {
          totalAudits: rows.length,
          defectAuditsCount: defectAudits.length,
          criticalFailuresCount: rows.filter((a) => a.status === "FAILED_CRITICAL").length,
          repeatDefectThresholdExceeded: defectAudits.length >= 2,
        },
      });
    },
  );

  /**
   * 9. Conduct quality audit / record findings
   */
  app.post(
    "/v1/safety/audits/:id/conduct",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "OPERATIONS_AGENT", "ADMIN", "SUPER_ADMIN");
      const auditId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(conductQualityAuditSchema, request.body);

      const [existing] = await db
        .select()
        .from(qualityAudits)
        .where(eq(qualityAudits.id, auditId))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Quality audit not found",
        });
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(qualityAudits)
          .set({
            status: body.status,
            findings: body.findings as any,
            repeatDefectCount: body.repeatDefectCount,
            remediationRequired: body.remediationRequired,
            remediationDeadline: body.remediationDeadline
              ? new Date(body.remediationDeadline)
              : null,
            reportNotes: body.reportNotes ?? null,
            conductedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(qualityAudits.id, auditId))
          .returning();

        // If critical failure, auto-place contractor on probation / suspension
        if (body.status === "FAILED_CRITICAL") {
          await tx
            .update(contractors)
            .set({
              safetyStatus: "PROBATION",
              suspensionReason: `Critical failure in quality audit ${existing.auditNumber}`,
            })
            .where(eq(contractors.id, existing.contractorId));
        }

        return row;
      });

      return reply.status(200).send(updated);
    },
  );
};
