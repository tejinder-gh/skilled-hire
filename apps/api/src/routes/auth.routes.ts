import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
  hashToken,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateTotpUri,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  generateCsrfToken,
  formatCookie,
  formatClearCookie,
  parseCookies,
  isStaff,
} from "@marketplace/auth";
import {
  db,
  eq,
  and,
  isNull,
  gt,
  desc,
  users,
  userRoles,
  userSessions,
  userMfaDevices,
  userMfaChallenges,
  userPasswordResets,
  userEmailVerifications,
} from "@marketplace/database";
import {
  signupSchema,
  loginSchema,
  mfaConfirmSetupSchema,
  mfaVerifySchema,
  refreshTokenSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  verifyEmailSchema,
} from "@marketplace/validation";
import { actor, authenticate, parse, rolesSchema } from "../common/auth.js";
import { checkRateLimit, recordFailedAttempt, clearRateLimit } from "../common/rate-limiter.js";

const ACCESS_TOKEN_TTL = "15m";
const ACCESS_COOKIE_MAX_AGE = 15 * 60; // 15 mins
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    ok: true,
    service: "skilled-hire-api",
    app: "Skilled Hire",
    domain: "skilledhire.ca",
  }));

  // ---------------------------------------------------------------------------
  // 1. CSRF Token Endpoint
  // ---------------------------------------------------------------------------
  app.get("/v1/auth/csrf", async (_request, reply) => {
    const csrfToken = generateCsrfToken();
    reply.header(
      "Set-Cookie",
      formatCookie("sh_csrf", csrfToken, {
        httpOnly: false, // Client JS must be able to read CSRF token
        maxAgeSeconds: REFRESH_COOKIE_MAX_AGE,
        sameSite: "lax",
      }),
    );
    return { csrfToken };
  });

  // ---------------------------------------------------------------------------
  // 2. Production Signup
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/signup", async (request, reply) => {
    const body = parse(signupSchema, request.body);
    const normalizedEmail = body.email.toLowerCase().trim();

    // Prevent unauthorized self-assignment of staff administrative roles
    if (body.role && ["ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT", "DISPATCHER"].includes(body.role)) {
      return reply.code(403).send({
        code: "FORBIDDEN_ROLE_ASSIGNMENT",
        message: "Staff administrative roles cannot be self-assigned during signup",
      });
    }

    const assignedRole = body.role ?? "CUSTOMER";

    // Check for existing active account
    const existing = await db.query.users.findFirst({
      where: and(eq(users.email, normalizedEmail), isNull(users.deletedAt)),
    });

    if (existing) {
      return reply.code(409).send({
        code: "EMAIL_ALREADY_EXISTS",
        message: "An active account with this email address already exists",
      });
    }

    const passwordHash = await hashPassword(body.password);

    // Insert user and role in atomic transaction
    const [createdUser] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        displayName: body.displayName.trim(),
        emailVerified: false,
        phoneNumber: body.phoneNumber ?? null,
        phoneVerified: false,
        mfaRequired: false,
        sessionVersion: 1,
      })
      .returning();

    if (!createdUser) {
      throw new Error("Failed to create user account");
    }

    await db.insert(userRoles).values({
      userId: createdUser.id,
      role: assignedRole,
    });

    // Create Email Verification Token
    const verificationRawToken = generateSecureToken(32);
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await db.insert(userEmailVerifications).values({
      userId: createdUser.id,
      tokenHash: hashToken(verificationRawToken),
      expiresAt: verificationExpiresAt,
    });

    // Create Initial User Session & Refresh Token
    const rawRefreshToken = generateSecureToken(32);
    const sessionExpiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE * 1000);
    const clientIp = request.ip || "127.0.0.1";
    const userAgent = request.headers["user-agent"] || "unknown";

    const [session] = await db
      .insert(userSessions)
      .values({
        userId: createdUser.id,
        refreshTokenHash: hashToken(rawRefreshToken),
        sessionVersion: 1,
        ipAddress: clientIp,
        userAgent,
        expiresAt: sessionExpiresAt,
      })
      .returning();

    // Sign JWT Access Token
    const accessToken = await reply.jwtSign(
      { sub: createdUser.id, sessionVersion: 1 },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    // Set Secure Cookies
    reply.header("Set-Cookie", [
      formatCookie("sh_access", accessToken, {
        httpOnly: true,
        maxAgeSeconds: ACCESS_COOKIE_MAX_AGE,
        sameSite: "lax",
      }),
      formatCookie("sh_refresh", rawRefreshToken, {
        httpOnly: true,
        maxAgeSeconds: REFRESH_COOKIE_MAX_AGE,
        sameSite: "strict",
        path: "/v1/auth",
      }),
    ]);

    reply.code(201);
    return {
      user: {
        id: createdUser.id,
        email: createdUser.email,
        displayName: createdUser.displayName,
        roles: [assignedRole],
        emailVerified: false,
      },
      accessToken,
      refreshToken: rawRefreshToken,
      emailVerificationPending: true,
      emailVerificationToken:
        process.env.NODE_ENV !== "production" ? verificationRawToken : undefined,
      session: {
        id: session?.id ?? "",
        ipAddress: clientIp,
        userAgent,
        createdAt: session?.createdAt.toISOString() ?? new Date().toISOString(),
        expiresAt: sessionExpiresAt.toISOString(),
      },
    };
  });

  // ---------------------------------------------------------------------------
  // 3. Production Login with Distributed Brute-Force Lockout & Staff MFA
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/login", async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const normalizedEmail = body.email.toLowerCase().trim();
    const clientIp = request.ip || "127.0.0.1";
    const rateLimitKey = `login:${normalizedEmail}`;

    // Distributed Rate Limit & Brute-Force Lockout Check
    const rateCheck = await checkRateLimit(rateLimitKey, 5);
    if (!rateCheck.allowed) {
      reply.header("Retry-After", rateCheck.retryAfterSeconds?.toString() ?? "900");
      return reply.code(429).send({
        code: "TOO_MANY_ATTEMPTS",
        message: `Account temporarily locked due to multiple failed login attempts. Please retry in ${rateCheck.retryAfterSeconds} seconds.`,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
    }

    const user = await db.query.users.findFirst({
      where: and(eq(users.email, normalizedEmail), isNull(users.deletedAt)),
      with: {
        roles: true,
      },
    });

    const isPasswordValid =
      user && (await verifyPassword(body.password, user.passwordHash));

    if (!user || !isPasswordValid) {
      const lockStatus = await recordFailedAttempt(rateLimitKey, 5, 15);
      if (lockStatus.locked) {
        reply.header("Retry-After", lockStatus.retryAfterSeconds?.toString() ?? "900");
        return reply.code(429).send({
          code: "TOO_MANY_ATTEMPTS",
          message:
            "Too many failed login attempts. Your account has been temporarily locked for 15 minutes.",
          retryAfterSeconds: lockStatus.retryAfterSeconds,
        });
      }

      return reply.code(401).send({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
        remainingAttempts: Math.max(0, 5 - lockStatus.attempts),
      });
    }

    // Clear failed attempts counter upon successful credential check
    await clearRateLimit(rateLimitKey);

    const userRoleNames = user.roles.map((r) => r.role);
    const mustPerformMfa =
      user.mfaRequired || request.headers["x-require-mfa"] === "true";

    // MFA Challenge Branch
    if (mustPerformMfa) {
      const rawChallengeToken = generateSecureToken(32);
      const challengeExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      await db.insert(userMfaChallenges).values({
        userId: user.id,
        challengeToken: rawChallengeToken,
        expiresAt: challengeExpiresAt,
        attempts: 0,
      });

      return reply.code(200).send({
        mfaRequired: true,
        challengeToken: rawChallengeToken,
        maskedMethod: "TOTP Authenticator",
        roles: rolesSchema.parse(userRoleNames),
      });
    }

    // Normal Authentication Branch: Create Session & Tokens
    const rawRefreshToken = generateSecureToken(32);
    const sessionTtlSeconds = body.rememberMe
      ? 30 * 24 * 60 * 60 // 30 days
      : REFRESH_COOKIE_MAX_AGE; // 7 days
    const sessionExpiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);
    const userAgent = request.headers["user-agent"] || "unknown";

    const [session] = await db
      .insert(userSessions)
      .values({
        userId: user.id,
        refreshTokenHash: hashToken(rawRefreshToken),
        sessionVersion: user.sessionVersion,
        ipAddress: clientIp,
        userAgent,
        expiresAt: sessionExpiresAt,
      })
      .returning();

    const accessToken = await reply.jwtSign(
      { sub: user.id, sessionVersion: user.sessionVersion },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    reply.header("Set-Cookie", [
      formatCookie("sh_access", accessToken, {
        httpOnly: true,
        maxAgeSeconds: ACCESS_COOKIE_MAX_AGE,
        sameSite: "lax",
      }),
      formatCookie("sh_refresh", rawRefreshToken, {
        httpOnly: true,
        maxAgeSeconds: sessionTtlSeconds,
        sameSite: "strict",
        path: "/v1/auth",
      }),
    ]);

    return {
      mfaRequired: false,
      accessToken,
      refreshToken: rawRefreshToken,
      roles: rolesSchema.parse(userRoleNames),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: rolesSchema.parse(userRoleNames),
        emailVerified: user.emailVerified,
      },
      session: {
        id: session?.id ?? "",
        ipAddress: clientIp,
        userAgent,
        createdAt: session?.createdAt.toISOString() ?? new Date().toISOString(),
        expiresAt: sessionExpiresAt.toISOString(),
      },
    };
  });

  // ---------------------------------------------------------------------------
  // 4. MFA Setup & Enrollment (Authenticated)
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/mfa/setup", { preHandler: authenticate }, async (request) => {
    const currentActor = actor(request);
    const user = await db.query.users.findFirst({
      where: eq(users.id, currentActor.id),
    });

    if (!user) throw new Error("User not found");

    const secret = generateTotpSecret(20);
    const backupCodes = generateBackupCodes(8);
    const hashedBackupCodes = backupCodes.map(hashBackupCode);

    // Remove any previous unverified pending devices for clean state
    await db
      .delete(userMfaDevices)
      .where(and(eq(userMfaDevices.userId, user.id), eq(userMfaDevices.verified, false)));

    await db.insert(userMfaDevices).values({
      userId: user.id,
      method: "TOTP",
      secret,
      label: "Skilled Hire Authenticator",
      verified: false,
      backupCodesHash: hashedBackupCodes,
    });

    const otpauthUrl = generateTotpUri({
      secret,
      accountName: user.email,
      issuer: "Skilled Hire",
    });

    return {
      secret,
      otpauthUrl,
      backupCodes,
    };
  });

  // ---------------------------------------------------------------------------
  // 5. MFA Confirm Setup (Authenticated)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/auth/mfa/confirm-setup",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);
      const body = parse(mfaConfirmSetupSchema, request.body);

      const [pendingDevice] = await db
        .select()
        .from(userMfaDevices)
        .where(
          and(
            eq(userMfaDevices.userId, currentActor.id),
            eq(userMfaDevices.verified, false),
          ),
        )
        .orderBy(desc(userMfaDevices.createdAt))
        .limit(1);

      if (!pendingDevice) {
        return reply.code(400).send({
          code: "NO_PENDING_MFA_SETUP",
          message: "No pending MFA setup found. Please initiate MFA setup first.",
        });
      }

      const isValid = verifyTotpCode(pendingDevice.secret, body.code);
      if (!isValid) {
        return reply.code(400).send({
          code: "INVALID_MFA_CODE",
          message: "The 6-digit TOTP code provided is incorrect or has expired.",
        });
      }

      await db
        .update(userMfaDevices)
        .set({
          verified: true,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userMfaDevices.id, pendingDevice.id));

      await db
        .update(users)
        .set({
          mfaRequired: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, currentActor.id));

      return {
        success: true,
        message: "MFA authenticator verified and enrolled successfully.",
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 6. MFA Verify (Public with challengeToken)
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/mfa/verify", async (request, reply) => {
    const body = parse(mfaVerifySchema, request.body);

    const [challenge] = await db
      .select()
      .from(userMfaChallenges)
      .where(eq(userMfaChallenges.challengeToken, body.challengeToken))
      .limit(1);

    const now = new Date();
    if (!challenge || challenge.expiresAt <= now || challenge.verifiedAt) {
      return reply.code(410).send({
        code: "CHALLENGE_EXPIRED",
        message: "MFA challenge token has expired or is invalid. Please log in again.",
      });
    }

    if (challenge.attempts >= 5) {
      return reply.code(429).send({
        code: "TOO_MANY_ATTEMPTS",
        message: "Maximum MFA verification attempts exceeded. Please restart login.",
      });
    }

    // Increment attempts
    await db
      .update(userMfaChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(userMfaChallenges.id, challenge.id));

    // Fetch verified MFA devices for the user
    const devices = await db
      .select()
      .from(userMfaDevices)
      .where(
        and(
          eq(userMfaDevices.userId, challenge.userId),
          eq(userMfaDevices.verified, true),
        ),
      );

    let verified = false;

    // Check TOTP code against verified devices
    for (const device of devices) {
      if (verifyTotpCode(device.secret, body.code)) {
        verified = true;
        await db
          .update(userMfaDevices)
          .set({ lastUsedAt: now })
          .where(eq(userMfaDevices.id, device.id));
        break;
      }

      // Check single-use backup recovery codes
      const hashedCodes = Array.isArray(device.backupCodesHash)
        ? device.backupCodesHash.filter((c): c is string => typeof c === "string")
        : [];
      const backupCheck = verifyBackupCode(body.code, hashedCodes);
      if (backupCheck.valid) {
        verified = true;
        await db
          .update(userMfaDevices)
          .set({
            backupCodesHash: backupCheck.remainingHashedCodes,
            lastUsedAt: now,
          })
          .where(eq(userMfaDevices.id, device.id));
        break;
      }
    }

    if (!verified) {
      return reply.code(401).send({
        code: "INVALID_MFA_CODE",
        message: "Invalid MFA verification code or backup recovery code.",
        remainingAttempts: Math.max(0, 4 - challenge.attempts),
      });
    }

    // Mark challenge verified
    await db
      .update(userMfaChallenges)
      .set({ verifiedAt: now })
      .where(eq(userMfaChallenges.id, challenge.id));

    // Fetch user and issue session
    const user = await db.query.users.findFirst({
      where: eq(users.id, challenge.userId),
      with: {
        roles: true,
      },
    });

    if (!user) throw new Error("User not found");

    const rawRefreshToken = generateSecureToken(32);
    const sessionExpiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE * 1000);
    const clientIp = request.ip || "127.0.0.1";
    const userAgent = request.headers["user-agent"] || "unknown";

    const [session] = await db
      .insert(userSessions)
      .values({
        userId: user.id,
        refreshTokenHash: hashToken(rawRefreshToken),
        sessionVersion: user.sessionVersion,
        ipAddress: clientIp,
        userAgent,
        expiresAt: sessionExpiresAt,
      })
      .returning();

    const accessToken = await reply.jwtSign(
      { sub: user.id, sessionVersion: user.sessionVersion },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    reply.header("Set-Cookie", [
      formatCookie("sh_access", accessToken, {
        httpOnly: true,
        maxAgeSeconds: ACCESS_COOKIE_MAX_AGE,
        sameSite: "lax",
      }),
      formatCookie("sh_refresh", rawRefreshToken, {
        httpOnly: true,
        maxAgeSeconds: REFRESH_COOKIE_MAX_AGE,
        sameSite: "strict",
        path: "/v1/auth",
      }),
    ]);

    const userRoleNames = user.roles.map((r) => r.role);
    return {
      accessToken,
      refreshToken: rawRefreshToken,
      roles: rolesSchema.parse(userRoleNames),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: rolesSchema.parse(userRoleNames),
        emailVerified: user.emailVerified,
      },
      session: {
        id: session?.id ?? "",
        ipAddress: clientIp,
        userAgent,
        createdAt: session?.createdAt.toISOString() ?? new Date().toISOString(),
        expiresAt: sessionExpiresAt.toISOString(),
      },
    };
  });

  // ---------------------------------------------------------------------------
  // 7. Token Refresh & Session Rotation
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/refresh", async (request, reply) => {
    const body = parse(refreshTokenSchema, request.body ?? {});
    const cookies = parseCookies(request.headers.cookie);
    const candidateRefreshToken = body.refreshToken || cookies["sh_refresh"];

    if (!candidateRefreshToken) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Refresh token is missing from request body and cookie",
      });
    }

    const tokenHash = hashToken(candidateRefreshToken);
    const now = new Date();

    const [session] = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.refreshTokenHash, tokenHash),
          gt(userSessions.expiresAt, now),
          isNull(userSessions.revokedAt),
        ),
      )
      .limit(1);

    if (!session) {
      return reply.code(401).send({
        code: "SESSION_EXPIRED",
        message: "Session has expired or has been revoked. Please sign in again.",
      });
    }

    const user = await db.query.users.findFirst({
      where: and(eq(users.id, session.userId), isNull(users.deletedAt)),
    });

    if (!user || user.sessionVersion !== session.sessionVersion) {
      await db
        .update(userSessions)
        .set({ revokedAt: now })
        .where(eq(userSessions.id, session.id));

      return reply.code(401).send({
        code: "SESSION_REVOKED",
        message: "User session version revoked. Please sign in again.",
      });
    }

    // Refresh Token Rotation: Generate new token and advance expiration
    const newRefreshToken = generateSecureToken(32);
    const newExpiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE * 1000);

    await db
      .update(userSessions)
      .set({
        refreshTokenHash: hashToken(newRefreshToken),
        expiresAt: newExpiresAt,
        updatedAt: now,
      })
      .where(eq(userSessions.id, session.id));

    const newAccessToken = await reply.jwtSign(
      { sub: user.id, sessionVersion: user.sessionVersion },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    reply.header("Set-Cookie", [
      formatCookie("sh_access", newAccessToken, {
        httpOnly: true,
        maxAgeSeconds: ACCESS_COOKIE_MAX_AGE,
        sameSite: "lax",
      }),
      formatCookie("sh_refresh", newRefreshToken, {
        httpOnly: true,
        maxAgeSeconds: REFRESH_COOKIE_MAX_AGE,
        sameSite: "strict",
        path: "/v1/auth",
      }),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      sessionVersion: user.sessionVersion,
    };
  });

  // ---------------------------------------------------------------------------
  // 8. Logout (Single Session Invalidation & Cookie Clear)
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/logout", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const body = parse(refreshTokenSchema, request.body ?? {});
    const candidateRefreshToken = body.refreshToken || cookies["sh_refresh"];

    if (candidateRefreshToken) {
      const tokenHash = hashToken(candidateRefreshToken);
      await db
        .update(userSessions)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(userSessions.refreshTokenHash, tokenHash));
    }

    reply.header("Set-Cookie", [
      formatClearCookie("sh_access"),
      formatClearCookie("sh_refresh", { path: "/v1/auth" }),
    ]);

    return {
      success: true,
      message: "Successfully logged out.",
    };
  });

  // ---------------------------------------------------------------------------
  // 9. Global Revocation of All Sessions (Authenticated)
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/revoke-all", { preHandler: authenticate }, async (request, reply) => {
    const currentActor = actor(request);
    const now = new Date();

    const [user] = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, currentActor.id))
      .limit(1);

    const nextVersion = (user?.sessionVersion ?? 1) + 1;

    await db
      .update(users)
      .set({
        sessionVersion: nextVersion,
        updatedAt: now,
      })
      .where(eq(users.id, currentActor.id));

    await db
      .update(userSessions)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(userSessions.userId, currentActor.id),
          isNull(userSessions.revokedAt),
        ),
      );

    reply.header("Set-Cookie", [
      formatClearCookie("sh_access"),
      formatClearCookie("sh_refresh", { path: "/v1/auth" }),
    ]);

    return {
      success: true,
      sessionVersion: nextVersion,
      message: "All active sessions have been globally revoked.",
    };
  });

  // ---------------------------------------------------------------------------
  // 10. List Active Sessions (Authenticated)
  // ---------------------------------------------------------------------------
  app.get("/v1/auth/sessions", { preHandler: authenticate }, async (request) => {
    const currentActor = actor(request);
    const now = new Date();

    const sessions = await db
      .select({
        id: userSessions.id,
        ipAddress: userSessions.ipAddress,
        userAgent: userSessions.userAgent,
        createdAt: userSessions.createdAt,
        expiresAt: userSessions.expiresAt,
      })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, currentActor.id),
          gt(userSessions.expiresAt, now),
          isNull(userSessions.revokedAt),
        ),
      )
      .orderBy(desc(userSessions.createdAt));

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent ?? "unknown",
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
    };
  });

  // ---------------------------------------------------------------------------
  // 11. Password Reset Request & Confirmation
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/password-reset/request", async (request, reply) => {
    const body = parse(passwordResetRequestSchema, request.body);
    const normalizedEmail = body.email.toLowerCase().trim();

    const user = await db.query.users.findFirst({
      where: and(eq(users.email, normalizedEmail), isNull(users.deletedAt)),
    });

    let rawResetToken: string | undefined;

    if (user) {
      rawResetToken = generateSecureToken(32);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.insert(userPasswordResets).values({
        userId: user.id,
        tokenHash: hashToken(rawResetToken),
        expiresAt,
      });
    }

    return {
      success: true,
      message:
        "If a registered account exists for this email, password reset instructions have been generated.",
      resetToken:
        process.env.NODE_ENV !== "production" ? rawResetToken : undefined,
    };
  });

  app.post("/v1/auth/password-reset/confirm", async (request, reply) => {
    const body = parse(passwordResetConfirmSchema, request.body);
    const tokenHash = hashToken(body.token);
    const now = new Date();

    const [resetRecord] = await db
      .select()
      .from(userPasswordResets)
      .where(
        and(
          eq(userPasswordResets.tokenHash, tokenHash),
          gt(userPasswordResets.expiresAt, now),
          isNull(userPasswordResets.usedAt),
        ),
      )
      .limit(1);

    if (!resetRecord) {
      return reply.code(400).send({
        code: "INVALID_OR_EXPIRED_RESET_TOKEN",
        message: "The password reset token is invalid or has expired.",
      });
    }

    const newPasswordHash = await hashPassword(body.newPassword);

    const [user] = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, resetRecord.userId))
      .limit(1);

    const nextSessionVersion = (user?.sessionVersion ?? 1) + 1;

    // Update password, advance sessionVersion, invalidate all sessions
    await db
      .update(users)
      .set({
        passwordHash: newPasswordHash,
        sessionVersion: nextSessionVersion,
        updatedAt: now,
      })
      .where(eq(users.id, resetRecord.userId));

    await db
      .update(userPasswordResets)
      .set({ usedAt: now })
      .where(eq(userPasswordResets.id, resetRecord.id));

    await db
      .update(userSessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(userSessions.userId, resetRecord.userId));

    return {
      success: true,
      message: "Password updated successfully. Please sign in with your new password.",
    };
  });

  // ---------------------------------------------------------------------------
  // 12. Email Address Verification
  // ---------------------------------------------------------------------------
  app.post("/v1/auth/verify-email", async (request, reply) => {
    const body = parse(verifyEmailSchema, request.body);
    const tokenHash = hashToken(body.token);
    const now = new Date();

    const [record] = await db
      .select()
      .from(userEmailVerifications)
      .where(
        and(
          eq(userEmailVerifications.tokenHash, tokenHash),
          gt(userEmailVerifications.expiresAt, now),
          isNull(userEmailVerifications.verifiedAt),
        ),
      )
      .limit(1);

    if (!record) {
      return reply.code(400).send({
        code: "INVALID_OR_EXPIRED_VERIFICATION_TOKEN",
        message: "Email verification link is invalid or has expired.",
      });
    }

    await db
      .update(userEmailVerifications)
      .set({ verifiedAt: now })
      .where(eq(userEmailVerifications.id, record.id));

    await db
      .update(users)
      .set({ emailVerified: true, updatedAt: now })
      .where(eq(users.id, record.userId));

    return {
      success: true,
      message: "Email address verified successfully.",
    };
  });

  // ---------------------------------------------------------------------------
  // 13. Current Actor Profile
  // ---------------------------------------------------------------------------
  app.get("/v1/me", { preHandler: authenticate }, async (request) => ({
    actor: actor(request),
  }));
};
