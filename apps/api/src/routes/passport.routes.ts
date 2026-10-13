// apps/api/src/routes/passport.routes.ts

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  db,
  eq,
  and,
  desc,
  isNull,
  properties,
  propertySystems,
  serviceRecords,
  verticals,
  users,
  contractors,
  propertyAccessGrants,
  propertyOwnershipTransfers,
  jobCompletionReports,
} from "@marketplace/database";
import {
  createPropertyAssetSchema,
  createPropertyAccessGrantSchema,
  initiatePropertyTransferSchema,
  acceptPropertyTransferSchema,
} from "@marketplace/validation";
import {
  filterPassportServiceHistory,
  generateOwnershipTransferToken,
} from "@marketplace/vertical-engine";
import type {
  PropertyAsset,
  PropertyAccessGrant,
  PassportServiceHistoryItem,
  PropertyPassportView,
  AccessGrantScope,
} from "@marketplace/contracts";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const passportRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/properties/:id/passport
  app.get(
    "/v1/properties/:id/passport",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;

      const [property] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, propertyId), isNull(properties.deletedAt)))
        .limit(1);

      if (!property) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Property not found",
        });
      }

      const isOwner = property.customerId === user.id;

      // Check if user has an active contractor access grant
      let accessScope: AccessGrantScope = "FULL_HISTORY";
      let grantActive = false;
      let serviceVerticalId: string | null = null;

      if (!isOwner && !isOps(user)) {
        if (!user.contractorId) {
          return reply.code(403).send({
            statusCode: 403,
            code: "FORBIDDEN",
            message: "Not authorized to view Property Service Passport",
          });
        }

        const [grant] = await db
          .select()
          .from(propertyAccessGrants)
          .where(
            and(
              eq(propertyAccessGrants.propertyId, propertyId),
              eq(propertyAccessGrants.granteeContractorId, user.contractorId),
              eq(propertyAccessGrants.status, "ACTIVE"),
            ),
          )
          .limit(1);

        if (!grant || new Date() > grant.expiresAt) {
          return reply.code(403).send({
            statusCode: 403,
            code: "FORBIDDEN",
            message: "No active access grant on file for this contractor",
          });
        }

        grantActive = true;
        accessScope = grant.scope as AccessGrantScope;
        serviceVerticalId = grant.serviceVerticalId;
      }

      // Fetch assets
      const assetRows = await db
        .select()
        .from(propertySystems)
        .where(
          and(
            eq(propertySystems.propertyId, propertyId),
            isNull(propertySystems.deletedAt),
          ),
        )
        .orderBy(desc(propertySystems.createdAt));

      const assets: PropertyAsset[] = assetRows.map((r) => ({
        id: r.id,
        propertyId: r.propertyId,
        verticalId: r.verticalId,
        name: r.name,
        assetType: r.assetType ?? "GENERAL_EQUIPMENT",
        manufacturer: r.manufacturer,
        modelNumber: r.modelNumber,
        serialNumber: r.serialNumber,
        installedOn: r.installedOn,
        warrantyStatus: (r.warrantyStatus as PropertyAsset["warrantyStatus"]) ?? "ACTIVE",
        lastServiceRecordId: r.lastServiceRecordId,
        lastServicedAt: r.lastServicedAt ? r.lastServicedAt.toISOString() : undefined,
        installedByContractorId: r.installedByContractorId,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      }));

      // Fetch raw service records
      const rawRecords = await db
        .select({
          serviceRecordId: serviceRecords.id,
          jobId: serviceRecords.jobId,
          completedAt: serviceRecords.completedAt,
          vertical: verticals.slug,
          summary: serviceRecords.summary,
          regulatoryStatus: serviceRecords.regulatorySignOffStatus,
          documentationPackageId: serviceRecords.documentationPackageId,
        })
        .from(serviceRecords)
        .innerJoin(verticals, eq(verticals.id, serviceRecords.verticalId))
        .where(eq(serviceRecords.propertyId, propertyId))
        .orderBy(desc(serviceRecords.completedAt));

      const historyItems: PassportServiceHistoryItem[] = rawRecords.map((r) => ({
        serviceRecordId: r.serviceRecordId,
        jobId: r.jobId,
        completedAt: r.completedAt.toISOString(),
        vertical: r.vertical,
        summary: r.summary,
        costRedacted: false,
        regulatoryStatus: r.regulatoryStatus,
        documentationPackageId: r.documentationPackageId,
      }));

      // Apply filtering and redaction
      const filteredHistory = filterPassportServiceHistory({
        history: historyItems,
        scope: accessScope,
        isOwner: isOwner || isOps(user),
        serviceVerticalId,
      });

      // Fetch active access grants if owner or ops
      let activeGrants: PropertyAccessGrant[] = [];
      if (isOwner || isOps(user)) {
        const grantRows = await db
          .select()
          .from(propertyAccessGrants)
          .where(
            and(
              eq(propertyAccessGrants.propertyId, propertyId),
              eq(propertyAccessGrants.status, "ACTIVE"),
            ),
          )
          .orderBy(desc(propertyAccessGrants.createdAt));

        activeGrants = grantRows.map((g) => ({
          id: g.id,
          propertyId: g.propertyId,
          granteeContractorId: g.granteeContractorId,
          grantedByUserId: g.grantedByUserId,
          scope: g.scope as AccessGrantScope,
          serviceVerticalId: g.serviceVerticalId,
          reason: g.reason,
          status: g.status as PropertyAccessGrant["status"],
          expiresAt: g.expiresAt.toISOString(),
          revokedAt: g.revokedAt ? g.revokedAt.toISOString() : undefined,
          revokedByUserId: g.revokedByUserId,
          createdAt: g.createdAt.toISOString(),
        }));
      }

      const passport: PropertyPassportView = {
        propertyId: property.id,
        label: property.label,
        address: {
          addressLine1: property.addressLine1,
          city: property.city,
          region: property.region,
          postalCode: property.postalCode,
        },
        assets,
        serviceHistory: filteredHistory,
        activeGrants,
        isOwner,
        accessScope,
      };

      return reply.code(200).send({ passport });
    },
  );

  // POST /v1/properties/:id/assets
  app.post(
    "/v1/properties/:id/assets",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createPropertyAssetSchema, request.body);

      const [property] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, propertyId), isNull(properties.deletedAt)))
        .limit(1);

      if (!property) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Property not found",
        });
      }

      // Check authorization: Owner, Ops, or Contractor with access
      const isOwner = property.customerId === user.id;
      if (!isOwner && !isOps(user) && !user.contractorId) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to manage assets for this property",
        });
      }

      const [asset] = await db
        .insert(propertySystems)
        .values({
          propertyId,
          verticalId: body.verticalId,
          name: body.name,
          assetType: body.assetType,
          manufacturer: body.manufacturer ?? null,
          modelNumber: body.modelNumber ?? null,
          serialNumber: body.serialNumber ?? null,
          installedOn: body.installedOn ?? null,
          warrantyStatus: body.warrantyStatus,
          metadata: body.metadata,
          installedByContractorId: user.contractorId ?? null,
        })
        .returning();

      await audit(
        user.id,
        "PROPERTY_ASSET_REGISTERED",
        "PROPERTY_SYSTEM",
        asset!.id,
        null,
        { propertyId, name: body.name, assetType: body.assetType },
      );

      return reply.code(201).send({ asset });
    },
  );

  // GET /v1/properties/:id/assets
  app.get(
    "/v1/properties/:id/assets",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;

      const [property] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, propertyId), isNull(properties.deletedAt)))
        .limit(1);

      if (!property) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Property not found",
        });
      }

      const assets = await db
        .select()
        .from(propertySystems)
        .where(
          and(
            eq(propertySystems.propertyId, propertyId),
            isNull(propertySystems.deletedAt),
          ),
        )
        .orderBy(desc(propertySystems.createdAt));

      return reply.code(200).send({ assets });
    },
  );

  // POST /v1/properties/:id/access-grants
  app.post(
    "/v1/properties/:id/access-grants",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createPropertyAccessGrantSchema, request.body);

      const [property] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, propertyId), isNull(properties.deletedAt)))
        .limit(1);

      if (!property) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Property not found",
        });
      }

      if (!isOps(user) && property.customerId !== user.id) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only property owner can grant passport access",
        });
      }

      const durationDays = body.durationDays ?? 30;
      const expiresAt = new Date(
        Date.now() + durationDays * 24 * 60 * 60 * 1000,
      );

      const [grant] = await db
        .insert(propertyAccessGrants)
        .values({
          propertyId,
          granteeContractorId: body.granteeContractorId,
          grantedByUserId: user.id,
          scope: body.scope,
          serviceVerticalId: body.serviceVerticalId ?? null,
          reason: body.reason ?? null,
          status: "ACTIVE",
          expiresAt,
        })
        .returning();

      await audit(
        user.id,
        "PROPERTY_ACCESS_GRANTED",
        "PROPERTY_ACCESS_GRANT",
        grant!.id,
        null,
        {
          propertyId,
          granteeContractorId: body.granteeContractorId,
          scope: body.scope,
          expiresAt: expiresAt.toISOString(),
        },
      );

      return reply.code(201).send({ accessGrant: grant });
    },
  );

  // DELETE /v1/properties/:id/access-grants/:grantId
  app.delete(
    "/v1/properties/:id/access-grants/:grantId",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const { id: propertyId, grantId } = parse(
        z.object({ id: uuid, grantId: uuid }),
        request.params,
      );

      const [property] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, propertyId), isNull(properties.deletedAt)))
        .limit(1);

      if (!property) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Property not found",
        });
      }

      if (!isOps(user) && property.customerId !== user.id) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only property owner can revoke passport access grants",
        });
      }

      const [revoked] = await db
        .update(propertyAccessGrants)
        .set({
          status: "REVOKED",
          revokedAt: new Date(),
          revokedByUserId: user.id,
        })
        .where(
          and(
            eq(propertyAccessGrants.id, grantId),
            eq(propertyAccessGrants.propertyId, propertyId),
          ),
        )
        .returning();

      if (!revoked) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Access grant not found",
        });
      }

      await audit(
        user.id,
        "PROPERTY_ACCESS_REVOKED",
        "PROPERTY_ACCESS_GRANT",
        grantId,
        null,
        { propertyId },
      );

      return reply.code(200).send({
        message: "Access grant revoked successfully",
        accessGrant: revoked,
      });
    },
  );

  // POST /v1/properties/:id/transfer
  app.post(
    "/v1/properties/:id/transfer",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(initiatePropertyTransferSchema, request.body);

      const [property] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, propertyId), isNull(properties.deletedAt)))
        .limit(1);

      if (!property) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Property not found",
        });
      }

      if (!isOps(user) && property.customerId !== user.id) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only current property owner can initiate transfer",
        });
      }

      const [newOwner] = await db
        .select()
        .from(users)
        .where(eq(users.email, body.newOwnerEmail))
        .limit(1);

      if (!newOwner) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "New owner account not found by email",
        });
      }

      const token = generateOwnershipTransferToken();

      const [transfer] = await db
        .insert(propertyOwnershipTransfers)
        .values({
          propertyId,
          previousOwnerUserId: property.customerId,
          newOwnerUserId: newOwner.id,
          status: "PENDING",
          verificationToken: token,
          transferNotes: body.transferNotes ?? null,
        })
        .returning();

      await audit(
        user.id,
        "PROPERTY_TRANSFER_INITIATED",
        "PROPERTY_TRANSFER",
        transfer!.id,
        null,
        { propertyId, newOwnerEmail: body.newOwnerEmail, token },
      );

      return reply.code(201).send({
        transferId: transfer!.id,
        verificationToken: token,
        status: transfer!.status,
      });
    },
  );

  // POST /v1/properties/transfers/accept
  app.post(
    "/v1/properties/transfers/accept",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const body = parse(acceptPropertyTransferSchema, request.body);

      const [transfer] = await db
        .select()
        .from(propertyOwnershipTransfers)
        .where(
          and(
            eq(
              propertyOwnershipTransfers.verificationToken,
              body.verificationToken,
            ),
            eq(propertyOwnershipTransfers.status, "PENDING"),
          ),
        )
        .limit(1);

      if (!transfer) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Invalid or expired transfer verification token",
        });
      }

      // Must be the intended new owner
      if (transfer.newOwnerUserId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only the designated new owner can accept this property transfer",
        });
      }

      // Reassign property customerId
      await db
        .update(properties)
        .set({
          customerId: transfer.newOwnerUserId,
          updatedAt: new Date(),
        })
        .where(eq(properties.id, transfer.propertyId));

      // Mark transfer accepted
      const [updatedTransfer] = await db
        .update(propertyOwnershipTransfers)
        .set({
          status: "VERIFIED_ACCEPTED",
          verifiedAt: new Date(),
        })
        .where(eq(propertyOwnershipTransfers.id, transfer.id))
        .returning();

      await audit(
        user.id,
        "PROPERTY_TRANSFER_COMPLETED",
        "PROPERTY_TRANSFER",
        transfer.id,
        null,
        { propertyId: transfer.propertyId, newOwnerId: user.id },
      );

      return reply.code(200).send({
        message: "Property ownership transfer completed successfully",
        transfer: updatedTransfer,
      });
    },
  );
};
