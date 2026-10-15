import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  hasRole,
  isStaff,
  parseCookies,
  assertTenantAccess,
  assertCustomerAccess,
} from "@marketplace/auth";
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
    let payload: { sub: string; sessionVersion: number } | null = null;

    // 1. Try Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      payload = await request.jwtVerify<{
        sub: string;
        sessionVersion: number;
      }>();
    } else {
      // 2. Try sh_access cookie
      const cookies = parseCookies(request.headers.cookie);
      const cookieToken = cookies["sh_access"];
      if (cookieToken) {
        payload = request.server.jwt.verify<{
          sub: string;
          sessionVersion: number;
        }>(cookieToken);
      }
    }

    if (!payload || !payload.sub) {
      throw new Error("UNAUTHENTICATED");
    }

    const user = await db.query.users.findFirst({
      where: and(eq(users.id, payload.sub), isNull(users.deletedAt)),
      with: {
        roles: true,
      },
    });

    if (!user || user.sessionVersion !== payload.sessionVersion) {
      throw new Error("SESSION_REVOKED");
    }

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
    await reply.code(401).send({
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
  return isStaff(value);
}

export function requireStaff(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const currentActor = request.actor;
  if (!currentActor || !isStaff(currentActor)) {
    reply.code(403).send({
      code: "FORBIDDEN",
      message: "Staff clearance required for this operation",
    });
    return;
  }
  done();
}

export function requireTenant(
  getContractorId: (request: FastifyRequest) => string | null | undefined,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const currentActor = request.actor;
    if (!currentActor) {
      await reply.code(401).send({ code: "UNAUTHENTICATED", message: "Login required" });
      return;
    }
    const contractorId = getContractorId(request);
    try {
      assertTenantAccess(currentActor, contractorId);
    } catch {
      await reply.code(403).send({
        code: "FORBIDDEN",
        message: "Cross-tenant access denied",
      });
    }
  };
}

export function requireCustomer(
  getCustomerId: (request: FastifyRequest) => string | null | undefined,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const currentActor = request.actor;
    if (!currentActor) {
      await reply.code(401).send({ code: "UNAUTHENTICATED", message: "Login required" });
      return;
    }
    const customerId = getCustomerId(request);
    try {
      assertCustomerAccess(currentActor, customerId);
    } catch {
      await reply.code(403).send({
        code: "FORBIDDEN",
        message: "Cross-customer access denied",
      });
    }
  };
}
