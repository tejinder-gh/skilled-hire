import { describe, expect, it } from "vitest";
import {
  generateStructuredStorageKey,
  isStorageKeyValid,
  generatePresignedUploadTicket,
  verifyPresignedUploadSignature,
  generateSignedDownloadUrl,
  verifySignedDownloadSignature,
  detectMimeFromBuffer,
  validateFileContentMime,
  scanBufferForThreats,
  canActorAccessFile,
} from "./files.js";
import type { Actor, FileAttachmentDTO } from "@marketplace/contracts";

describe("Secure File Evidence Pipeline & Quarantine Engine (SH-04 / #5)", () => {
  const secretKey = "test_cryptographic_secret_minimum_32_characters_long_12345";

  describe("Structured Storage Key Generation & Path Guarding", () => {
    it("generates deterministic year/month multi-tenant scoped keys with sanitization", () => {
      const fixedDate = new Date("2026-10-15T12:00:00Z");
      const key = generateStructuredStorageKey({
        category: "JOB_BEFORE_PHOTO",
        tenantOrUserId: "cont-1234-uuid",
        originalFileName: "furnace_burner_inspection.JPEG",
        now: fixedDate,
      });

      expect(key).toMatch(
        /^evidence\/job_before_photo\/cont-1234-uuid\/2026\/10\/[a-f0-9]{32}\.jpeg$/,
      );
      expect(isStorageKeyValid(key)).toBe(true);
    });

    it("fails validation on arbitrary or directory-traversal storage keys", () => {
      expect(isStorageKeyValid("../etc/passwd")).toBe(false);
      expect(isStorageKeyValid("evidence/../../secret.txt")).toBe(false);
      expect(isStorageKeyValid("/root/uploads/file.png")).toBe(false);
      expect(isStorageKeyValid("arbitrary-bucket-key")).toBe(false);
      expect(isStorageKeyValid("evidence//double-slash/test.png")).toBe(false);
    });
  });

  describe("Presigned Upload Tickets & Cryptographic Signatures", () => {
    it("generates and verifies valid presigned upload tickets", () => {
      const key = "evidence/job_before_photo/user-1/2026/10/0123456789abcdef0123456789abcdef.png";
      const fileId = "fa000000-0000-0000-0000-000000000001";

      const ticket = generatePresignedUploadTicket({
        storageKey: key,
        fileId,
        expiresSeconds: 600,
        secret: secretKey,
        baseUrl: "https://api.skilledhire.ca",
      });

      expect(ticket.uploadUrl).toContain(encodeURIComponent(key));
      expect(ticket.uploadUrl).toContain(fileId);
      expect(ticket.signature).toBeDefined();

      const urlObj = new URL(ticket.uploadUrl);
      const expires = Number(urlObj.searchParams.get("expires"));
      const sig = urlObj.searchParams.get("sig")!;

      const isValid = verifyPresignedUploadSignature({
        storageKey: key,
        fileId,
        expiresTimestamp: expires,
        signature: sig,
        secret: secretKey,
      });
      expect(isValid).toBe(true);
    });

    it("rejects tampered or expired presigned upload signatures", () => {
      const key = "evidence/job_before_photo/user-1/2026/10/0123456789abcdef0123456789abcdef.png";
      const fileId = "fa000000-0000-0000-0000-000000000001";

      const ticket = generatePresignedUploadTicket({
        storageKey: key,
        fileId,
        expiresSeconds: 600,
        secret: secretKey,
      });

      const urlObj = new URL(`http://localhost${ticket.uploadUrl}`);
      const expires = Number(urlObj.searchParams.get("expires"));

      // Tampered signature
      expect(
        verifyPresignedUploadSignature({
          storageKey: key,
          fileId,
          expiresTimestamp: expires,
          signature: "tampered_signature_00000000000000000000000000000000",
          secret: secretKey,
        }),
      ).toBe(false);

      // Expired timestamp
      expect(
        verifyPresignedUploadSignature({
          storageKey: key,
          fileId,
          expiresTimestamp: Date.now() - 1000,
          signature: urlObj.searchParams.get("sig")!,
          secret: secretKey,
        }),
      ).toBe(false);
    });
  });

  describe("Signed Download URLs", () => {
    it("generates and validates signed download leases", () => {
      const key = "evidence/job_before_photo/user-1/2026/10/0123456789abcdef0123456789abcdef.png";
      const fileId = "fa000000-0000-0000-0000-000000000001";

      const signed = generateSignedDownloadUrl({
        storageKey: key,
        fileId,
        expiresSeconds: 300,
        secret: secretKey,
      });

      const urlObj = new URL(`http://localhost${signed.downloadUrl}`);
      const expires = Number(urlObj.searchParams.get("expires"));
      const sig = urlObj.searchParams.get("sig")!;

      expect(
        verifySignedDownloadSignature({
          storageKey: key,
          fileId,
          expiresTimestamp: expires,
          signature: sig,
          secret: secretKey,
        }),
      ).toBe(true);
    });
  });

  describe("MIME Magic Bytes Detection & Anti-Spoofing", () => {
    it("detects genuine JPEG, PNG, and PDF magic bytes correctly", () => {
      const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(detectMimeFromBuffer(jpegBuf)).toBe("image/jpeg");

      const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectMimeFromBuffer(pngBuf)).toBe("image/png");

      const pdfBuf = Buffer.from("%PDF-1.7 standard document content", "utf8");
      expect(detectMimeFromBuffer(pdfBuf)).toBe("application/pdf");
    });

    it("rejects file extension or declared MIME spoofing attacks", () => {
      // Attacker declares image/jpeg but uploads a PDF
      const pdfBuf = Buffer.from("%PDF-1.7 disguised as jpg", "utf8");
      const check = validateFileContentMime("image/jpeg", pdfBuf);
      expect(check.valid).toBe(false);
      expect(check.detectedMime).toBe("application/pdf");
      expect(check.error).toContain("MIME type spoofing detected");
    });
  });

  describe("Malware & Heuristic Threat Scanner", () => {
    it("passes clean binary image buffers without threats", () => {
      const cleanImage = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      ]);
      const result = scanBufferForThreats(cleanImage, "heat_exchanger.jpg");
      expect(result.clean).toBe(true);
    });

    it("quarantines EICAR antivirus test signatures", () => {
      const eicarBuffer = Buffer.from(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      );
      const result = scanBufferForThreats(eicarBuffer, "invoice.pdf");
      expect(result.clean).toBe(false);
      expect(result.threatName).toBe("EICAR.StandardAntivirusTestFile");
    });

    it("quarantines Windows PE executables disguised as images", () => {
      const peBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // MZ header
      const result = scanBufferForThreats(peBuffer, "system_check.png");
      expect(result.clean).toBe(false);
      expect(result.threatName).toBe("Win32.Executable.MZ");
    });

    it("quarantines double-extension executable trap filenames", () => {
      const benignBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const result = scanBufferForThreats(benignBuffer, "work_order.pdf.exe");
      expect(result.clean).toBe(false);
      expect(result.threatName).toBe("DoubleExtensionExecutableTrap");
    });

    it("quarantines embedded executable scripts inside document payloads", () => {
      const scriptPayload = Buffer.from("<script>alert('xss exploit')</script>", "utf8");
      const result = scanBufferForThreats(scriptPayload, "customer_note.pdf");
      expect(result.clean).toBe(false);
      expect(result.threatName).toBe("Exploit.EmbeddedScript");
    });
  });

  describe("Object-Level Authorization & Quarantine Lockdown", () => {
    const customerActor: Actor = {
      id: "cust-1",
      roles: ["CUSTOMER"],
    };
    const otherCustomerActor: Actor = {
      id: "cust-2",
      roles: ["CUSTOMER"],
    };
    const contractorActor: Actor = {
      id: "contractor-user-1",
      contractorId: "cont-1",
      roles: ["CONTRACTOR_OWNER"],
    };
    const otherContractorActor: Actor = {
      id: "contractor-user-2",
      contractorId: "cont-2",
      roles: ["CONTRACTOR_OWNER"],
    };
    const staffActor: Actor = {
      id: "staff-1",
      roles: ["OPERATIONS_AGENT"],
    };

    const mockCleanFile: Pick<
      FileAttachmentDTO,
      "ownerUserId" | "contractorId" | "customerId" | "visibility" | "scanStatus"
    > = {
      ownerUserId: "cust-1",
      customerId: "cust-1",
      contractorId: "cont-1",
      visibility: "SHARED",
      scanStatus: "CLEAN",
    };

    it("allows file owner, assigned contractor, and staff operators to read clean files", () => {
      expect(canActorAccessFile(customerActor, mockCleanFile)).toBe(true);
      expect(canActorAccessFile(contractorActor, mockCleanFile)).toBe(true);
      expect(canActorAccessFile(staffActor, mockCleanFile)).toBe(true);
    });

    it("denies cross-customer and cross-contractor tenant access fail-closed", () => {
      expect(canActorAccessFile(otherCustomerActor, mockCleanFile)).toBe(false);
      expect(canActorAccessFile(otherContractorActor, mockCleanFile)).toBe(false);
    });

    it("locks quarantined files strictly from regular users while allowing staff inspection", () => {
      const quarantinedFile: Pick<
        FileAttachmentDTO,
        "ownerUserId" | "contractorId" | "customerId" | "visibility" | "scanStatus"
      > = {
        ...mockCleanFile,
        scanStatus: "QUARANTINED",
      };

      // Regular customer or contractor CANNOT access quarantined files
      expect(canActorAccessFile(customerActor, quarantinedFile)).toBe(false);
      expect(canActorAccessFile(contractorActor, quarantinedFile)).toBe(false);

      // Staff operator CAN inspect for investigation and audit
      expect(canActorAccessFile(staffActor, quarantinedFile)).toBe(true);
    });
  });
});
