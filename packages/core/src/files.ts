import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Actor } from "@marketplace/contracts";
import type { FileAttachmentDTO, FileCategory } from "@marketplace/contracts";

const STAFF_ROLE_NAMES = [
  "OPERATIONS_AGENT",
  "DISPATCHER",
  "SUPPORT_AGENT",
  "QUOTE_REVIEWER",
  "ADMIN",
  "SUPER_ADMIN",
];

function isStaffUser(actor: Actor): boolean {
  return actor.roles.some((role) => STAFF_ROLE_NAMES.includes(role));
}

const STORAGE_KEY_REGEX =
  /^evidence\/[a-z0-9_-]+\/[a-z0-9_-]+\/\d{4}\/\d{2}\/[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

// Standard EICAR Antivirus Test Signature
const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const DANGEROUS_EXTENSIONS = [
  "exe",
  "bat",
  "cmd",
  "sh",
  "bin",
  "vbs",
  "ps1",
  "jar",
  "msi",
  "dll",
  "so",
  "dylib",
  "com",
  "scr",
  "pif",
];

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export function extractFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2) return "bin";
  return parts.pop() ?? "bin";
}

/**
 * Generates an immutable, non-guessable, multi-tenant scoped storage key.
 * Format: evidence/{category}/{tenantOrUserId}/{yyyy}/{mm}/{randomUuid}.{ext}
 */
export function generateStructuredStorageKey(options: {
  category: FileCategory;
  tenantOrUserId: string;
  originalFileName: string;
  now?: Date;
}): string {
  const now = options.now ?? new Date();
  const year = now.getUTCFullYear().toString();
  const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const ext = extractFileExtension(options.originalFileName);
  const randomHex = randomBytes(16).toString("hex");
  const safeCategory = options.category.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const safeScope = options.tenantOrUserId.toLowerCase().replace(/[^a-z0-9-]/g, "_");

  return `evidence/${safeCategory}/${safeScope}/${year}/${month}/${randomHex}.${ext}`;
}

export function isStorageKeyValid(storageKey: string): boolean {
  if (!storageKey || storageKey.length > 255) return false;
  if (storageKey.includes("..") || storageKey.includes("//")) return false;
  return STORAGE_KEY_REGEX.test(storageKey);
}

/**
 * Presigned URL Ticket Generation & Cryptographic Verification
 */
export function generatePresignedUploadTicket(options: {
  storageKey: string;
  fileId: string;
  expiresSeconds?: number;
  secret: string;
  baseUrl?: string;
}): { uploadUrl: string; expiresAt: string; signature: string } {
  const ttl = options.expiresSeconds ?? 900; // 15 mins default
  const expiresAtMs = Date.now() + ttl * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  const payload = `PUT|${options.storageKey}|${options.fileId}|${expiresAtMs}`;
  const signature = createHmac("sha256", options.secret)
    .update(payload)
    .digest("hex");

  const baseUrl = options.baseUrl ?? "";
  const uploadUrl = `${baseUrl}/v1/files/raw/${encodeURIComponent(
    options.storageKey,
  )}?fileId=${encodeURIComponent(options.fileId)}&expires=${expiresAtMs}&sig=${signature}`;

  return {
    uploadUrl,
    expiresAt: expiresAtIso,
    signature,
  };
}

export function verifyPresignedUploadSignature(options: {
  storageKey: string;
  fileId: string;
  expiresTimestamp: number;
  signature: string;
  secret: string;
}): boolean {
  if (Date.now() > options.expiresTimestamp) {
    return false; // Expired
  }

  const payload = `PUT|${options.storageKey}|${options.fileId}|${options.expiresTimestamp}`;
  const expectedSignature = createHmac("sha256", options.secret)
    .update(payload)
    .digest("hex");

  if (expectedSignature.length !== options.signature.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(expectedSignature, "utf8"),
      Buffer.from(options.signature, "utf8"),
    );
  } catch {
    return false;
  }
}

/**
 * Signed Download URL Generation & Verification
 */
export function generateSignedDownloadUrl(options: {
  storageKey: string;
  fileId: string;
  expiresSeconds?: number;
  secret: string;
  baseUrl?: string;
}): { downloadUrl: string; expiresAt: string } {
  const ttl = options.expiresSeconds ?? 900; // 15 mins
  const expiresAtMs = Date.now() + ttl * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  const payload = `GET|${options.storageKey}|${options.fileId}|${expiresAtMs}`;
  const signature = createHmac("sha256", options.secret)
    .update(payload)
    .digest("hex");

  const baseUrl = options.baseUrl ?? "";
  const downloadUrl = `${baseUrl}/v1/files/raw/${encodeURIComponent(
    options.storageKey,
  )}?fileId=${encodeURIComponent(options.fileId)}&expires=${expiresAtMs}&sig=${signature}`;

  return {
    downloadUrl,
    expiresAt: expiresAtIso,
  };
}

export function verifySignedDownloadSignature(options: {
  storageKey: string;
  fileId: string;
  expiresTimestamp: number;
  signature: string;
  secret: string;
}): boolean {
  if (Date.now() > options.expiresTimestamp) {
    return false;
  }

  const payload = `GET|${options.storageKey}|${options.fileId}|${options.expiresTimestamp}`;
  const expectedSignature = createHmac("sha256", options.secret)
    .update(payload)
    .digest("hex");

  if (expectedSignature.length !== options.signature.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(expectedSignature, "utf8"),
      Buffer.from(options.signature, "utf8"),
    );
  } catch {
    return false;
  }
}

