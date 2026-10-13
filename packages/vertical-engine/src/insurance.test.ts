import { describe, expect, it } from "vitest";
import {
  evaluateCoverageEligibility,
  calculateProtectionPremium,
  buildCoverageCertificate,
  verifyCoverageCertificate,
  adjudicateProtectionClaim,
  type ProtectionProductData,
} from "./insurance.js";

const mockProduct: ProtectionProductData = {
  id: "prod-std-100",
  slug: "STANDARD_DEFECT_PROTECTION",
  name: "Standard Workmanship & Defect Protection ($25,000)",
  version: "1.0.0",
  jurisdiction: "ON",
  underwriterName: "Trillium Surety & Casualty Canada ULC",
  underwriterPolicyRef: "TRILLIUM-ON-POL-2026-STD-25K",
  brokerName: "SkilledHire Insurance Services Inc.",
  brokerLicenseRef: "RIBO-ON-LIC-39102-CORP",
  coverageLimitCents: 2500000, // $25,000
  deductibleCents: 25000, // $250
  durationMonths: 12,
  baseRateBps: 250, // 2.5%
  minPremiumCents: 4900, // $49
  brokerCommissionBps: 1500, // 15%
  platformFeeBps: 1000, // 10%
  taxRateBps: 800, // 8%
  termsMarkdown: "# Policy Terms",
  disclaimers: ["NO_UNSUPPORTED_GUARANTEE_DISCLOSURE"],
  maxJobValueCents: 10000000, // $100,000
  active: true,
};

