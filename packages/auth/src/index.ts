import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Actor, Role } from "@marketplace/contracts";
const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Password must be at least 12 characters");
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, hash] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(derived, Buffer.from(hash, "hex"));
}
export function requireRole(actor: Actor, ...allowed: readonly Role[]): void {
  if (!actor.roles.some((role) => allowed.includes(role))) throw new Error("FORBIDDEN");
}
export function hasRole(actor: Actor, ...allowed: readonly Role[]): boolean { return actor.roles.some((role) => allowed.includes(role)); }
