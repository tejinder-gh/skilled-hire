// apps/api/src/routes/warranty.routes.ts

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  db,
  eq,
  and,
  desc,
  jobs,
  serviceRequests,
  warrantyPolicies,
  jobWarrantySnapshots,
  warrantyClaims,
  warrantyRecoveryLedger,
} from "@marketplace/database";
import {
  createWarrantyPolicySchema,
  createWarrantySnapshotSchema,
  fileWarrantyClaimSchema,
  respondWarrantyClaimSchema,
  disputeWarrantyClaimSchema,
  remediateWarrantyClaimSchema,
  recordWarrantyRecoverySchema,
} from "@marketplace/validation";
import {
  calculateWarrantyExpiry,
  generateWarrantyCertificateNumber,
  generateWarrantyClaimNumber,
  computeWarrantyTermsDigest,
  triageWarrantyClaimUrgency,
  getOntarioStatutoryWarrantyTerms,
  validateWarrantyClaimTransition,
} from "@marketplace/vertical-engine";
import type {
  WarrantyPolicy,
  JobWarrantySnapshot,
  WarrantyClaim,
  WarrantyRecoveryLedgerEntry,
} from "@marketplace/contracts";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

function mapPolicy(row: typeof warrantyPolicies.$inferSelect): WarrantyPolicy {
  return {
    id: row.id,
    policyCode: row.policyCode,
    version: row.version,
    verticalId: row.verticalId,
    categoryId: row.categoryId,
    jurisdiction: row.jurisdiction,
    durationMonths: row.durationMonths,
    responseSlaHours: row.responseSlaHours,
    emergencySlaHours: row.emergencySlaHours,
    coveredDefects: (row.coveredDefects as string[]) ?? [],
    exclusions: (row.exclusions as string[]) ?? [],
    statutoryTerms: row.statutoryTerms,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSnapshot(row: typeof jobWarrantySnapshots.$inferSelect): JobWarrantySnapshot {
  return {
    id: row.id,
    certificateNumber: row.certificateNumber,
    jobId: row.jobId,
    policyId: row.policyId,
    propertyId: row.propertyId,
    contractorId: row.contractorId,
    customerId: row.customerId,
    warrantyType: row.warrantyType as JobWarrantySnapshot["warrantyType"],
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    durationMonths: row.durationMonths,
    coveredDefects: (row.coveredDefects as string[]) ?? [],
    exclusions: (row.exclusions as string[]) ?? [],
    responseSlaHours: row.responseSlaHours,
    contractorAcknowledged: row.contractorAcknowledged,
    contractorAcknowledgedAt: row.contractorAcknowledgedAt.toISOString(),
    homeownerCertificateUrl: row.homeownerCertificateUrl,
    termsDigest: row.termsDigest,
    status: row.status as JobWarrantySnapshot["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapClaim(row: typeof warrantyClaims.$inferSelect): WarrantyClaim {
  return {
    id: row.id,
    claimNumber: row.claimNumber,
    warrantyId: row.warrantyId,
    jobId: row.jobId,
    propertyId: row.propertyId,
    customerId: row.customerId,
    contractorId: row.contractorId,
    title: row.title,
    description: row.description,
    evidencePhotos: (row.evidencePhotos as string[]) ?? [],
    urgency: row.urgency as WarrantyClaim["urgency"],
    status: row.status as WarrantyClaim["status"],
    triageNotes: row.triageNotes,
    slaDeadline: row.slaDeadline.toISOString(),
    originalContractorAccepted: row.originalContractorAccepted,
    contractorResponseNotes: row.contractorResponseNotes,
    contractorRespondedAt: row.contractorRespondedAt ? row.contractorRespondedAt.toISOString() : undefined,
    callbackJobId: row.callbackJobId,
    remediationCompletedAt: row.remediationCompletedAt ? row.remediationCompletedAt.toISOString() : undefined,
    remediationNotes: row.remediationNotes,
    disputeReason: row.disputeReason,
    disputedAt: row.disputedAt ? row.disputedAt.toISOString() : undefined,
    fallbackContractorId: row.fallbackContractorId,
    recoveryAmountCents: Number(row.recoveryAmountCents),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapLedger(row: typeof warrantyRecoveryLedger.$inferSelect): WarrantyRecoveryLedgerEntry {
  return {
    id: row.id,
    claimId: row.claimId,
    contractorId: row.contractorId,
    amountCents: Number(row.amountCents),
    status: row.status as WarrantyRecoveryLedgerEntry["status"],
    reason: row.reason,
    recoveredAt: row.recoveredAt ? row.recoveredAt.toISOString() : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export const warrantyRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/warranties/policies - List warranty policies
  app.get(
    "/v1/warranties/policies",
    { preHandler: authenticate },
    async (_request, reply) => {
      const rows = await db
        .select()
        .from(warrantyPolicies)
        .where(eq(warrantyPolicies.active, true))
        .orderBy(desc(warrantyPolicies.createdAt));

      return reply.send(rows.map(mapPolicy));
    },
  );

  // POST /v1/warranties/policies - Create warranty policy (Ops only)
  app.post(
    "/v1/warranties/policies",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations staff can create warranty policies",
        });
      }

      const body = parse(createWarrantyPolicySchema, request.body);

      const [policy] = await db
        .insert(warrantyPolicies)
        .values({
          policyCode: body.policyCode,
          version: body.version,
          verticalId: body.verticalId,
          categoryId: body.categoryId,
          jurisdiction: body.jurisdiction,
          durationMonths: body.durationMonths,
          responseSlaHours: body.responseSlaHours,
          emergencySlaHours: body.emergencySlaHours,
          coveredDefects: body.coveredDefects,
          exclusions: body.exclusions,
          statutoryTerms: body.statutoryTerms,
          active: body.active,
        })
        .returning();

      if (!policy) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to create warranty policy",
        });
      }

      await audit(user.id, "warranty_policy.created", "warranty_policy", policy.id, null, policy);

      return reply.code(201).send(mapPolicy(policy));
    },
  );

  // GET /v1/jobs/:id/warranty - Get warranty snapshot for a job
  app.get(
    "/v1/jobs/:id/warranty",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;

      const [snapshot] = await db
        .select()
        .from(jobWarrantySnapshots)
        .where(eq(jobWarrantySnapshots.jobId, jobId))
        .limit(1);

      if (!snapshot) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty snapshot not found for job",
        });
      }

      // Tenant isolation: Job customer, job contractor, or ops
      const isCustomer = user.id === snapshot.customerId;
      const isContractor = user.contractorId === snapshot.contractorId;
      if (!isCustomer && !isContractor && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to view this warranty snapshot",
        });
      }

      return reply.send(mapSnapshot(snapshot));
    },
  );

  // POST /v1/jobs/:id/warranty/snapshot - Generate warranty snapshot upon job acceptance/completion
  app.post(
    "/v1/jobs/:id/warranty/snapshot",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createWarrantySnapshotSchema.partial(), request.body ?? {});

      const [jobRow] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          serviceRequestId: jobs.serviceRequestId,
          status: jobs.status,
          customerId: serviceRequests.customerId,
          propertyId: serviceRequests.propertyId,
          verticalId: serviceRequests.verticalId,
          categoryId: serviceRequests.categoryId,
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

      // Check existing snapshot
      const [existingSnapshot] = await db
        .select()
        .from(jobWarrantySnapshots)
        .where(eq(jobWarrantySnapshots.jobId, jobId))
        .limit(1);

      if (existingSnapshot) {
        return reply.code(200).send(mapSnapshot(existingSnapshot));
      }

      // Authorization: Assigned contractor or ops
      const isAssignedContractor = user.contractorId === jobRow.contractorId;
      if (!isAssignedContractor && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only the assigned contractor or operations can snapshot the job warranty",
        });
      }

      // Lookup policy or use standard Ontario terms
      let policyRow = null;
      if (body.policyId) {
        [policyRow] = await db
          .select()
          .from(warrantyPolicies)
          .where(eq(warrantyPolicies.id, body.policyId))
          .limit(1);
      } else {
        [policyRow] = await db
          .select()
          .from(warrantyPolicies)
          .where(
            and(
              eq(warrantyPolicies.active, true),
              eq(warrantyPolicies.jurisdiction, "ON"),
            ),
          )
          .limit(1);
      }

      const durationMonths = body.durationMonths ?? policyRow?.durationMonths ?? 12;
      const coveredDefects =
        body.coveredDefects ??
        (policyRow?.coveredDefects as string[]) ?? [
          "Workmanship defect or installation failure",
          "Component assembly errors",
          "Improper sealing or fastening deficiencies",
        ];
      const exclusions =
        body.exclusions ??
        (policyRow?.exclusions as string[]) ?? [
          "Normal wear and tear",
          "Unauthorized modification or tampering",
          "Consumer neglect or extraordinary weather",
        ];
      const responseSlaHours = policyRow?.responseSlaHours ?? 48;
      const statutoryTerms = policyRow?.statutoryTerms ?? getOntarioStatutoryWarrantyTerms();

      const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
      const expiresAt = new Date(calculateWarrantyExpiry(startsAt, durationMonths));
      const certificateNumber = generateWarrantyCertificateNumber();

      const termsDigest = computeWarrantyTermsDigest({
        certificateNumber,
        jobId: jobRow.id,
        durationMonths,
        coveredDefects,
        exclusions,
        statutoryTerms,
        responseSlaHours,
      });

      const [newSnapshot] = await db
        .insert(jobWarrantySnapshots)
        .values({
          certificateNumber,
          jobId: jobRow.id,
          policyId: policyRow?.id ?? null,
          propertyId: jobRow.propertyId,
          contractorId: jobRow.contractorId,
          customerId: jobRow.customerId,
          warrantyType: body.warrantyType ?? "STANDARD_WORKMANSHIP",
          startsAt,
          expiresAt,
          durationMonths,
          coveredDefects,
          exclusions,
          responseSlaHours,
          contractorAcknowledged: body.contractorAcknowledged ?? true,
          contractorAcknowledgedAt: new Date(),
          homeownerCertificateUrl: `/certificates/${certificateNumber}.pdf`,
          termsDigest,
          status: "ACTIVE",
        })
        .returning();

      if (!newSnapshot) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to create warranty snapshot",
        });
      }

      await audit(user.id, "warranty_snapshot.created", "job_warranty_snapshot", newSnapshot.id, null, newSnapshot);

      return reply.code(201).send(mapSnapshot(newSnapshot));
    },
  );

  // POST /v1/warranties/:id/claims - File warranty claim
  app.post(
    "/v1/warranties/:id/claims",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const warrantyId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(fileWarrantyClaimSchema, request.body);

      const [snapshot] = await db
        .select()
        .from(jobWarrantySnapshots)
        .where(eq(jobWarrantySnapshots.id, warrantyId))
        .limit(1);

      if (!snapshot) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty snapshot not found",
        });
      }

      // Check customer ownership
      const isOwner = user.id === snapshot.customerId;
      if (!isOwner && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only the property customer or operations can file a warranty claim",
        });
      }

      if (snapshot.status === "VOIDED_TAMPERING") {
        return reply.code(400).send({
          statusCode: 400,
          code: "WARRANTY_VOIDED",
          message: "Warranty has been voided due to unauthorized tampering",
        });
      }

      // Urgency & coverage triage
      const triage = triageWarrantyClaimUrgency({
        urgency: body.urgency ?? "STANDARD",
        title: body.title,
        description: body.description,
        coveredDefects: (snapshot.coveredDefects as string[]) ?? [],
        exclusions: (snapshot.exclusions as string[]) ?? [],
        responseSlaHours: snapshot.responseSlaHours,
      });

      const claimNumber = generateWarrantyClaimNumber();
      const initialStatus = triage.covered ? "TRIAGED_COVERED" : "TRIAGED_EXCLUDED";

      const [claim] = await db
        .insert(warrantyClaims)
        .values({
          claimNumber,
          warrantyId: snapshot.id,
          jobId: snapshot.jobId,
          propertyId: snapshot.propertyId,
          customerId: snapshot.customerId,
          contractorId: snapshot.contractorId,
          title: body.title,
          description: body.description,
          evidencePhotos: body.evidencePhotos,
          urgency: triage.urgency,
          status: initialStatus,
          triageNotes: triage.reason,
          slaDeadline: new Date(triage.slaDeadline),
          recoveryAmountCents: 0,
        })
        .returning();

      if (!claim) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to file warranty claim",
        });
      }

      if (triage.covered && snapshot.status === "ACTIVE") {
        await db
          .update(jobWarrantySnapshots)
          .set({ status: "CLAIM_IN_PROGRESS", updatedAt: new Date() })
          .where(eq(jobWarrantySnapshots.id, snapshot.id));
      }

      await audit(user.id, "warranty_claim.filed", "warranty_claim", claim.id, null, claim);

      return reply.code(201).send(mapClaim(claim));
    },
  );

  // GET /v1/warranties/:id/claims - List claims for a warranty snapshot
  app.get(
    "/v1/warranties/:id/claims",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const warrantyId = parse(z.object({ id: uuid }), request.params).id;

      const [snapshot] = await db
        .select()
        .from(jobWarrantySnapshots)
        .where(eq(jobWarrantySnapshots.id, warrantyId))
        .limit(1);

      if (!snapshot) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty snapshot not found",
        });
      }

      const isCustomer = user.id === snapshot.customerId;
      const isContractor = user.contractorId === snapshot.contractorId;
      if (!isCustomer && !isContractor && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to view claims for this warranty",
        });
      }

      const claims = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.warrantyId, warrantyId))
        .orderBy(desc(warrantyClaims.createdAt));

      return reply.send(claims.map(mapClaim));
    },
  );

  // GET /v1/warranty-claims/:id - Get details of a single warranty claim
  app.get(
    "/v1/warranty-claims/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const claimId = parse(z.object({ id: uuid }), request.params).id;

      const [claim] = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty claim not found",
        });
      }

      const isCustomer = user.id === claim.customerId;
      const isContractor = user.contractorId === claim.contractorId;
      const isFallback = Boolean(claim.fallbackContractorId && user.contractorId === claim.fallbackContractorId);

      if (!isCustomer && !isContractor && !isFallback && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to view this warranty claim",
        });
      }

      return reply.send(mapClaim(claim));
    },
  );

  // POST /v1/warranty-claims/:id/respond - Contractor right-to-cure response
  app.post(
    "/v1/warranty-claims/:id/respond",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const claimId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(respondWarrantyClaimSchema, request.body);

      const [claim] = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty claim not found",
        });
      }

      const isContractor = user.contractorId === claim.contractorId;
      if (!isContractor && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only the assigned contractor or operations can respond to this warranty claim",
        });
      }

      let nextStatus = claim.status;
      if (body.accepted) {
        nextStatus = body.scheduledCallbackAt ? "REMEDIATION_SCHEDULED" : "CONTRACTOR_INSPECTING";
      } else {
        nextStatus = "ESCALATED_DISPUTE";
      }

      const [updated] = await db
        .update(warrantyClaims)
        .set({
          originalContractorAccepted: body.accepted,
          contractorResponseNotes: body.contractorResponseNotes,
          contractorRespondedAt: new Date(),
          status: nextStatus,
          ...(body.accepted ? {} : { disputedAt: new Date(), disputeReason: body.contractorResponseNotes ?? "Contractor denied liability" }),
          updatedAt: new Date(),
        })
        .where(eq(warrantyClaims.id, claimId))
        .returning();

      if (!updated) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to update claim response",
        });
      }

      await audit(user.id, "warranty_claim.responded", "warranty_claim", claim.id, claim, updated);

      return reply.send(mapClaim(updated));
    },
  );

  // POST /v1/warranty-claims/:id/dispute - Contractor disputes liability
  app.post(
    "/v1/warranty-claims/:id/dispute",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const claimId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(disputeWarrantyClaimSchema, request.body);

      const [claim] = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty claim not found",
        });
      }

      const isContractor = user.contractorId === claim.contractorId;
      if (!isContractor && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to dispute this warranty claim",
        });
      }

      const [updated] = await db
        .update(warrantyClaims)
        .set({
          status: "ESCALATED_DISPUTE",
          originalContractorAccepted: false,
          disputeReason: body.reason,
          disputedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(warrantyClaims.id, claimId))
        .returning();

      if (!updated) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to dispute claim",
        });
      }

      await audit(user.id, "warranty_claim.disputed", "warranty_claim", claim.id, claim, updated);

      return reply.send(mapClaim(updated));
    },
  );

  // POST /v1/warranty-claims/:id/remediate - Mark remediation completed
  app.post(
    "/v1/warranty-claims/:id/remediate",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const claimId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(remediateWarrantyClaimSchema, request.body);

      const [claim] = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty claim not found",
        });
      }

      const isContractor = user.contractorId === claim.contractorId;
      const isFallback = Boolean(claim.fallbackContractorId && user.contractorId === claim.fallbackContractorId);
      if (!isContractor && !isFallback && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to remediate this warranty claim",
        });
      }

      const [updated] = await db
        .update(warrantyClaims)
        .set({
          status: "REMEDIATED",
          remediationNotes: body.notes,
          remediationCompletedAt: body.remediationCompletedAt ? new Date(body.remediationCompletedAt) : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(warrantyClaims.id, claimId))
        .returning();

      if (!updated) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to remediate claim",
        });
      }

      // Check remaining active claims on warranty snapshot
      const activeClaims = await db
        .select()
        .from(warrantyClaims)
        .where(
          and(
            eq(warrantyClaims.warrantyId, claim.warrantyId),
            eq(warrantyClaims.status, "CLAIM_IN_PROGRESS"),
          ),
        );

      if (activeClaims.length === 0) {
        await db
          .update(jobWarrantySnapshots)
          .set({ status: "ACTIVE", updatedAt: new Date() })
          .where(eq(jobWarrantySnapshots.id, claim.warrantyId));
      }

      await audit(user.id, "warranty_claim.remediated", "warranty_claim", claim.id, claim, updated);

      return reply.send(mapClaim(updated));
    },
  );

  // POST /v1/warranty-claims/:id/recover - Record warranty recovery ledger entry (Ops only)
  app.post(
    "/v1/warranty-claims/:id/recover",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations can record warranty recovery ledger entries",
        });
      }

      const claimId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(recordWarrantyRecoverySchema, request.body);

      const [claim] = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty claim not found",
        });
      }

      const [entry] = await db
        .insert(warrantyRecoveryLedger)
        .values({
          claimId,
          contractorId: body.contractorId,
          amountCents: body.amountCents,
          reason: body.reason,
          status: body.status,
        })
        .returning();

      if (!entry) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to record recovery entry",
        });
      }

      const newRecoveryTotal = Number(claim.recoveryAmountCents) + body.amountCents;
      await db
        .update(warrantyClaims)
        .set({
          recoveryAmountCents: newRecoveryTotal,
          fallbackContractorId: body.contractorId !== claim.contractorId ? body.contractorId : claim.fallbackContractorId,
          updatedAt: new Date(),
        })
        .where(eq(warrantyClaims.id, claimId));

      await audit(user.id, "warranty_recovery.recorded", "warranty_recovery_ledger", entry.id, null, entry);

      return reply.code(201).send(mapLedger(entry));
    },
  );

  // GET /v1/warranty-claims/:id/recovery - List recovery ledger entries for claim
  app.get(
    "/v1/warranty-claims/:id/recovery",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const claimId = parse(z.object({ id: uuid }), request.params).id;

      const [claim] = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Warranty claim not found",
        });
      }

      const isContractor = user.contractorId === claim.contractorId;
      if (!isOps(user) && !isContractor) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to view recovery ledger for this claim",
        });
      }

      const rows = await db
        .select()
        .from(warrantyRecoveryLedger)
        .where(eq(warrantyRecoveryLedger.claimId, claimId))
        .orderBy(desc(warrantyRecoveryLedger.createdAt));

      return reply.send(rows.map(mapLedger));
    },
  );
};
