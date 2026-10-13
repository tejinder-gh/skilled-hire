import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import {
  db,
  eq,
  and,
  isNull,
  desc,
  properties,
  serviceRecords,
  verticals,
} from "@marketplace/database";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

export const propertiesRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/properties",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(actor(request), "CUSTOMER");
      const body = parse(
        z.object({
          label: z.string().min(1).max(100),
          addressLine1: z.string().min(1).max(200),
          city: z.string().min(1).max(100),
          region: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
        }),
        request.body,
      );
      const [inserted] = await db
        .insert(properties)
        .values({
          customerId: actor(request).id,
          label: body.label,
          addressLine1: body.addressLine1,
          city: body.city,
          region: body.region,
          postalCode: body.postalCode,
          latitude:
            body.latitude !== undefined ? body.latitude.toString() : null,
          longitude:
            body.longitude !== undefined ? body.longitude.toString() : null,
        })
        .returning({ id: properties.id });

      const id = inserted?.id;
      if (!id) throw new Error("INSERT_FAILED");
      await audit(
        actor(request).id,
        "PROPERTY_CREATED",
        "PROPERTY",
        id,
        null,
        body,
      );
      return reply.code(201).send({ id });
    },
  );

  app.get(
    "/v1/properties",
    { preHandler: authenticate },
    async (request) => {
      return await db
        .select({
          id: properties.id,
          label: properties.label,
          address_line1: properties.addressLine1,
          city: properties.city,
          region: properties.region,
          postal_code: properties.postalCode,
        })
        .from(properties)
        .where(
          and(
            eq(properties.customerId, actor(request).id),
            isNull(properties.deletedAt),
          ),
        )
        .orderBy(desc(properties.createdAt));
    },
  );

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
