import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function verifyCsrfToken(cookieToken?: string, headerToken?: string): boolean {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== headerToken.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(cookieToken, "utf8"),
      Buffer.from(headerToken, "utf8"),
    );
  } catch {
    return false;
  }
}
