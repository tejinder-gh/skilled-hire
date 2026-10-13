// packages/vertical-engine/src/job-completion.test.ts

import { describe, it, expect } from "vitest";
import { validateCompletionReport } from "./job-completion.js";
import {
  filterPassportServiceHistory,
  generateOwnershipTransferToken,
} from "./property-passport.js";
import type { PassportServiceHistoryItem } from "@marketplace/contracts";

describe("Job Completion Reports & Property Service Passport (#50, #51)", () => {
  it("passes validation when all completion report requirements are fulfilled", () => {
    const res = validateCompletionReport({
      workSummary: "Replaced dual run capacitor and cleaned blower fan assembly.",
      diagnosis: "Capacitor failed under load causing AC blower motor startup failure.",
      workStartedAt: "2026-10-12T14:00:00Z",
      workCompletedAt: "2026-10-12T16:30:00Z",
      beforePhotos: [
        { url: "https://photos.test/before.jpg", phase: "BEFORE" },
      ],
      afterPhotos: [
        { url: "https://photos.test/after.jpg", phase: "AFTER" },
      ],
      testsPerformed: [
        {
          testName: "Capacitor microfarad rating",
          result: "PASS",
          measuredValue: "44.9",
          unit: "uF",
        },
      ],
      contractorAttestation: {
        attested: true,
        technicianName: "Alex Technician",
      },
    });

    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.requiredTestsPassed).toBe(true);
    expect(res.attestationComplete).toBe(true);
  });

  it("fails validation when work summary or diagnosis is too short", () => {
    const res = validateCompletionReport({
      workSummary: "Fix",
      diagnosis: "Bad",
      workStartedAt: "2026-10-12T14:00:00Z",
      workCompletedAt: "2026-10-12T15:00:00Z",
      beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
      afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
      contractorAttestation: {
        attested: true,
        technicianName: "Alex",
      },
    });

    expect(res.valid).toBe(false);
    expect(res.errors).toContain("Work summary must be at least 5 characters");
    expect(res.errors).toContain("Diagnosis must be at least 5 characters");
  });

  it("fails validation when work start time is after completion time", () => {
    const res = validateCompletionReport({
      workSummary: "Valid work summary description here",
      diagnosis: "Valid diagnosis explanation here",
      workStartedAt: "2026-10-12T17:00:00Z",
      workCompletedAt: "2026-10-12T15:00:00Z",
      beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
      afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
      contractorAttestation: {
        attested: true,
        technicianName: "Alex",
      },
    });

    expect(res.valid).toBe(false);
    expect(res.errors).toContain(
      "Work start timestamp must precede completion timestamp",
    );
  });

  it("fails validation when before or after photos are missing", () => {
    const res = validateCompletionReport({
      workSummary: "Valid work summary description here",
      diagnosis: "Valid diagnosis explanation here",
      workStartedAt: "2026-10-12T14:00:00Z",
      workCompletedAt: "2026-10-12T15:00:00Z",
      beforePhotos: [],
      afterPhotos: [],
      contractorAttestation: {
        attested: true,
        technicianName: "Alex",
      },
    });

    expect(res.valid).toBe(false);
    expect(res.errors).toContain(
      "At least 1 before-work evidence photo is required",
    );
    expect(res.errors).toContain(
      "At least 1 after-work evidence photo is required",
    );
  });

  it("fails validation when tests have failure without documented outstanding issues", () => {
    const res = validateCompletionReport({
      workSummary: "Valid work summary description here",
      diagnosis: "Valid diagnosis explanation here",
      workStartedAt: "2026-10-12T14:00:00Z",
      workCompletedAt: "2026-10-12T15:00:00Z",
      beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
      afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
      testsPerformed: [
        {
          testName: "Static pressure test",
          result: "FAIL",
          notes: "High resistance",
        },
      ],
      outstandingIssues: [],
      contractorAttestation: {
        attested: true,
        technicianName: "Alex",
      },
    });

    expect(res.valid).toBe(false);
    expect(res.requiredTestsPassed).toBe(false);
    expect(
      res.errors.some((e) => e.includes("Failed safety or diagnostic test(s)")),
    ).toBe(true);
  });

  it("allows test failures if documented in outstanding issues with warning", () => {
    const res = validateCompletionReport({
      workSummary: "Valid work summary description here",
      diagnosis: "Valid diagnosis explanation here",
      workStartedAt: "2026-10-12T14:00:00Z",
      workCompletedAt: "2026-10-12T15:00:00Z",
      beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
      afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
      testsPerformed: [
        {
          testName: "Duct leakage test",
          result: "FAIL",
        },
      ],
      outstandingIssues: [
        {
          description: "Minor duct seam leak in crawlspace",
          severity: "LOW",
          actionRequired: "Mastic tape sealing recommended on next maintenance",
        },
      ],
      contractorAttestation: {
        attested: true,
        technicianName: "Alex",
      },
    });

    expect(res.valid).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.requiredTestsPassed).toBe(false);
  });

  it("enforces permit verification for regulated trade work", () => {
    const res = validateCompletionReport({
      workSummary: "Panel upgrade from 100A to 200A service.",
      diagnosis: "Service capacity upgrade requested.",
      workStartedAt: "2026-10-12T09:00:00Z",
      workCompletedAt: "2026-10-12T16:00:00Z",
      beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
      afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
      isElectricalOrRegulated: true,
      permitId: undefined,
      contractorAttestation: {
        attested: true,
        technicianName: "Alex Electrician",
      },
    });

    expect(res.valid).toBe(false);
    expect(res.permitRequired).toBe(true);
    expect(res.errors).toContain(
      "Regulated trade job requires verified regulatory permit",
    );
  });

  it("enforces contractor attestation", () => {
    const res = validateCompletionReport({
      workSummary: "Valid work summary description here",
      diagnosis: "Valid diagnosis explanation here",
      workStartedAt: "2026-10-12T14:00:00Z",
      workCompletedAt: "2026-10-12T15:00:00Z",
      beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
      afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
      contractorAttestation: {
        attested: false,
      },
    });

    expect(res.valid).toBe(false);
    expect(res.attestationComplete).toBe(false);
    expect(res.errors).toContain(
      "Contractor attestation and technician name are required",
    );
  });

  it("filters passport service history: owner sees unredacted, third-party sees commercial cost redacted", () => {
    const history: PassportServiceHistoryItem[] = [
      {
        serviceRecordId: "rec-1",
        jobId: "job-1",
        completedAt: "2026-10-01T12:00:00Z",
        vertical: "hvac",
        summary: "Furnace burner cleaning",
        costRedacted: false,
      },
      {
        serviceRecordId: "rec-2",
        jobId: "job-2",
        completedAt: "2026-10-05T12:00:00Z",
        vertical: "electrical",
        summary: "EV Charger circuit installation",
        costRedacted: false,
      },
    ];

    const ownerView = filterPassportServiceHistory({
      history,
      scope: "FULL_HISTORY",
      isOwner: true,
    });
    expect(ownerView[0]?.costRedacted).toBe(false);
    expect(ownerView[1]?.costRedacted).toBe(false);

    const contractorView = filterPassportServiceHistory({
      history,
      scope: "REDACTED_COMMERCIAL",
      isOwner: false,
    });
    expect(contractorView[0]?.costRedacted).toBe(true);
    expect(contractorView[1]?.costRedacted).toBe(true);

    const serviceSpecificView = filterPassportServiceHistory({
      history,
      scope: "SERVICE_SPECIFIC",
      isOwner: false,
      serviceVerticalId: "hvac",
    });
    expect(serviceSpecificView).toHaveLength(1);
    expect(serviceSpecificView[0]?.vertical).toBe("hvac");
    expect(serviceSpecificView[0]?.costRedacted).toBe(true);
  });

  it("generates crypto-secure ownership transfer token", () => {
    const token1 = generateOwnershipTransferToken();
    const token2 = generateOwnershipTransferToken();

    expect(token1.startsWith("TRF-")).toBe(true);
    expect(token2.startsWith("TRF-")).toBe(true);
    expect(token1).not.toBe(token2);
    expect(token1.length).toBeGreaterThan(20);
  });
});
