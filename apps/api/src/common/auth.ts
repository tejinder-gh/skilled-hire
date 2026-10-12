import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { hasRole } from "@marketplace/auth";
import type { Actor, Role } from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  isNull,
  users,
  contractors,
  technicians,
} from "@marketplace/database";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export const uuid = z.string().uuid();

export const rolesSchema = z
  .union([
    z.array(
      z.enum([
        "CUSTOMER",
        "CONTRACTOR_OWNER",
        "CONTRACTOR_MANAGER",
        "TECHNICIAN",
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "SUPPORT_AGENT",
        "QUOTE_REVIEWER",
        "ADMIN",
        "SUPER_ADMIN",
      ]),
    ),
    z.string().transform((v) =>
      v
        .replace(/[{}]/g, "")
        .split(",")
        .filter(Boolean),
    ),
    z.array(z.string()),
  ])
  .transform((roles) => roles as Role[]);

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const payload = await request.jwtVerify<{
      sub: string;
      sessionVersion: number;
    }>();
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, payload.sub), isNull(users.deletedAt)),
      with: {
        roles: true,
      },
    });
    if (!user || user.sessionVersion !== payload.sessionVersion)
      throw new Error("SESSION_REVOKED");

    const [tech] = await db
      .select({ contractorId: technicians.contractorId })
      .from(technicians)
      .where(eq(technicians.userId, user.id))
      .limit(1);

    const [contractor] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.ownerUserId, user.id))
      .limit(1);

    const contractorId = tech?.contractorId ?? contractor?.id ?? null;

    request.actor = {
      id: user.id,
      roles: rolesSchema.parse(user.roles.map((r) => r.role)),
      ...(contractorId ? { contractorId } : {}),
    };
  } catch {
    await reply
      .code(401)
      .send({
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: request.id,
      });
  }
}

export function actor(request: FastifyRequest): Actor {
  if (!request.actor) throw new Error("UNAUTHENTICATED");
  return request.actor;
}

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

export function isOps(value: Actor): boolean {
  return hasRole(
    value,
    "OPERATIONS_AGENT",
    "DISPATCHER",
    "ADMIN",
    "SUPER_ADMIN",
  );
}
