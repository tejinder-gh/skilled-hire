// packages/vertical-engine/src/risk-documentation.test.ts

import { describe, expect, it } from "vitest";
import {
  calculateQaMetrics,
  evaluateJobDocumentationGate,
  evaluateQaSamplingEligibility,
} from "./risk-documentation.js";
import type { JobDocumentationPackage } from "@marketplace/contracts";

describe("Risk-Based Job Documentation & Inspection Gates (#63)", () => {
  describe("evaluateJobDocumentationGate", () => {
    it("evaluates a LOW risk job and passes with single after photo", () => {
      const res = evaluateJobDocumentationGate({
        riskTier: "LOW",
        afterPhotos: [{ url: "https://photos.test/after1.jpg", phase: "AFTER" }],
      });

      expect(res.passed).toBe(true);
      expect(res.status).toBe("VERIFIED_COMPLIANT");
      expect(res.missingRequirements).toHaveLength(0);
      expect(res.qaAuditRequired).toBe(false);
      expect(res.incidentEscalationRequired).toBe(false);
    });

    it("fails LOW risk job when missing after photo", () => {
      const res = evaluateJobDocumentationGate({
        riskTier: "LOW",
        afterPhotos: [],
      });

      expect(res.passed).toBe(false);
      expect(res.status).toBe("IN_PROGRESS");
      expect(res.missingRequirements).toContain("MISSING_AFTER_PHOTO");
    });

    it("enforces MODERATE risk requirements (before, after, worker identity, checklist, customer sign-off)", () => {
      // Incomplete
      const incomplete = evaluateJobDocumentationGate({
        riskTier: "MODERATE",
        beforePhotos: [{ url: "https://photos.test/before.jpg", phase: "BEFORE" }],
      });
      expect(incomplete.passed).toBe(false);
      expect(incomplete.missingRequirements).toEqual(
        expect.arrayContaining([
          "MISSING_AFTER_PHOTO",
          "UNVERIFIED_WORKER_IDENTITY",
          "INCOMPLETE_RISK_CHECKLIST",
          "MISSING_CUSTOMER_SIGNOFF",
        ]),
      );

      // Fully satisfied
      const complete = evaluateJobDocumentationGate({
        riskTier: "MODERATE",
        beforePhotos: [{ url: "https://photos.test/before.jpg", phase: "BEFORE" }],
        afterPhotos: [{ url: "https://photos.test/after.jpg", phase: "AFTER" }],
        workerIdentityConfirmed: true,
        riskChecklist: [{ key: "BREAKER_OFF", label: "Breaker de-energized", confirmed: true }],
        customerSignoff: { signed: true, customerName: "Jane Homeowner" },
      });
      expect(complete.passed).toBe(true);
      expect(complete.status).toBe("VERIFIED_COMPLIANT");
    });

    it("enforces HIGH risk requirements including in-progress evidence and permit check", () => {
      const res = evaluateJobDocumentationGate({
        riskTier: "HIGH",
        beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
        inProgressPhotos: [{ url: "https://photos.test/in.jpg", phase: "IN_PROGRESS" }],
        afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
        workerIdentityConfirmed: true,
        riskChecklist: [
          { key: "PANEL_CLEARED", label: "Panel working clearance", confirmed: true },
          { key: "TORQUE_CHECKED", label: "Torque lugs verified", confirmed: true },
        ],
        requiresPermit: true,
        permitId: "4a719c23-7a2e-4cb8-8c1d-111111111111",
        customerSignoff: { signed: true, customerName: "Bob Builder" },
      });

      expect(res.passed).toBe(true);
      expect(res.status).toBe("VERIFIED_COMPLIANT");
      expect(res.missingRequirements).toHaveLength(0);
    });

    it("enforces CRITICAL risk requirements (4+ photos, verified permit, and site safety checklist)", () => {
      const res = evaluateJobDocumentationGate({
        riskTier: "CRITICAL",
        beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
        inProgressPhotos: [{ url: "https://photos.test/in.jpg", phase: "IN_PROGRESS" }],
        afterPhotos: [
          { url: "https://photos.test/a1.jpg", phase: "AFTER" },
          { url: "https://photos.test/a2.jpg", phase: "AFTER" },
        ],
        workerIdentityConfirmed: true,
        riskChecklist: [
          { key: "SITE_PLAN", label: "Site safety plan executed", confirmed: true },
          { key: "LOTO", label: "Lockout/tagout padlock applied", confirmed: true },
          { key: "PPE", label: "Arc-rated PPE confirmed", confirmed: true },
        ],
        requiresPermit: true,
        permitVerified: true,
        customerSignoff: { signed: true, customerName: "Site Ops" },
      });

      expect(res.passed).toBe(true);
      expect(res.status).toBe("VERIFIED_COMPLIANT");
      expect(res.qaAuditRequired).toBe(true); // Always sampled for critical risk
    });

    it("triggers automated #58 safety incident escalation when critical hazard is detected", () => {
      const res = evaluateJobDocumentationGate({
        riskTier: "HIGH",
        beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
        inProgressPhotos: [{ url: "https://photos.test/in.jpg", phase: "IN_PROGRESS" }],
        afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
        workerIdentityConfirmed: true,
        riskChecklist: [
          {
            key: "LIVE_ELECTRICAL_SHOCK_HAZARD",
            label: "Electrical shock hazard present",
            confirmed: false, // Uncleared hazard!
          },
        ],
        customerSignoff: { signed: true },
      });

      expect(res.passed).toBe(false);
      expect(res.status).toBe("DEFICIENT");
      expect(res.incidentEscalationRequired).toBe(true);
      expect(res.severeHazardDetected).toBe(true);
      expect(res.escalationReason).toContain("LIVE_ELECTRICAL_SHOCK_HAZARD");
    });

    it("marks package DEFICIENT when unrectified critical deficiency is reported", () => {
      const res = evaluateJobDocumentationGate({
        riskTier: "MODERATE",
        beforePhotos: [{ url: "https://photos.test/b.jpg", phase: "BEFORE" }],
        afterPhotos: [{ url: "https://photos.test/a.jpg", phase: "AFTER" }],
        workerIdentityConfirmed: true,
        riskChecklist: [{ key: "OK", label: "OK", confirmed: true }],
        customerSignoff: { signed: true },
        deficiencies: [
          {
            code: "BURNT_NEUTRAL_WIRE",
            severity: "CRITICAL",
            description: "Main neutral bus burnt and exposed to enclosure",
            rectified: false,
          },
        ],
      });

      expect(res.passed).toBe(false);
      expect(res.status).toBe("DEFICIENT");
      expect(res.incidentEscalationRequired).toBe(true);
      expect(res.escalationReason).toContain("BURNT_NEUTRAL_WIRE");
    });
  });

  describe("evaluateQaSamplingEligibility", () => {
    it("mandates audit for 100% of CRITICAL jobs", () => {
      const res = evaluateQaSamplingEligibility({ riskTier: "CRITICAL" });
      expect(res.sampleForAudit).toBe(true);
      expect(res.reason).toBe("MANDATORY_CRITICAL_RISK_AUDIT");
    });

    it("samples HIGH risk jobs when contractor has past defect history", () => {
      const res = evaluateQaSamplingEligibility({
        riskTier: "HIGH",
        contractorRepeatDefectCount: 1,
      });
      expect(res.sampleForAudit).toBe(true);
      expect(res.reason).toBe("HIGH_RISK_CONTRACTOR_DEFECT_HISTORY");
    });

    it("samples HIGH risk jobs when contractor rating is below benchmark (< 4.5)", () => {
      const res = evaluateQaSamplingEligibility({
        riskTier: "HIGH",
        contractorRatingBps: 4200,
        contractorRepeatDefectCount: 0,
      });
      expect(res.sampleForAudit).toBe(true);
      expect(res.reason).toBe("HIGH_RISK_BELOW_BENCHMARK_RATING");
    });

    it("samples HIGH risk jobs under 20% random selection roll", () => {
      const rollPass = evaluateQaSamplingEligibility({
        riskTier: "HIGH",
        contractorRatingBps: 4900,
        contractorRepeatDefectCount: 0,
        qaSampleRandomRoll: 0.15, // < 0.20
      });
      expect(rollPass.sampleForAudit).toBe(true);
      expect(rollPass.reason).toBe("HIGH_RISK_RANDOM_SAMPLE_20_PCT");

      const rollFail = evaluateQaSamplingEligibility({
        riskTier: "HIGH",
        contractorRatingBps: 4900,
        contractorRepeatDefectCount: 0,
        qaSampleRandomRoll: 0.45, // >= 0.20
      });
      expect(rollFail.sampleForAudit).toBe(false);
    });

    it("exempts standard LOW risk jobs from sampling", () => {
      const res = evaluateQaSamplingEligibility({ riskTier: "LOW" });
      expect(res.sampleForAudit).toBe(false);
    });
  });

  describe("calculateQaMetrics", () => {
    it("correctly computes compliance rate, QA sampling rate, and tier breakdown", () => {
      const dummyPackages: JobDocumentationPackage[] = [
        {
          id: "1",
          jobId: "j1",
          serviceRequestId: "sr1",
          contractorId: "c1",
          propertyId: "p1",
          riskTier: "LOW",
          status: "VERIFIED_COMPLIANT",
          beforePhotos: [],
          inProgressPhotos: [],
          afterPhotos: [],
          workerIdentityConfirmed: true,
          riskChecklist: [],
          customerSignoff: { signed: true },
          permitVerified: false,
          qaAuditRequired: false,
          qaAuditStatus: "NOT_REQUIRED",
          incidentEscalated: false,
          deficiencies: [],
          exceptionAuditLog: [],
          propertyPassportLinked: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "2",
          jobId: "j2",
          serviceRequestId: "sr2",
          contractorId: "c1",
          propertyId: "p1",
          riskTier: "HIGH",
          status: "DEFICIENT",
          beforePhotos: [],
          inProgressPhotos: [],
          afterPhotos: [],
          workerIdentityConfirmed: true,
          riskChecklist: [],
          customerSignoff: { signed: false },
          permitVerified: false,
          qaAuditRequired: true,
          qaAuditStatus: "PENDING",
          incidentEscalated: true,
          deficiencies: [
            { code: "D1", severity: "HIGH", description: "Missing ground", rectified: true },
            { code: "D2", severity: "HIGH", description: "Loose wire", rectified: false },
          ],
          exceptionAuditLog: [],
          propertyPassportLinked: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "3",
          jobId: "j3",
          serviceRequestId: "sr3",
          contractorId: "c2",
          propertyId: "p2",
          riskTier: "CRITICAL",
          status: "OPS_APPROVED_EXCEPTION",
          beforePhotos: [],
          inProgressPhotos: [],
          afterPhotos: [],
          workerIdentityConfirmed: true,
          riskChecklist: [],
          customerSignoff: { signed: true },
          permitVerified: true,
          qaAuditRequired: true,
          qaAuditStatus: "PASSED",
          incidentEscalated: false,
          deficiencies: [],
          exceptionAuditLog: [{ approvedByUserId: "admin", reason: "Emergency override", timestamp: new Date().toISOString() }],
          propertyPassportLinked: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const metrics = calculateQaMetrics(dummyPackages);

      expect(metrics.totalPackages).toBe(3);
      expect(metrics.verifiedCompliantCount).toBe(1);
      expect(metrics.deficientCount).toBe(1);
      expect(metrics.exceptionApprovedCount).toBe(1);
      // Compliant count = 1 + 1 = 2 out of 3 = 66.67% (6667 bps)
      expect(metrics.complianceRateBps).toBe(6667);
      // Sampled count = 2 out of 3 = 6667 bps
      expect(metrics.qaSamplingRateBps).toBe(6667);
      // Deficiencies: 1 rectified out of 2 = 5000 bps
      expect(metrics.defectRemediationRateBps).toBe(5000);
      expect(metrics.tierBreakdown["LOW"]?.compliant).toBe(1);
      expect(metrics.tierBreakdown["HIGH"]?.compliant).toBe(0);
      expect(metrics.tierBreakdown["CRITICAL"]?.compliant).toBe(1);
    });
  });
});
