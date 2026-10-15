import { db, eq, sql, authRateLimits } from "@marketplace/database";

export interface RateLimitResult {
  allowed: boolean;
  attempts: number;
  retryAfterSeconds?: number;
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 5,
): Promise<RateLimitResult> {
  const [record] = await db
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, key))
    .limit(1);

  if (!record) {
    return { allowed: true, attempts: 0 };
  }

  const now = new Date();
  if (record.lockedUntil && record.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil(
      (record.lockedUntil.getTime() - now.getTime()) / 1000,
    );
    return {
      allowed: false,
      attempts: record.attempts,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  return { allowed: true, attempts: record.attempts };
}

export async function recordFailedAttempt(
  key: string,
  maxAttempts = 5,
  lockMinutes = 15,
): Promise<{ locked: boolean; attempts: number; retryAfterSeconds?: number }> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, key))
    .limit(1);

  if (!existing) {
    await db.insert(authRateLimits).values({
      key,
      attempts: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
      updatedAt: now,
    });
    return { locked: false, attempts: 1 };
  }

  // If previous lock has expired, reset counter
  const isReset = existing.lockedUntil && existing.lockedUntil <= now;
  const newAttempts = isReset ? 1 : existing.attempts + 1;
  const shouldLock = newAttempts >= maxAttempts;
  const lockExpiresAt = shouldLock
    ? new Date(now.getTime() + lockMinutes * 60 * 1000)
    : null;

  await db
    .update(authRateLimits)
    .set({
      attempts: newAttempts,
      lockedUntil: lockExpiresAt,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .where(eq(authRateLimits.key, key));

  if (shouldLock) {
    return {
      locked: true,
      attempts: newAttempts,
      retryAfterSeconds: lockMinutes * 60,
    };
  }

  return { locked: false, attempts: newAttempts };
}

export async function clearRateLimit(key: string): Promise<void> {
  await db.delete(authRateLimits).where(eq(authRateLimits.key, key));
}
