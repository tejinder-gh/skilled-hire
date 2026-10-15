import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import {
  db,
  eq,
  and,
  isNull,
  desc,
  sql,
  properties,
  propertySystems,
  serviceRecords,
  verticals,
  users,
  userRoles,
  userMfaDevices,
  serviceRequests,
  jobs,
  customerServiceCredits,
  bookingDrafts,
} from "@marketplace/database";
import {
  createPropertySchema,
  updatePropertySchema,
  updateCustomerProfileSchema,
  saveBookingDraftSchema,
} from "@marketplace/validation";
import type {
  CustomerProfileDTO,
  CustomerPropertyDTO,
} from "@marketplace/contracts";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const propertiesRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // 1. Customer Profile Management
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/customer/profile",
    { preHandler: authenticate },
    async (request, reply): Promise<CustomerProfileDTO> => {
      const user = actor(request);

      const [userData] = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.displayName,
          phoneNumber: users.phoneNumber,
          emailVerified: users.emailVerified,
          mfaEnabled: users.mfaRequired,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      if (!userData) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Customer user not found" });
      }

      // Count properties
      const [propCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(
          and(eq(properties.customerId, user.id), isNull(properties.deletedAt)),
        );

      // Count active service requests
      const [reqCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(serviceRequests)
        .where(
          and(
            eq(serviceRequests.customerId, user.id),
            sql`${serviceRequests.status} NOT IN ('COMPLETED', 'CANCELLED')`,
          ),
        );

      // Count completed jobs
      const [jobCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .innerJoin(
          serviceRequests,
          eq(jobs.serviceRequestId, serviceRequests.id),
        )
        .where(
          and(
            eq(serviceRequests.customerId, user.id),
            eq(jobs.status, "COMPLETED"),
          ),
        );

      // Sum active courtesy credits
      const [creditSum] = await db
        .select({
          totalBalance: sql<number>`COALESCE(SUM(${customerServiceCredits.balanceCents}), 0)::int`,
        })
        .from(customerServiceCredits)
        .where(
          and(
            eq(customerServiceCredits.customerId, user.id),
            eq(customerServiceCredits.status, "ACTIVE"),
          ),
        );

      return {
        id: userData.id,
        email: userData.email,
        fullName: userData.fullName,
        phoneNumber: userData.phoneNumber,
        role: user.roles[0] ?? "CUSTOMER",
        emailVerified: Boolean(userData.emailVerified),
        mfaEnabled: Boolean(userData.mfaEnabled),
        propertiesCount: propCount?.count ?? 0,
        activeServiceRequestsCount: reqCount?.count ?? 0,
        completedJobsCount: jobCount?.count ?? 0,
        courtesyCreditBalanceCents: creditSum?.totalBalance ?? 0,
        createdAt: userData.createdAt.toISOString(),
      };
    },
  );

  app.patch(
    "/v1/customer/profile",
    { preHandler: authenticate },
    async (request) => {
      const user = actor(request);
      const body = parse(updateCustomerProfileSchema, request.body);

      const updates: {
        displayName?: string;
        phoneNumber?: string;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (body.fullName !== undefined) updates.displayName = body.fullName;
      if (body.phoneNumber !== undefined) updates.phoneNumber = body.phoneNumber;

      const [updated] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, user.id))
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.displayName,
          phoneNumber: users.phoneNumber,
        });

      await audit(
        user.id,
        "CUSTOMER_PROFILE_UPDATED",
        "USER",
        user.id,
        null,
        body,
      );

      return { success: true, profile: updated };
    },
  );

  // ---------------------------------------------------------------------------
  // 2. Multiple Customer Properties CRUD
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/properties",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const user = actor(request);
      const body = parse(createPropertySchema, request.body);

      // If set as primary, unset any existing primary properties for this customer
      if (body.isPrimary) {
        await db
          .update(properties)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(properties.customerId, user.id),
              isNull(properties.deletedAt),
            ),
          );
      } else {
        // If this is the customer's very first property, make it primary automatically
        const [existing] = await db
          .select({ id: properties.id })
          .from(properties)
          .where(
            and(
              eq(properties.customerId, user.id),
              isNull(properties.deletedAt),
            ),
          )
          .limit(1);

        if (!existing) {
          body.isPrimary = true;
        }
      }

      const [inserted] = await db
        .insert(properties)
        .values({
          customerId: user.id,
          label: body.label,
          addressLine1: body.addressLine1,
          unitNumber: body.unitNumber ?? null,
          city: body.city,
          region: body.region ?? "ON",
          postalCode: body.postalCode.toUpperCase().replace(/\s+/g, " ").trim(),
          propertyType: body.propertyType ?? "DETACHED",
          accessNotes: body.accessNotes ?? null,
          isPrimary: Boolean(body.isPrimary),
          latitude:
            body.latitude !== undefined ? body.latitude.toString() : null,
          longitude:
            body.longitude !== undefined ? body.longitude.toString() : null,
          metadata: {},
        })
        .returning();

      if (!inserted) throw new Error("INSERT_FAILED");

      await audit(
        user.id,
        "PROPERTY_CREATED",
        "PROPERTY",
        inserted.id,
        null,
        body,
      );

      return reply.code(201).send({
        id: inserted.id,
        property: {
          id: inserted.id,
          customerId: inserted.customerId,
          label: inserted.label,
          addressLine1: inserted.addressLine1,
          unitNumber: inserted.unitNumber,
          city: inserted.city,
          region: inserted.region,
          postalCode: inserted.postalCode,
          propertyType: inserted.propertyType as any,
          accessNotes: inserted.accessNotes,
          isPrimary: inserted.isPrimary,
          latitude: inserted.latitude ? Number(inserted.latitude) : null,
          longitude: inserted.longitude ? Number(inserted.longitude) : null,
          createdAt: inserted.createdAt.toISOString(),
          updatedAt: inserted.updatedAt.toISOString(),
        },
      });
    },
  );

  app.get(
    "/v1/properties",
    { preHandler: authenticate },
    async (request): Promise<CustomerPropertyDTO[]> => {
      const user = actor(request);

      const rows = await db
        .select({
          id: properties.id,
          customerId: properties.customerId,
          label: properties.label,
          addressLine1: properties.addressLine1,
          unitNumber: properties.unitNumber,
          city: properties.city,
          region: properties.region,
          postalCode: properties.postalCode,
          propertyType: properties.propertyType,
          accessNotes: properties.accessNotes,
          isPrimary: properties.isPrimary,
          latitude: properties.latitude,
          longitude: properties.longitude,
          createdAt: properties.createdAt,
          updatedAt: properties.updatedAt,
          equipmentCount: sql<number>`(
            SELECT count(*)::int FROM property_systems
            WHERE property_systems.property_id = properties.id
            AND property_systems.deleted_at IS NULL
          )`,
        })
        .from(properties)
        .where(
          and(
            eq(properties.customerId, user.id),
            isNull(properties.deletedAt),
          ),
        )
        .orderBy(desc(properties.isPrimary), desc(properties.createdAt));

      return rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        label: r.label,
        addressLine1: r.addressLine1,
        unitNumber: r.unitNumber,
        city: r.city,
        region: r.region,
        postalCode: r.postalCode,
        propertyType: (r.propertyType as any) || "DETACHED",
        accessNotes: r.accessNotes,
        isPrimary: Boolean(r.isPrimary),
        latitude: r.latitude ? Number(r.latitude) : null,
        longitude: r.longitude ? Number(r.longitude) : null,
        equipmentCount: Number(r.equipmentCount ?? 0),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    },
  );

  app.get(
    "/v1/properties/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;

      const [property] = await db
        .select({
          id: properties.id,
          customerId: properties.customerId,
          label: properties.label,
          addressLine1: properties.addressLine1,
          unitNumber: properties.unitNumber,
          city: properties.city,
          region: properties.region,
          postalCode: properties.postalCode,
          propertyType: properties.propertyType,
          accessNotes: properties.accessNotes,
          isPrimary: properties.isPrimary,
          latitude: properties.latitude,
          longitude: properties.longitude,
          createdAt: properties.createdAt,
          updatedAt: properties.updatedAt,
        })
        .from(properties)
        .where(
          and(eq(properties.id, propertyId), isNull(properties.deletedAt)),
        )
        .limit(1);

      if (!property) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Property not found" });
      }

      if (property.customerId !== user.id && !isOps(user)) {
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted to view this property" });
      }

      return property;
    },
  );

  app.patch(
    "/v1/properties/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(updatePropertySchema, request.body);

      const [existing] = await db
        .select()
        .from(properties)
        .where(
          and(eq(properties.id, propertyId), isNull(properties.deletedAt)),
        )
        .limit(1);

      if (!existing) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Property not found" });
      }

      if (existing.customerId !== user.id && !isOps(user)) {
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted to edit this property" });
      }

      if (body.isPrimary) {
        await db
          .update(properties)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(properties.customerId, existing.customerId),
              isNull(properties.deletedAt),
            ),
          );
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.label !== undefined) updates.label = body.label;
      if (body.addressLine1 !== undefined) updates.addressLine1 = body.addressLine1;
      if (body.unitNumber !== undefined) updates.unitNumber = body.unitNumber;
      if (body.city !== undefined) updates.city = body.city;
      if (body.region !== undefined) updates.region = body.region;
      if (body.postalCode !== undefined) {
        updates.postalCode = body.postalCode.toUpperCase().replace(/\s+/g, " ").trim();
      }
      if (body.propertyType !== undefined) updates.propertyType = body.propertyType;
      if (body.accessNotes !== undefined) updates.accessNotes = body.accessNotes;
      if (body.isPrimary !== undefined) updates.isPrimary = body.isPrimary;
      if (body.latitude !== undefined) updates.latitude = body.latitude.toString();
      if (body.longitude !== undefined) updates.longitude = body.longitude.toString();

      const [updated] = await db
        .update(properties)
        .set(updates)
        .where(eq(properties.id, propertyId))
        .returning();

      await audit(
        user.id,
        "PROPERTY_UPDATED",
        "PROPERTY",
        propertyId,
        existing,
        updated,
      );

      return { success: true, property: updated };
    },
  );

  app.delete(
    "/v1/properties/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;

      const [existing] = await db
        .select()
        .from(properties)
        .where(
          and(eq(properties.id, propertyId), isNull(properties.deletedAt)),
        )
        .limit(1);

      if (!existing) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Property not found" });
      }

      if (existing.customerId !== user.id && !isOps(user)) {
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted to delete this property" });
      }

      // Guard: Cannot delete property with active in-flight service requests or jobs
      const [activeReq] = await db
        .select({ id: serviceRequests.id })
        .from(serviceRequests)
        .where(
          and(
            eq(serviceRequests.propertyId, propertyId),
            sql`${serviceRequests.status} NOT IN ('COMPLETED', 'CANCELLED')`,
          ),
        )
        .limit(1);

      if (activeReq) {
        return reply.code(409).send({
          code: "PROPERTY_HAS_ACTIVE_JOBS",
          message: "Cannot delete property while active service requests or jobs are in progress",
        });
      }

      await db
        .update(properties)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(properties.id, propertyId));

      await audit(
        user.id,
        "PROPERTY_DELETED",
        "PROPERTY",
        propertyId,
        existing,
        null,
      );

      return { success: true, message: "Property deleted successfully" };
    },
  );

  // ---------------------------------------------------------------------------
  // 3. Property Equipment Passport
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/properties/:id/equipment",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;

      const [property] = await db
        .select({ customerId: properties.customerId })
        .from(properties)
        .where(
          and(eq(properties.id, propertyId), isNull(properties.deletedAt)),
        )
        .limit(1);

      if (!property) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Property not found" });
      }

      if (property.customerId !== user.id && !isOps(user)) {
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted to view equipment" });
      }

      const equipment = await db
        .select({
          id: propertySystems.id,
          propertyId: propertySystems.propertyId,
          verticalId: propertySystems.verticalId,
          verticalName: verticals.name,
          name: propertySystems.name,
          assetType: propertySystems.assetType,
          manufacturer: propertySystems.manufacturer,
          modelNumber: propertySystems.modelNumber,
          serialNumber: propertySystems.serialNumber,
          warrantyStatus: propertySystems.warrantyStatus,
          installedOn: propertySystems.installedOn,
          lastServicedAt: propertySystems.lastServicedAt,
          metadata: propertySystems.metadata,
        })
        .from(propertySystems)
        .innerJoin(verticals, eq(verticals.id, propertySystems.verticalId))
        .where(
          and(
            eq(propertySystems.propertyId, propertyId),
            isNull(propertySystems.deletedAt),
          ),
        )
        .orderBy(desc(propertySystems.createdAt));

      return equipment;
    },
  );

  app.post(
    "/v1/properties/:id/equipment",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const propertyId = parse(z.object({ id: uuid }), request.params).id;

      const [property] = await db
        .select({ customerId: properties.customerId })
        .from(properties)
        .where(
          and(eq(properties.id, propertyId), isNull(properties.deletedAt)),
        )
        .limit(1);

      if (!property) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Property not found" });
      }

      if (property.customerId !== user.id && !isOps(user)) {
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted to add equipment" });
      }

      const body = parse(
        z.object({
          verticalId: uuid,
          name: z.string().min(1).max(150),
          assetType: z.string().min(1).max(100).default("GENERAL_EQUIPMENT"),
          manufacturer: z.string().max(100).optional(),
          modelNumber: z.string().max(100).optional(),
          serialNumber: z.string().max(100).optional(),
          installedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          warrantyStatus: z.enum(["ACTIVE", "EXPIRED", "UNKNOWN", "EXTENDED"]).default("ACTIVE"),
          metadata: z.record(z.string(), z.unknown()).default({}),
        }),
        request.body,
      );

      const [newAsset] = await db
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
        })
        .returning();

      if (!newAsset) throw new Error("INSERT_FAILED");

      await audit(
        user.id,
        "PROPERTY_EQUIPMENT_ADDED",
        "PROPERTY_SYSTEM",
        newAsset.id,
        null,
        body,
      );

      return reply.code(201).send({ success: true, asset: newAsset });
    },
  );

  // ---------------------------------------------------------------------------
  // 4. Booking Draft Synchronization (Cross-Device & Mobile Resilience)
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/customer/booking-draft",
    { preHandler: authenticate },
    async (request) => {
      const user = actor(request);

      const [draft] = await db
        .select()
        .from(bookingDrafts)
        .where(eq(bookingDrafts.customerId, user.id))
        .limit(1);

      if (!draft) return { draft: null };

      return {
        draft: {
          id: draft.id,
          customerId: draft.customerId,
          step: draft.step,
          draftPayload: draft.draftPayload,
          createdAt: draft.createdAt.toISOString(),
          updatedAt: draft.updatedAt.toISOString(),
        },
      };
    },
  );

  app.put(
    "/v1/customer/booking-draft",
    { preHandler: authenticate },
    async (request) => {
      const user = actor(request);
      const body = parse(saveBookingDraftSchema, request.body);

      const [upserted] = await db
        .insert(bookingDrafts)
        .values({
          customerId: user.id,
          step: body.step,
          draftPayload: body.draftPayload,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: bookingDrafts.customerId,
          set: {
            step: body.step,
            draftPayload: body.draftPayload,
            updatedAt: new Date(),
          },
        })
        .returning();

      return { success: true, draft: upserted };
    },
  );

  app.delete(
    "/v1/customer/booking-draft",
    { preHandler: authenticate },
    async (request) => {
      const user = actor(request);

      await db
        .delete(bookingDrafts)
        .where(eq(bookingDrafts.customerId, user.id));

      return { success: true, message: "Draft cleared" };
    },
  );

  // ---------------------------------------------------------------------------
  // 5. Property Service History
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/properties/:id/history",
    { preHandler: authenticate },
    async (request, reply) => {
      const propertyId = parse(z.object({ id: uuid }), request.params).id;
      const records = await db
        .select({
          customer_id: properties.customerId,
          id: serviceRecords.id,
          vertical: verticals.name,
          summary: serviceRecords.summary,
          equipment: serviceRecords.equipment,
          completed_at: serviceRecords.completedAt,
        })
        .from(serviceRecords)
        .innerJoin(properties, eq(properties.id, serviceRecords.propertyId))
        .innerJoin(verticals, eq(verticals.id, serviceRecords.verticalId))
        .where(eq(serviceRecords.propertyId, propertyId))
        .orderBy(desc(serviceRecords.completedAt));

      if (
        records[0] &&
        records[0].customer_id !== actor(request).id &&
        !isOps(actor(request))
      )
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "Not permitted" });
      return records;
    },
  );
};
