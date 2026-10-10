import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./index.js";
describe("password hashing", () => it("verifies correct passwords", async () => {
  const hash = await hashPassword("safe-password-123");
  await expect(verifyPassword("safe-password-123", hash)).resolves.toBe(true);
  await expect(verifyPassword("incorrect-password", hash)).resolves.toBe(false);
}));
