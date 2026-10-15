import { describe, expect, it } from "vitest";
import type { Actor } from "@marketplace/contracts";
import {
  hashPassword,
  verifyPassword,
  getJwtSecret,
  validateProductionSecrets,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  generateSecureToken,
  hashToken,
  generateCsrfToken,
  verifyCsrfToken,
  formatCookie,
  formatClearCookie,
  parseCookies,
  isStaff,
  assertRole,
  assertTenantAccess,
  assertCustomerAccess,
  assertResourceAccess,
} from "./index.js";

describe("Production Identity & Auth Package", () => {
  describe("password hashing & validation", () => {
    it("hashes and verifies correct passwords", async () => {
      const hash = await hashPassword("safe-password-123");
      expect(hash.startsWith("scrypt$")).toBe(true);
      await expect(verifyPassword("safe-password-123", hash)).resolves.toBe(true);
      await expect(verifyPassword("incorrect-password", hash)).resolves.toBe(false);
    });

    it("rejects passwords under 12 characters", async () => {
      await expect(hashPassword("short-123")).rejects.toThrow(
        "Password must be at least 12 characters",
      );
    });
  });

  describe("production secrets fail-closed enforcement", () => {
    it("fails closed in production if JWT_SECRET is missing", () => {
      expect(() =>
        getJwtSecret({ NODE_ENV: "production", JWT_SECRET: undefined }),
      ).toThrow("FATAL_CONFIG_ERROR");
    });

    it("fails closed in production if JWT_SECRET is shorter than 32 characters", () => {
      expect(() =>
        getJwtSecret({ NODE_ENV: "production", JWT_SECRET: "short_secret_key" }),
      ).toThrow("FATAL_CONFIG_ERROR");
    });

    it("fails closed in production if JWT_SECRET contains dev placeholder strings", () => {
      expect(() =>
        getJwtSecret({
          NODE_ENV: "production",
          JWT_SECRET: "dev_only_jwt_secret_must_be_32_characters_minimum",
        }),
      ).toThrow("FATAL_CONFIG_ERROR");
    });

    it("succeeds in production when cryptographically strong secret is provided", () => {
      const strongSecret = "prod_k9f8d7s6a5b4c3e2w1q0z9x8y7u6i5o4";
      expect(getJwtSecret({ NODE_ENV: "production", JWT_SECRET: strongSecret })).toBe(
        strongSecret,
      );
    });

    it("allows dev fallback in non-production environments", () => {
      expect(getJwtSecret({ NODE_ENV: "development", JWT_SECRET: undefined })).toBe(
        "dev_only_jwt_secret_must_be_32_characters_minimum",
      );
    });

    it("reports all production secret errors cleanly via validateProductionSecrets", () => {
      const result = validateProductionSecrets({
        NODE_ENV: "production",
        JWT_SECRET: "dev_only_short",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("RFC 6238 TOTP engine & backup recovery codes", () => {
    it("generates valid Base32 secret and reproducible OTP codes", () => {
      const secret = generateTotpSecret(20);
      expect(secret.length).toBeGreaterThanOrEqual(32);
      expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);

      const fixedWindowTime = 1700000010000; // 10s into window
      const code1 = generateTotpCode(secret, fixedWindowTime, 30);
      expect(code1).toMatch(/^\d{6}$/);

      // Same 30s window produces identical code
      const code2 = generateTotpCode(secret, fixedWindowTime + 1000, 30);
      expect(code2).toBe(code1);
    });

    it("verifies TOTP code within clock skew window", () => {
      const secret = generateTotpSecret(20);
      const now = 1700000000000;
      const currentCode = generateTotpCode(secret, now);

      expect(verifyTotpCode(secret, currentCode, { timestampMs: now })).toBe(true);

      // Verify code from 30 seconds ago within default window (+/- 1 step)
      const prevCode = generateTotpCode(secret, now - 30000);
      expect(verifyTotpCode(secret, prevCode, { timestampMs: now, window: 1 })).toBe(true);

      // Code from 3 minutes ago should be rejected
      const staleCode = generateTotpCode(secret, now - 180000);
      expect(verifyTotpCode(secret, staleCode, { timestampMs: now, window: 1 })).toBe(false);
    });

    it("generates and verifies single-use backup recovery codes", () => {
      const backupCodes = generateBackupCodes(8);
      expect(backupCodes).toHaveLength(8);
      expect(backupCodes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      const hashedCodes = backupCodes.map(hashBackupCode);

      // Verify the first code works and is consumed
      const targetCode = backupCodes[0]!;
      const result = verifyBackupCode(targetCode, hashedCodes);
      expect(result.valid).toBe(true);
      expect(result.remainingHashedCodes).toHaveLength(7);
      expect(result.remainingHashedCodes).not.toContain(hashBackupCode(targetCode));

      // Attempting to reuse the consumed code fails
      const reuseResult = verifyBackupCode(targetCode, result.remainingHashedCodes);
      expect(reuseResult.valid).toBe(false);
    });
  });

  describe("cryptographic tokens & CSRF protection", () => {
    it("generates cryptographically secure tokens and deterministic SHA-256 hashes", () => {
      const token1 = generateSecureToken(32);
      const token2 = generateSecureToken(32);
      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64); // 32 bytes in hex

      const hash1 = hashToken(token1);
      const hash1Again = hashToken(token1);
      expect(hash1).toBe(hash1Again);
      expect(hash1).not.toBe(hashToken(token2));
    });

    it("verifies CSRF double-submit token match and timing-safe equality", () => {
      const csrf = generateCsrfToken();
      expect(verifyCsrfToken(csrf, csrf)).toBe(true);
      expect(verifyCsrfToken(csrf, "tampered-csrf-token")).toBe(false);
      expect(verifyCsrfToken(undefined, csrf)).toBe(false);
    });
  });

  describe("secure cookie formatting and parsing", () => {
    it("formats secure httpOnly cookies with sensible defaults", () => {
      const cookie = formatCookie("sh_session", "session-token-123", {
        maxAgeSeconds: 86400,
        sameSite: "strict",
      });
      expect(cookie).toContain("sh_session=session-token-123");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=86400");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
    });

    it("formats clear cookie with Max-Age=0", () => {
      const clear = formatClearCookie("sh_session");
      expect(clear).toContain("sh_session=");
      expect(clear).toContain("Max-Age=0");
    });

    it("parses incoming cookie headers accurately", () => {
      const header = "sh_access=xyz123; sh_csrf=abc789; other=value";
      const parsed = parseCookies(header);
      expect(parsed["sh_access"]).toBe("xyz123");
      expect(parsed["sh_csrf"]).toBe("abc789");
      expect(parsed["other"]).toBe("value");
    });
  });

  describe("RBAC & cross-tenant / cross-customer authorization guards", () => {
    const contractorActor: Actor = {
      id: "user-tech-1",
      roles: ["TECHNICIAN"],
      contractorId: "contractor-alpha",
    };

    const customerActor: Actor = {
      id: "user-cust-1",
      roles: ["CUSTOMER"],
    };

    const staffActor: Actor = {
      id: "user-ops-1",
      roles: ["OPERATIONS_AGENT"],
    };

    it("correctly identifies staff roles", () => {
      expect(isStaff(staffActor)).toBe(true);
      expect(isStaff(contractorActor)).toBe(false);
      expect(isStaff(customerActor)).toBe(false);
    });

    it("allows contractor access to own tenant and denies cross-tenant access", () => {
      // Same tenant succeeds
      expect(() =>
        assertTenantAccess(contractorActor, "contractor-alpha"),
      ).not.toThrow();

      // Cross tenant fails closed
      expect(() =>
        assertTenantAccess(contractorActor, "contractor-bravo"),
      ).toThrow("Cross-tenant isolation violation");
    });

    it("allows staff access to any contractor tenant", () => {
      expect(() =>
        assertTenantAccess(staffActor, "contractor-bravo"),
      ).not.toThrow();
    });

    it("allows customer access to own resources and denies cross-customer access", () => {
      expect(() =>
        assertCustomerAccess(customerActor, "user-cust-1"),
      ).not.toThrow();

      expect(() =>
        assertCustomerAccess(customerActor, "user-cust-2"),
      ).toThrow("Cross-customer isolation violation");
    });

    it("allows staff access to any customer resource", () => {
      expect(() =>
        assertCustomerAccess(staffActor, "user-cust-2"),
      ).not.toThrow();
    });

    it("enforces role permissions with assertRole", () => {
      expect(() =>
        assertRole(staffActor, "OPERATIONS_AGENT", "ADMIN"),
      ).not.toThrow();

      expect(() =>
        assertRole(customerActor, "ADMIN"),
      ).toThrow("FORBIDDEN: Requires one of [ADMIN]");
    });

    it("validates composite resource access via assertResourceAccess", () => {
      expect(() =>
        assertResourceAccess(contractorActor, {
          contractorId: "contractor-alpha",
        }),
      ).not.toThrow();

      expect(() =>
        assertResourceAccess(contractorActor, {
          contractorId: "contractor-beta",
        }),
      ).toThrow("Cross-tenant isolation violation");

      expect(() =>
        assertResourceAccess(customerActor, {
          ownerId: "user-cust-1",
        }),
      ).not.toThrow();

      expect(() =>
        assertResourceAccess(customerActor, {
          ownerId: "user-cust-2",
        }),
      ).toThrow("You do not own this resource");
    });
  });
});
