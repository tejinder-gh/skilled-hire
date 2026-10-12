import type { FastifyPluginAsync } from "fastify";
import { hasRole, requireRole } from "@marketplace/auth";
import type {
  AgreementSignatureRecord,
  LegalAgreementRecord,
  LegalAgreementType,
  SignerEntityType,
} from "@marketplace/contracts";
import {
  db,
  eq,
  ne,
  and,
  desc,
  legalAgreements,
  agreementSignatures,
  contractors,
  users,
} from "@marketplace/database";
import {
  createLegalAgreementSchema,
  queryAgreementStatusSchema,
  signAgreementSchema,
  uuid,
} from "@marketplace/validation";
import {
  buildEvidenceCertificate,
  computeAgreementChecksum,
  verifySignatureEvidence,
} from "@marketplace/vertical-engine";
import { z } from "zod";
import { actor, authenticate, isOps, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

function toLegalAgreementRecord(
  row: typeof legalAgreements.$inferSelect,
): LegalAgreementRecord {
  return {
    id: row.id,
    type: row.type as LegalAgreementType,
    version: row.version,
    jurisdiction: row.jurisdiction,
    title: row.title,
    summary: row.summary,
    contentMarkdown: row.contentMarkdown,
    contentChecksum: row.contentChecksum,
    isActive: row.isActive,
    effectiveDate: row.effectiveDate.toISOString(),
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    legalCounselRef: row.legalCounselRef ?? null,
    keyTerms: (row.keyTerms as any) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAgreementSignatureRecord(
  row: typeof agreementSignatures.$inferSelect,
): AgreementSignatureRecord {
  return {
    id: row.id,
    agreementId: row.agreementId,
    agreementType: row.agreementType as LegalAgreementType,
    agreementVersion: row.agreementVersion,
    jurisdiction: row.jurisdiction,
    signerUserId: row.signerUserId,
    signerRole: row.signerRole,
    entityType: row.entityType as SignerEntityType,
    contractorId: row.contractorId ?? null,
    signerLegalName: row.signerLegalName,
    signerTitle: row.signerTitle ?? null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    agreementChecksum: row.agreementChecksum,
    signedAt: row.signedAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export const legalRoutes: FastifyPluginAsync = async (app) => {
  /**
   * 1. Get Active Agreements (Public / Authenticated discovery)
   */
  app.get("/v1/legal/agreements/active", async (request, reply) => {
    const query = request.query as
      | { type?: string; jurisdiction?: string }
      | undefined;
    const jurisdiction = query?.jurisdiction ?? "ON";
    const typeFilter = query?.type;

    const conditions = [
      eq(legalAgreements.isActive, true),
      eq(legalAgreements.jurisdiction, jurisdiction),
    ];
    if (typeFilter) {
      conditions.push(eq(legalAgreements.type, typeFilter));
    }

    const rows = await db
      .select()
      .from(legalAgreements)
      .where(and(...conditions))
      .orderBy(legalAgreements.type);

    return reply.status(200).send({
      agreements: rows.map(toLegalAgreementRecord),
      jurisdiction,
    });
  });

  /**
   * 2. Get Legal Agreement by ID
   */
  app.get("/v1/legal/agreements/:id", async (request, reply) => {
    const { id } = parse(z.object({ id: uuid }), request.params);

    const [row] = await db
      .select()
      .from(legalAgreements)
      .where(eq(legalAgreements.id, id))
      .limit(1);

    if (!row) {
      return reply.status(404).send({
        code: "LEGAL_AGREEMENT_NOT_FOUND",
        message: "Legal agreement not found",
      });
    }

    return reply.status(200).send({
      agreement: toLegalAgreementRecord(row),
    });
  });

  /**
   * 3. Create or Version a Legal Agreement (Admin / Ops only)
   */
  app.post(
    "/v1/legal/agreements",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT");

      const body = parse(createLegalAgreementSchema, request.body);
      const computedChecksum = computeAgreementChecksum(body.contentMarkdown);

      const agreement = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(legalAgreements)
          .values({
            type: body.type,
            version: body.version,
            jurisdiction: body.jurisdiction,
            title: body.title,
            summary: body.summary,
            contentMarkdown: body.contentMarkdown,
            contentChecksum: computedChecksum,
            isActive: true,
            legalCounselRef: body.legalCounselRef ?? null,
            keyTerms: body.keyTerms,
          })
          .returning();

        if (!inserted) {
          throw new Error("AGREEMENT_CREATION_FAILED");
        }

        // Atomically supersede previous active versions for this type & jurisdiction
        await tx
          .update(legalAgreements)
          .set({
            isActive: false,
            supersededAt: new Date(),
          })
          .where(
            and(
              eq(legalAgreements.type, body.type),
              eq(legalAgreements.jurisdiction, body.jurisdiction ?? "ON"),
              eq(legalAgreements.isActive, true),
              ne(legalAgreements.id, inserted.id),
            ),
          );

        return inserted;
      });

      await audit(
        currentActor.id,
        "LEGAL_AGREEMENT_VERSIONED",
        "LEGAL_AGREEMENT",
        agreement.id,
        null,
        agreement,
        {
          type: agreement.type,
          version: agreement.version,
          jurisdiction: agreement.jurisdiction,
          checksum: computedChecksum,
        },
      );

      return reply.status(201).send({
        agreement: toLegalAgreementRecord(agreement),
      });
    },
  );

  /**
   * 4. Sign a Legal Agreement (Contractor Owner, Customer, Technician)
   */
  app.post(
    "/v1/legal/signatures",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const body = parse(signAgreementSchema, request.body);

      // Verify agreement exists and is active
      const [agreement] = await db
        .select()
        .from(legalAgreements)
        .where(eq(legalAgreements.id, body.agreementId))
        .limit(1);

      if (!agreement) {
        return reply.status(404).send({
          code: "LEGAL_AGREEMENT_NOT_FOUND",
          message: "The requested legal agreement was not found",
        });
      }

      if (!agreement.isActive) {
        return reply.status(422).send({
          code: "AGREEMENT_VERSION_SUPERSEDED",
          message:
            "This agreement version has been superseded. Please sign the active version.",
        });
      }

      // Verify checksum
      if (body.agreementChecksum !== agreement.contentChecksum) {
        return reply.status(422).send({
          code: "AGREEMENT_CHECKSUM_MISMATCH",
          message:
            "Provided agreement checksum does not match current agreement text.",
          details: {
            expected: agreement.contentChecksum,
            received: body.agreementChecksum,
          },
        });
      }

      // If signing on behalf of a contractor, verify authorization
      let contractorId: string | null = null;
      if (body.entityType === "CONTRACTOR") {
        if (!body.contractorId) {
          return reply.status(422).send({
            code: "CONTRACTOR_ID_REQUIRED",
            message: "contractorId is required when signing as CONTRACTOR",
          });
        }
        contractorId = body.contractorId;

        // Verify user owns or manages this contractor (unless ADMIN/OPS)
        if (!isOps(currentActor)) {
          const [contractor] = await db
            .select()
            .from(contractors)
            .where(
              and(
                eq(contractors.id, contractorId),
                eq(contractors.ownerUserId, currentActor.id),
              ),
            )
            .limit(1);

          if (!contractor) {
            return reply.status(403).send({
              code: "FORBIDDEN",
              message:
                "You are not authorized to sign agreements on behalf of this contractor entity",
            });
          }
        }
      }

      const ipAddress =
        (request.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
        request.ip ??
        "127.0.0.1";
      const userAgent =
        (request.headers["user-agent"] as string) ?? "SkilledHire-Client/1.0";

      const [signature] = await db
        .insert(agreementSignatures)
        .values({
          agreementId: agreement.id,
          agreementType: agreement.type,
          agreementVersion: agreement.version,
          jurisdiction: agreement.jurisdiction,
          signerUserId: currentActor.id,
          signerRole: currentActor.roles[0] ?? "USER",
          entityType: body.entityType,
          contractorId,
          signerLegalName: body.signerLegalName,
          signerTitle: body.signerTitle ?? null,
          ipAddress,
          userAgent,
          agreementChecksum: body.agreementChecksum,
          metadata: body.metadata,
        })
        .returning();

      if (!signature) {
        return reply.status(500).send({
          code: "SIGNATURE_CREATION_FAILED",
          message: "Failed to record agreement signature",
        });
      }

      await audit(
        currentActor.id,
        "LEGAL_AGREEMENT_SIGNED",
        "AGREEMENT_SIGNATURE",
        signature.id,
        null,
        signature,
        {
          agreementId: agreement.id,
          agreementType: agreement.type,
          agreementVersion: agreement.version,
          entityType: body.entityType,
          contractorId,
          signerLegalName: body.signerLegalName,
          checksum: body.agreementChecksum,
        },
      );

      return reply.status(201).send({
        signature: toAgreementSignatureRecord(signature),
      });
    },
  );

  /**
   * 5. Query Agreement Signature Status (Pre-dispatch & Booking check)
   */
  app.get("/v1/legal/signatures/status", async (request, reply) => {
    const query = parse(queryAgreementStatusSchema, request.query);

    // Find current active agreement of this type
    const [activeAgreement] = await db
      .select()
      .from(legalAgreements)
      .where(
        and(
          eq(legalAgreements.type, query.type),
          eq(legalAgreements.jurisdiction, query.jurisdiction ?? "ON"),
          eq(legalAgreements.isActive, true),
        ),
      )
      .limit(1);

    if (!activeAgreement) {
      return reply.status(404).send({
        code: "LEGAL_AGREEMENT_NOT_FOUND",
        message: `No active agreement found for type ${query.type} in ${query.jurisdiction}`,
      });
    }

    const conditions = [
      eq(agreementSignatures.agreementId, activeAgreement.id),
      eq(agreementSignatures.agreementChecksum, activeAgreement.contentChecksum),
    ];

    if (query.contractorId) {
      conditions.push(eq(agreementSignatures.contractorId, query.contractorId));
    }
    if (query.userId) {
      conditions.push(eq(agreementSignatures.signerUserId, query.userId));
    }

    const [signature] = await db
      .select()
      .from(agreementSignatures)
      .where(and(...conditions))
      .orderBy(desc(agreementSignatures.signedAt))
      .limit(1);

    const isSigned = Boolean(signature && !signature.revokedAt);

    return reply.status(200).send({
      signed: isSigned,
      activeVersion: activeAgreement.version,
      agreementId: activeAgreement.id,
      signature: signature ? toAgreementSignatureRecord(signature) : null,
    });
  });

  /**
   * 6. Retrieve E-Signature Evidence Certificate (Audit & Court Disclosures)
   */
  app.get(
    "/v1/legal/signatures/:id/certificate",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const { id } = parse(z.object({ id: uuid }), request.params);

      const [signatureRow] = await db
        .select()
        .from(agreementSignatures)
        .where(eq(agreementSignatures.id, id))
        .limit(1);

      if (!signatureRow) {
        return reply.status(404).send({
          code: "SIGNATURE_NOT_FOUND",
          message: "Agreement signature record not found",
        });
      }

      // Tenant isolation: Only signer, associated contractor owner, or ops can view certificate
      if (!isOps(currentActor) && signatureRow.signerUserId !== currentActor.id) {
        if (signatureRow.contractorId) {
          const [contractor] = await db
            .select()
            .from(contractors)
            .where(
              and(
                eq(contractors.id, signatureRow.contractorId),
                eq(contractors.ownerUserId, currentActor.id),
              ),
            )
            .limit(1);

          if (!contractor) {
            return reply.status(403).send({
              code: "FORBIDDEN",
              message: "Access to this signature certificate is not permitted",
            });
          }
        } else {
          return reply.status(403).send({
            code: "FORBIDDEN",
            message: "Access to this signature certificate is not permitted",
          });
        }
      }

      const [agreementRow] = await db
        .select()
        .from(legalAgreements)
        .where(eq(legalAgreements.id, signatureRow.agreementId))
        .limit(1);

      if (!agreementRow) {
        return reply.status(404).send({
          code: "LEGAL_AGREEMENT_NOT_FOUND",
          message: "Referenced agreement could not be loaded",
        });
      }

      const certificate = buildEvidenceCertificate({
        agreement: toLegalAgreementRecord(agreementRow),
        signature: toAgreementSignatureRecord(signatureRow),
      });

      return reply.status(200).send({ certificate });
    },
  );

  /**
   * 7. Signature Audit Trail (Admin / Ops only)
   */
  app.get(
    "/v1/legal/audit",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      requireRole(currentActor, "ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT");

      const query = request.query as
        | { agreementType?: string; contractorId?: string }
        | undefined;

      const conditions: any[] = [];
      if (query?.agreementType) {
        conditions.push(eq(agreementSignatures.agreementType, query.agreementType));
      }
      if (query?.contractorId) {
        conditions.push(eq(agreementSignatures.contractorId, query.contractorId));
      }

      const rows = await db
        .select()
        .from(agreementSignatures)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(agreementSignatures.signedAt))
        .limit(100);

      return reply.status(200).send({
        signatures: rows.map(toAgreementSignatureRecord),
        count: rows.length,
      });
    },
  );
};
