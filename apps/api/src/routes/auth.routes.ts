import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { verifyPassword } from "@marketplace/auth";
import { db, eq, and, isNull, users } from "@marketplace/database";
import { actor, authenticate, parse, rolesSchema } from "../common/auth.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    ok: true,
    service: "skilled-hire-api",
    app: "Skilled Hire",
    domain: "skilledhire.ca",
  }));

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = parse(
        z.object({ email: z.string().email(), password: z.string().min(1) }),
        request.body,
      );
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.email, body.email.toLowerCase()),
          isNull(users.deletedAt),
        ),
        with: {
          roles: true,
        },
      });
      if (!user || !(await verifyPassword(body.password, user.passwordHash)))
        return reply
          .code(401)
          .send({
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password",
          });
      const token = await reply.jwtSign(
        { sub: user.id, sessionVersion: user.sessionVersion },
        { expiresIn: "15m" },
      );
      return {
        accessToken: token,
        roles: rolesSchema.parse(user.roles.map((r) => r.role)),
      };
    },
  );

  app.get("/v1/me", { preHandler: authenticate }, async (request) => ({
    actor: actor(request),
  }));
};