describe("Customer Protection Insurance Domain Engine", () => {
  describe("Coverage Eligibility & Underwriting", () => {
    it("approves eligible job within value ceiling and valid contractor standing", () => {
      const result = evaluateCoverageEligibility({
        product: mockProduct,
        jobValueCents: 350000, // $3,500
        serviceRequest: {
          id: "req-1",
          verticalId: "v-electrical",
          region: "ON",
        },
        contractor: {
          id: "cont-1",
          status: "VERIFIED",
          safetyStatus: "ACTIVE",
          activeQuarantines: [],
        },
      });

      expect(result.eligible).toBe(true);
      expect(result.decision).toBe("ELIGIBLE");
      expect(result.declineReasons.length).toBe(0);
    });

    it("declines when job value exceeds product maximum ceiling", () => {
      const result = evaluateCoverageEligibility({
        product: mockProduct,
        jobValueCents: 15000000, // $150,000 (exceeds $100,000 max)
        serviceRequest: {
          id: "req-1",
          verticalId: "v-electrical",
          region: "ON",
        },
      });

      expect(result.eligible).toBe(false);
      expect(result.decision).toBe("DECLINED_JOB_VALUE_EXCEEDED");
      expect(result.declineReasons[0]).toContain("exceeds maximum policy ceiling");
    });

    it("declines when service request region mismatches product jurisdiction", () => {
      const result = evaluateCoverageEligibility({
        product: mockProduct,
        jobValueCents: 350000,
        serviceRequest: {
          id: "req-1",
          verticalId: "v-electrical",
          region: "BC", // Product is ON
        },
      });

      expect(result.eligible).toBe(false);
      expect(result.decision).toBe("DECLINED_JURISDICTION_MISMATCH");
    });

    it("declines when contractor is unverified", () => {
      const result = evaluateCoverageEligibility({
        product: mockProduct,
        jobValueCents: 350000,
        serviceRequest: {
          id: "req-1",
          verticalId: "v-electrical",
          region: "ON",
        },
        contractor: {
          id: "cont-1",
          status: "PENDING",
        },
      });

      expect(result.eligible).toBe(false);
      expect(result.decision).toBe("DECLINED_UNVERIFIED_STATUS");
    });

    it("declines when contractor is under safety suspension or quarantine", () => {
      const result = evaluateCoverageEligibility({
        product: mockProduct,
        jobValueCents: 350000,
        serviceRequest: {
          id: "req-1",
          verticalId: "v-electrical",
          region: "ON",
        },
        contractor: {
          id: "cont-1",
          status: "VERIFIED",
          safetyStatus: "SUSPENDED",
        },
      });

      expect(result.eligible).toBe(false);
      expect(result.decision).toBe("DECLINED_CONTRACTOR_QUARANTINE");
    });

    it("declines when job includes excluded high-hazard flags", () => {
      const result = evaluateCoverageEligibility({
        product: mockProduct,
        jobValueCents: 350000,
        serviceRequest: {
          id: "req-1",
          verticalId: "v-electrical",
          region: "ON",
        },
        contractor: {
          id: "cont-1",
          status: "VERIFIED",
        },
        hazardFlags: ["HAZMAT_ASBESTOS"],
      });

      expect(result.eligible).toBe(false);
      expect(result.decision).toBe("DECLINED_HAZARD_EXCLUSION");
      expect(result.declineReasons[0]).toContain("HAZMAT_ASBESTOS");
    });
  });

  describe("Premium Calculation & Financial Breakdown", () => {
    it("computes standard rate premium with broker commission, tech fee, and provincial tax", () => {
      // Job value = $5,000.00 (500,000 cents)
      // Base rate = 250 bps (2.5%) -> raw = $125.00 (12,500 cents) > min $49.00
      // Broker commission = 15% of 12,500 = 1,875 cents ($18.75)
      // Platform fee = 10% of 12,500 = 1,250 cents ($12.50)
      // Taxable = 12,500 + 1,250 = 13,750 cents. Tax 8% = 1,100 cents ($11.00)
      // Total payable = 12,500 + 1,250 + 1,100 = 14,850 cents ($148.50)
      const pricing = calculateProtectionPremium({
        product: mockProduct,
        jobValueCents: 500000,
      });

      expect(pricing.grossPremiumCents).toBe(12500);
      expect(pricing.brokerCommissionCents).toBe(1875);
      expect(pricing.platformFeeCents).toBe(1250);
      expect(pricing.taxCents).toBe(1100);
      expect(pricing.totalPayableCents).toBe(14850);
    });

    it("enforces minimum premium floor on small jobs", () => {
      // Job value = $500.00 (50,000 cents). Raw 2.5% = 1,250 cents ($12.50) < min $49.00 (4,900 cents)
      // Gross premium floored at 4,900 cents
      const pricing = calculateProtectionPremium({
        product: mockProduct,
        jobValueCents: 50000,
      });

      expect(pricing.grossPremiumCents).toBe(4900);
      expect(pricing.brokerCommissionCents).toBe(Math.round((4900 * 1500) / 10000));
      expect(pricing.totalPayableCents).toBeGreaterThan(4900);
    });
  });

  describe("Tamper-Evident Coverage Certificate & Cryptographic Verification", () => {
    it("generates deterministic SHA-256 certificate and verifies evidence integrity", () => {
      const cert = buildCoverageCertificate({
        certificateNumber: "SH-POL-2026-ON-778811",
        policyId: "pol-uuid-1",
        jurisdiction: "ON",
        customerId: "cust-1",
        customerName: "Alex Homeowner",
        contractorId: "cont-1",
        contractorName: "Acme Electrical Services Inc",
        underwriterName: "Trillium Surety & Casualty Canada ULC",
        underwriterPolicyRef: "TRILLIUM-ON-POL-2026-STD-25K",
        brokerName: "SkilledHire Insurance Services Inc.",
        brokerLicenseRef: "RIBO-ON-LIC-39102-CORP",
        coverageLimitCents: 2500000,
        deductibleCents: 25000,
        durationMonths: 12,
        effectiveStartDate: "2026-10-15T00:00:00.000Z",
        effectiveEndDate: "2027-10-15T00:00:00.000Z",
        cancellationDeadline: "2026-10-25T00:00:00.000Z",
      });

      expect(cert.certificateNumber).toBe("SH-POL-2026-ON-778811");
      expect(cert.policyChecksum).toBeDefined();
      expect(cert.policyChecksum.length).toBe(64); // SHA-256 hex string

      // Verify certificate passes cryptographic check
      const valid = verifyCoverageCertificate(cert);
      expect(valid).toBe(true);

      // Tampered certificate fails verification
      const tampered = {
        ...cert,
        coverage: { ...cert.coverage, limitCents: 99999999 },
      };
      expect(verifyCoverageCertificate(tampered)).toBe(false);
    });
  });

  describe("Protection Claims Adjudication", () => {
    const activePolicy = {
      coverageLimitCents: 2500000, // $25,000
      deductibleCents: 25000, // $250
      effectiveStartDate: new Date("2026-10-01T00:00:00.000Z"),
      effectiveEndDate: new Date("2027-10-01T00:00:00.000Z"),
      status: "BOUND_ACTIVE",
    };

    it("approves valid defect claim and applies policy deductible", () => {
      // Claimed = $2,500.00 (250,000 cents). Deductible = $250.00 (25,000 cents).
      // Net payout = $2,250.00 (225,000 cents).
      const adjudication = adjudicateProtectionClaim({
        claim: {
          claimedAmountCents: 250000,
          incidentDate: new Date("2026-11-15T00:00:00.000Z"),
          evidenceUrls: ["https://storage.skilledhire.ca/claims/photo1.jpg"],
        },
        policy: activePolicy,
        decision: "APPROVED",
        adjudicationNotes: "Workmanship defect in 200A panel verified by trade inspector.",
      });

      expect(adjudication.status).toBe("APPROVED");
      expect(adjudication.adjudicatedAmountCents).toBe(250000);
      expect(adjudication.deductibleAppliedCents).toBe(25000);
      expect(adjudication.netPayoutCents).toBe(225000);
      expect(adjudication.declineReasonCode).toBeNull();
    });

    it("caps claim payout at maximum policy coverage limit", () => {
      // Claimed = $35,000.00 (3,500,000 cents). Policy limit = $25,000.00 (2,500,000 cents).
      const adjudication = adjudicateProtectionClaim({
        claim: {
          claimedAmountCents: 3500000,
          incidentDate: new Date("2026-12-01T00:00:00.000Z"),
          evidenceUrls: ["https://storage.skilledhire.ca/claims/loss.jpg"],
        },
        policy: activePolicy,
        decision: "APPROVED",
        adjudicationNotes: "Major loss approved up to statutory policy limit.",
      });

      expect(adjudication.netPayoutCents).toBe(2500000); // Capped at limit
    });

    it("declines claim when incident date is outside policy period", () => {
      const adjudication = adjudicateProtectionClaim({
        claim: {
          claimedAmountCents: 100000,
          incidentDate: new Date("2028-05-01T00:00:00.000Z"), // Expired
          evidenceUrls: ["https://storage.skilledhire.ca/claims/late.jpg"],
        },
        policy: activePolicy,
        decision: "APPROVED",
        adjudicationNotes: "Late filing",
      });

      expect(adjudication.status).toBe("DECLINED");
      expect(adjudication.declineReasonCode).toBe("CLAIM_EXCEEDS_POLICY_PERIOD");
      expect(adjudication.netPayoutCents).toBe(0);
    });

    it("processes explicit decline with reason code", () => {
      const adjudication = adjudicateProtectionClaim({
        claim: {
          claimedAmountCents: 100000,
          incidentDate: new Date("2026-11-01T00:00:00.000Z"),
          evidenceUrls: ["https://storage.skilledhire.ca/claims/wear.jpg"],
        },
        policy: activePolicy,
        decision: "DECLINED",
        declineReasonCode: "WEAR_AND_TEAR",
        adjudicationNotes: "Failure due to ordinary homeowner wear and tear, not installation defect.",
      });

      expect(adjudication.status).toBe("DECLINED");
      expect(adjudication.declineReasonCode).toBe("WEAR_AND_TEAR");
      expect(adjudication.netPayoutCents).toBe(0);
    });
  });
});
