/**
 * Production Secret Validation & Management
 * Enforces fail-closed semantics for production environment secrets.
 */

export function getJwtSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.JWT_SECRET;
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    if (
      !secret ||
      secret.length < 32 ||
      secret.includes("dev_only") ||
      secret.includes("change_me") ||
      secret.includes("secret123")
    ) {
      throw new Error(
        "FATAL_CONFIG_ERROR: In production, JWT_SECRET must be explicitly configured with at least 32 cryptographically secure characters.",
      );
    }
    return secret;
  }

  return secret ?? "dev_only_jwt_secret_must_be_32_characters_minimum";
}

export function validateProductionSecrets(
  env: Record<string, string | undefined> = process.env,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    const jwtSecret = env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.length < 32) {
      errors.push("JWT_SECRET must be at least 32 characters in production");
    } else if (
      jwtSecret.includes("dev_only") ||
      jwtSecret.includes("change_me") ||
      jwtSecret.includes("secret123")
    ) {
      errors.push("JWT_SECRET cannot use insecure default placeholder in production");
    }

    if (!env.DATABASE_URL) {
      errors.push("DATABASE_URL is required in production");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
