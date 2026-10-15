import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getJwtSecret } from "@marketplace/auth";
import {
  db,
  eq,
  and,
  desc,
  isNull,
  fileAttachments,
  fileQuarantineEvents,
} from "@marketplace/database";
import type { FileCategory, FileVisibility, FileScanStatus, FileAttachmentStatus } from "@marketplace/contracts";
import {
  presignedUploadInitiateSchema,
  presignedUploadFinalizeSchema,
  quarantineOverrideSchema,
  uuid,
} from "@marketplace/validation";
import {
  generateStructuredStorageKey,
  isStorageKeyValid,
  generatePresignedUploadTicket,
  verifyPresignedUploadSignature,
  generateSignedDownloadUrl,
  verifySignedDownloadSignature,
  validateFileContentMime,
  scanBufferForThreats,
  canActorAccessFile,
  sanitizeFileName,
} from "@marketplace/core";
import { actor, authenticate, requireStaff, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

// In-memory binary storage cache for local mock/dev pipeline
const fileContentStore = new Map<string, Buffer>();

export const filesRoutes: FastifyPluginAsync = async (app) => {
  const secretKey = getJwtSecret();

  // ---------------------------------------------------------------------------
  // 1. Presigned Upload Initiation (Authenticated)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/files/upload/initiate",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const body = parse(presignedUploadInitiateSchema, request.body);

      // Verify contractor tenant boundary if contractorId is provided
      if (body.contractorId && currentActor.contractorId) {
        if (currentActor.contractorId !== body.contractorId) {
          return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Cross-tenant upload initiation denied",
          });
        }
      }

      // Generate structured, non-guessable, multi-tenant scoped key
      const tenantOrUserId = body.contractorId ?? currentActor.id;
      const storageKey = generateStructuredStorageKey({
        category: body.category as FileCategory,
        tenantOrUserId,
        originalFileName: body.fileName,
      });

      const visibility: FileVisibility = body.visibility ?? "SHARED";

      // Persist attachment metadata in INITIATED state
      const [record] = await db
        .insert(fileAttachments)
        .values({
          storageKey,
          ownerUserId: currentActor.id,
          contractorId: body.contractorId ?? currentActor.contractorId ?? null,
          customerId: body.customerId ?? (currentActor.roles.includes("CUSTOMER") ? currentActor.id : null),
          jobId: body.jobId ?? null,
          serviceRequestId: body.serviceRequestId ?? null,
          fileCategory: body.category,
          fileName: sanitizeFileName(body.fileName),
          mimeType: body.mimeType,
          byteSize: body.byteSize,
          scanStatus: "PENDING_SCAN",
          visibility,
          status: "INITIATED",
        })
        .returning();

      if (!record) {
        throw new Error("Failed to initialize file record");
      }

      const ticket = generatePresignedUploadTicket({
        storageKey,
        fileId: record.id,
        expiresSeconds: 900, // 15 mins
        secret: secretKey,
      });

      await audit(
        currentActor.id,
        "FILE_UPLOAD_INITIATED",
        "file_attachment",
        record.id,
        null,
        {
          storageKey,
          fileName: record.fileName,
          category: record.fileCategory,
          mimeType: record.mimeType,
          byteSize: record.byteSize,
        },
      );

      return reply.code(201).send({
        fileId: record.id,
        storageKey,
        uploadUrl: ticket.uploadUrl,
        expiresAt: ticket.expiresAt,
        headers: {
          "Content-Type": body.mimeType,
        },
        maxByteSize: 25 * 1024 * 1024,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 2. Presigned Upload Finalization & Anti-Virus Scan (Authenticated)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/files/upload/finalize",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const body = parse(presignedUploadFinalizeSchema, request.body);

      const [record] = await db
        .select()
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.id, body.fileId),
            eq(fileAttachments.storageKey, body.storageKey),
          ),
        )
        .limit(1);

      if (!record) {
        return reply.code(404).send({
          code: "FILE_NOT_FOUND",
          message: "File record not found or storage key mismatch",
        });
      }

      // Check ownership or staff access
      if (record.ownerUserId !== currentActor.id && !currentActor.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT"].includes(r))) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You do not have permission to finalize this upload",
        });
      }

      // Retrieve binary buffer (either from payload or in-memory store)
      let buffer: Buffer | null = null;
      if (body.contentBase64) {
        buffer = Buffer.from(body.contentBase64, "base64");
        fileContentStore.set(record.storageKey, buffer);
      } else if (fileContentStore.has(record.storageKey)) {
        buffer = fileContentStore.get(record.storageKey) ?? null;
      }

      const now = new Date();

      if (buffer) {
        // 1. Magic Bytes MIME Spoofing Check
        const mimeCheck = validateFileContentMime(record.mimeType, buffer);
        if (!mimeCheck.valid) {
          await db
            .update(fileAttachments)
            .set({
              scanStatus: "REJECTED",
              status: "DELETED",
              quarantineReason: mimeCheck.error ?? "MIME validation failed",
              updatedAt: now,
            })
            .where(eq(fileAttachments.id, record.id));

          return reply.code(400).send({
            code: "MIME_SPOOFING_DETECTED",
            message: mimeCheck.error,
            detectedMime: mimeCheck.detectedMime,
          });
        }

        // 2. Anti-Virus & Malware Scan
        const scanResult = scanBufferForThreats(buffer, record.fileName);
        if (!scanResult.clean) {
          await db
            .update(fileAttachments)
            .set({
              scanStatus: "QUARANTINED",
              status: "QUARANTINED",
              quarantineReason: scanResult.reason ?? scanResult.threatName ?? "Threat detected",
              updatedAt: now,
            })
            .where(eq(fileAttachments.id, record.id));

          await db.insert(fileQuarantineEvents).values({
            fileId: record.id,
            triggerReason: scanResult.reason ?? "Malware threat detected",
            detectedSignatures: [scanResult.threatName ?? "UnknownThreat"],
          });

          await audit(
            currentActor.id,
            "FILE_QUARANTINED",
            "file_attachment",
            record.id,
            null,
            {
              threatName: scanResult.threatName,
              reason: scanResult.reason,
            },
          );

          return reply.code(200).send({
            fileId: record.id,
            storageKey: record.storageKey,
            status: "QUARANTINED" as FileAttachmentStatus,
            scanStatus: "QUARANTINED" as FileScanStatus,
            quarantineReason: scanResult.reason,
            signedUrl: null,
          });
        }
      }

      // Checksum calculation
      const calculatedChecksum = buffer
        ? createHash("sha256").update(buffer).digest("hex")
        : body.sha256Checksum ?? record.sha256Checksum;

      const finalByteSize = buffer ? buffer.length : (body.byteSize ?? record.byteSize);

      await db
        .update(fileAttachments)
        .set({
          status: "ACTIVE",
          scanStatus: "CLEAN",
          sha256Checksum: calculatedChecksum,
          byteSize: finalByteSize,
          uploadedAt: now,
          updatedAt: now,
        })
        .where(eq(fileAttachments.id, record.id));

      const signed = generateSignedDownloadUrl({
        storageKey: record.storageKey,
        fileId: record.id,
        expiresSeconds: 900,
        secret: secretKey,
      });

      await audit(
        currentActor.id,
        "FILE_UPLOAD_FINALIZED",
        "file_attachment",
        record.id,
        null,
        {
          storageKey: record.storageKey,
          checksum: calculatedChecksum,
          byteSize: finalByteSize,
        },
      );

      return {
        fileId: record.id,
        storageKey: record.storageKey,
        status: "ACTIVE" as FileAttachmentStatus,
        scanStatus: "CLEAN" as FileScanStatus,
        quarantineReason: null,
        signedUrl: signed.downloadUrl,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 3. Raw Presigned Binary Upload Handler (Authenticated by URL Signature)
  // ---------------------------------------------------------------------------
  app.put("/v1/files/raw/:storageKey", async (request, reply) => {
    const storageKey = decodeURIComponent(
      (request.params as { storageKey: string }).storageKey,
    );
    const query = request.query as { fileId?: string; expires?: string; sig?: string };

    if (!query.fileId || !query.expires || !query.sig) {
      return reply.code(400).send({
        code: "INVALID_PRESIGNED_REQUEST",
        message: "Missing presigned query parameters (fileId, expires, sig)",
      });
    }

    const expiresTimestamp = Number(query.expires);
    const isValidSignature = verifyPresignedUploadSignature({
      storageKey,
      fileId: query.fileId,
      expiresTimestamp,
      signature: query.sig,
      secret: secretKey,
    });

    if (!isValidSignature) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "Presigned upload signature is invalid or expired",
      });
    }

    // Binary payload
    const rawBuffer = Buffer.isBuffer(request.body)
      ? request.body
      : typeof request.body === "string"
        ? Buffer.from(request.body, "utf8")
        : Buffer.from(JSON.stringify(request.body ?? {}));

    if (rawBuffer.length > 25 * 1024 * 1024) {
      return reply.code(413).send({
        code: "FILE_TOO_LARGE",
        message: "File exceeds 25MB ceiling",
      });
    }

    fileContentStore.set(storageKey, rawBuffer);

    return reply.code(200).send({
      success: true,
      storageKey,
      bytesReceived: rawBuffer.length,
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Get Signed Download Lease (Authenticated with Object Authorization)
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/files/:id/signed-url",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const fileId = parse(z.object({ id: uuid }), request.params).id;

      const [record] = await db
        .select()
        .from(fileAttachments)
        .where(eq(fileAttachments.id, fileId))
        .limit(1);

      if (!record || record.status === "DELETED") {
        return reply.code(404).send({
          code: "FILE_NOT_FOUND",
          message: "File attachment does not exist or has been deleted",
        });
      }

      // Object Authorization Guard
      const authorized = canActorAccessFile(currentActor, {
        ownerUserId: record.ownerUserId,
        contractorId: record.contractorId,
        customerId: record.customerId,
        visibility: record.visibility as FileVisibility,
        scanStatus: record.scanStatus as FileScanStatus,
      });

      if (!authorized) {
        if (record.scanStatus === "QUARANTINED") {
          return reply.code(403).send({
            code: "FILE_QUARANTINED",
            message: "Access blocked: This file has been quarantined for malware protection.",
          });
        }

        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You do not have access to this file attachment",
        });
      }

      const signed = generateSignedDownloadUrl({
        storageKey: record.storageKey,
        fileId: record.id,
        expiresSeconds: 900, // 15 mins
        secret: secretKey,
      });

      return {
        fileId: record.id,
        storageKey: record.storageKey,
        fileName: record.fileName,
        mimeType: record.mimeType,
        byteSize: record.byteSize,
        downloadUrl: signed.downloadUrl,
        expiresAt: signed.expiresAt,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 5. Raw Signed Download Stream (Authenticated by Signature & Expiry)
  // ---------------------------------------------------------------------------
  app.get("/v1/files/raw/:storageKey", async (request, reply) => {
    const storageKey = decodeURIComponent(
      (request.params as { storageKey: string }).storageKey,
    );
    const query = request.query as { fileId?: string; expires?: string; sig?: string };

    if (!query.fileId || !query.expires || !query.sig) {
      return reply.code(400).send({
        code: "INVALID_SIGNED_REQUEST",
        message: "Missing signature query parameters",
      });
    }

    const expiresTimestamp = Number(query.expires);
    const isValidSignature = verifySignedDownloadSignature({
      storageKey,
      fileId: query.fileId,
      expiresTimestamp,
      signature: query.sig,
      secret: secretKey,
    });

    if (!isValidSignature) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "Signed download lease is invalid or expired",
      });
    }

    const [record] = await db
      .select()
      .from(fileAttachments)
      .where(eq(fileAttachments.id, query.fileId))
      .limit(1);

    if (!record || record.status === "DELETED") {
      return reply.code(404).send({
        code: "FILE_NOT_FOUND",
        message: "File record not found",
      });
    }

    if (record.scanStatus === "QUARANTINED") {
      return reply.code(403).send({
        code: "FILE_QUARANTINED",
        message: "Download blocked: file is in quarantine.",
      });
    }

    const buffer = fileContentStore.get(storageKey) ?? Buffer.from("Skilled Hire Mock File Binary Payload", "utf8");

    reply.header("Content-Type", record.mimeType);
    reply.header(
      "Content-Disposition",
      `attachment; filename="${sanitizeFileName(record.fileName)}"`,
    );
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "private, no-transform, max-age=900");

    return reply.send(buffer);
  });

  // ---------------------------------------------------------------------------
  // 6. Quarantine Review & Admin Override (Staff Only)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/files/:id/quarantine-override",
    { preHandler: [authenticate, requireStaff] },
    async (request, reply) => {
      const currentActor = actor(request);
      const fileId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(quarantineOverrideSchema, request.body);

      const [record] = await db
        .select()
        .from(fileAttachments)
        .where(eq(fileAttachments.id, fileId))
        .limit(1);

      if (!record) {
        return reply.code(404).send({
          code: "FILE_NOT_FOUND",
          message: "File record not found",
        });
      }

      const now = new Date();

      await db
        .update(fileAttachments)
        .set({
          status: "ACTIVE",
          scanStatus: "CLEAN",
          quarantineReason: `Quarantine overridden by staff ${currentActor.id}: ${body.reason}`,
          updatedAt: now,
        })
        .where(eq(fileAttachments.id, fileId));

      await db.insert(fileQuarantineEvents).values({
        fileId: record.id,
        triggerReason: `Staff Manual Override: ${body.reason}`,
        detectedSignatures: ["MANUAL_ADMIN_OVERRIDE"],
        resolvedByUserId: currentActor.id,
        resolvedAt: now,
        resolutionNotes: body.reason,
      });

      await audit(
        currentActor.id,
        "FILE_QUARANTINE_OVERRIDDEN",
        "file_attachment",
        record.id,
        { quarantineReason: record.quarantineReason },
        {
          status: "ACTIVE",
          scanStatus: "CLEAN",
          overrideReason: body.reason,
        },
      );

      return {
        success: true,
        fileId: record.id,
        status: "ACTIVE",
        scanStatus: "CLEAN",
        message: "File cleared from quarantine by authorized staff override",
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 7. Delete File Attachment / Retention Soft-Delete (Authenticated)
  // ---------------------------------------------------------------------------
  app.delete(
    "/v1/files/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const fileId = parse(z.object({ id: uuid }), request.params).id;

      const [record] = await db
        .select()
        .from(fileAttachments)
        .where(eq(fileAttachments.id, fileId))
        .limit(1);

      if (!record) {
        return reply.code(404).send({
          code: "FILE_NOT_FOUND",
          message: "File record not found",
        });
      }

      if (record.ownerUserId !== currentActor.id && !currentActor.roles.some((r) => ["ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT"].includes(r))) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You cannot delete this file",
        });
      }

      const now = new Date();
      await db
        .update(fileAttachments)
        .set({
          status: "DELETED",
          deletedAt: now,
          updatedAt: now,
        })
        .where(eq(fileAttachments.id, fileId));

      fileContentStore.delete(record.storageKey);

      await audit(
        currentActor.id,
        "FILE_DELETED",
        "file_attachment",
        record.id,
        { status: record.status },
        { status: "DELETED" },
        {
          storageKey: record.storageKey,
          fileName: record.fileName,
        },
      );

      return {
        success: true,
        message: "File attachment marked as deleted according to retention policy",
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 8. List File Attachments with Strict Scoping (Authenticated)
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/files",
    { preHandler: authenticate },
    async (request) => {
      const currentActor = actor(request);
      const query = request.query as {
        jobId?: string;
        serviceRequestId?: string;
        category?: string;
      };

      const conditions = [eq(fileAttachments.status, "ACTIVE")];

      if (query.jobId) {
        conditions.push(eq(fileAttachments.jobId, query.jobId));
      }
      if (query.serviceRequestId) {
        conditions.push(eq(fileAttachments.serviceRequestId, query.serviceRequestId));
      }
      if (query.category) {
        conditions.push(eq(fileAttachments.fileCategory, query.category));
      }

      const rows = await db
        .select()
        .from(fileAttachments)
        .where(and(...conditions))
        .orderBy(desc(fileAttachments.createdAt))
        .limit(50);

      // Filter by object authorization
      const authorizedFiles = rows.filter((row) =>
        canActorAccessFile(currentActor, {
          ownerUserId: row.ownerUserId,
          contractorId: row.contractorId,
          customerId: row.customerId,
          visibility: row.visibility as FileVisibility,
          scanStatus: row.scanStatus as FileScanStatus,
        }),
      );

      return {
        files: authorizedFiles.map((row) => ({
          id: row.id,
          storageKey: row.storageKey,
          ownerUserId: row.ownerUserId,
          contractorId: row.contractorId,
          customerId: row.customerId,
          jobId: row.jobId,
          serviceRequestId: row.serviceRequestId,
          category: row.fileCategory,
          fileName: row.fileName,
          mimeType: row.mimeType,
          byteSize: row.byteSize,
          scanStatus: row.scanStatus,
          visibility: row.visibility,
          status: row.status,
          uploadedAt: row.uploadedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    },
  );
};
