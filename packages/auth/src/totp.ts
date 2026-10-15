import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Standard RFC 6238 TOTP Implementation
 * Base32 RFC 4648, HMAC-SHA1 default, 30s step, 6-digit output.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]!;
    if (char === "=") break;
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(lengthBytes = 20): string {
  return base32Encode(randomBytes(lengthBytes));
}

export function generateTotpCode(
  secretBase32: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, "0");
}

export function verifyTotpCode(
  secretBase32: string,
  candidateCode: string,
  options: {
    window?: number;
    timestampMs?: number;
    stepSeconds?: number;
  } = {},
): boolean {
  if (!candidateCode || candidateCode.length !== 6) return false;
  const cleanCode = candidateCode.trim();
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const window = options.window ?? 1;
  const timestamp = options.timestampMs ?? Date.now();
  const step = options.stepSeconds ?? 30;

  for (let w = -window; w <= window; w++) {
    const checkTime = timestamp + w * step * 1000;
    try {
      const expectedCode = generateTotpCode(secretBase32, checkTime, step);
      if (
        timingSafeEqual(
          Buffer.from(cleanCode, "utf8"),
          Buffer.from(expectedCode, "utf8"),
        )
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

export function generateTotpUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? "Skilled Hire";
  const label = encodeURIComponent(`${issuer}:${params.accountName}`);
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(4).toString("hex").toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export function verifyBackupCode(
  candidateCode: string,
  hashedBackupCodes: readonly string[],
): { valid: boolean; remainingHashedCodes: string[] } {
  if (!candidateCode) return { valid: false, remainingHashedCodes: [...hashedBackupCodes] };
  const targetHash = hashBackupCode(candidateCode);

  const matchedIndex = hashedBackupCodes.findIndex((hash) => hash === targetHash);
  if (matchedIndex === -1) {
    return { valid: false, remainingHashedCodes: [...hashedBackupCodes] };
  }

  const remaining = [...hashedBackupCodes];
  remaining.splice(matchedIndex, 1);
  return { valid: true, remainingHashedCodes: remaining };
}