/**
 * True Magic Bytes Header Inspection for MIME Verification
 */
export function detectMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // PDF: %PDF-
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return "application/pdf";
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  // HEIC / HEIF: ftypheic / ftypmif1
  if (buffer.length >= 12) {
    const ftyp = buffer.toString("utf8", 4, 12);
    if (
      ftyp.includes("heic") ||
      ftyp.includes("mif1") ||
      ftyp.includes("msf1") ||
      ftyp.includes("heix")
    ) {
      return "image/heic";
    }
  }

  return null;
}

export function validateFileContentMime(
  declaredMime: string,
  buffer: Buffer,
): { valid: boolean; detectedMime: string | null; error?: string } {
  const detected = detectMimeFromBuffer(buffer);
  if (!detected) {
    return {
      valid: false,
      detectedMime: null,
      error: "Unable to detect valid file signature from binary content",
    };
  }

  if (declaredMime === "image/heif" && detected === "image/heic") {
    return { valid: true, detectedMime: detected };
  }

  if (declaredMime !== detected) {
    return {
      valid: false,
      detectedMime: detected,
      error: `MIME type spoofing detected: header declared '${declaredMime}' but binary magic bytes match '${detected}'`,
    };
  }

  return { valid: true, detectedMime: detected };
}

/**
 * Antivirus & Heuristic Malware Scanner
 */
export function scanBufferForThreats(
  buffer: Buffer,
  fileName: string,
): { clean: boolean; threatName?: string; reason?: string } {
  // 1. Double extension attack check (e.g. invoice.pdf.exe)
  const nameParts = fileName.toLowerCase().split(".");
  if (nameParts.length > 2) {
    for (let i = 1; i < nameParts.length; i++) {
      const part = nameParts[i]!;
      if (DANGEROUS_EXTENSIONS.includes(part)) {
        return {
          clean: false,
          threatName: "DoubleExtensionExecutableTrap",
          reason: `Dangerous executable extension '.${part}' found in multi-part filename '${fileName}'`,
        };
      }
    }
  }

  // 2. Windows PE Executable (MZ header)
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return {
      clean: false,
      threatName: "Win32.Executable.MZ",
      reason: "Windows PE executable binary signature detected",
    };
  }

  // 3. Linux ELF binary (\x7fELF)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return {
      clean: false,
      threatName: "Unix.Executable.ELF",
      reason: "Unix ELF executable binary signature detected",
    };
  }

  // 4. macOS Mach-O binary
  if (buffer.length >= 4) {
    const magic = buffer.readUInt32BE(0);
    if (
      magic === 0xfeedface ||
      magic === 0xfeedfacf ||
      magic === 0xcefaedfe ||
      magic === 0xcffaedfe
    ) {
      return {
        clean: false,
        threatName: "MachO.Executable",
        reason: "macOS Mach-O executable binary signature detected",
      };
    }
  }

  // 5. EICAR Antivirus Test Signature
  const contentStr = buffer.toString("utf8");
  if (contentStr.includes(EICAR_SIGNATURE)) {
    return {
      clean: false,
      threatName: "EICAR.StandardAntivirusTestFile",
      reason: "Standard EICAR test virus pattern detected",
    };
  }

  // 6. Dangerous Active Script Elements in Photos/Documents
  const lowerContent = contentStr.toLowerCase();
  if (
    lowerContent.includes("<script") ||
    lowerContent.includes("javascript:") ||
    lowerContent.includes("onload=") ||
    lowerContent.includes("onerror=") ||
    lowerContent.includes("<?php")
  ) {
    return {
      clean: false,
      threatName: "Exploit.EmbeddedScript",
      reason: "Active script or HTML executable tag detected in evidence file payload",
    };
  }

  return { clean: true };
}

/**
 * Object-Level File Authorization Guard
 */
export function canActorAccessFile(
  actor: Actor,
  file: Pick<
    FileAttachmentDTO,
    | "ownerUserId"
    | "contractorId"
    | "customerId"
    | "visibility"
    | "scanStatus"
  >,
): boolean {
  const staff = isStaffUser(actor);

  // If quarantined, ONLY staff operators can inspect
  if (file.scanStatus === "QUARANTINED" || file.scanStatus === "REJECTED") {
    return staff;
  }

  if (staff) {
    return true;
  }

  // Direct Owner Access
  if (actor.id === file.ownerUserId) {
    return true;
  }

  // Customer Access
  if (actor.roles.includes("CUSTOMER")) {
    if (file.visibility === "PRIVATE" && file.ownerUserId !== actor.id) {
      return false;
    }
    if (file.customerId && file.customerId === actor.id) {
      return true;
    }
  }

  // Contractor Access
  if (actor.contractorId && file.contractorId) {
    if (actor.contractorId === file.contractorId) {
      return true;
    }
  }

  // Shared file associated with customer
  if (file.visibility === "SHARED" && file.customerId === actor.id) {
    return true;
  }

  return false;
}
