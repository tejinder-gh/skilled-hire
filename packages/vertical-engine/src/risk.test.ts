import { describe, expect, it } from "vitest";
import { evaluateJobRisk } from "./risk.js";

describe("Job Risk Scoring & Dispatch Controls Evaluator (#60)", () => {
  it("evaluates a standard low-risk job as LOW tier and permits dispatch without extra controls", () => {
    const result = evaluateJobRisk({
      serviceVariant: {
        verticalSlug: "plumbing",
        complexityTier: "TIER_1_STANDARD",
        basePriceCents: 15000,
      },
      jobDetails: {
        jobValueCents: 15000,
        propertyAgeYears: 10,
        isCommercialOrIndustrial: false,
      },
      hazardFlags: [],
    });

    expect(result.riskTier).toBe("LOW");
    expect(result.residualScore).toBeLessThanOrEqual(35);
    expect(result.requiresManualApproval).toBe(false);
    expect(result.mandatoryControls.length).toBe(0);
    expect(result.canDispatch).toBe(true);
    expect(result.decisionLog.calculatedTier).toBe("LOW");
  });

  it("calculates MODERATE risk tier for intermediate complexity and aging property", () => {
    const result = evaluateJobRisk({
      serviceVariant: {
        verticalSlug: "electrical",
        complexityTier: "TIER_2_INTERMEDIATE",
        basePriceCents: 85000,
      },
      jobDetails: {
        jobValueCents: 85000,
        propertyAgeYears: 35,
        isCommercialOrIndustrial: false,
      },
      hazardFlags: [],
    });

    expect(result.riskTier).toBe("MODERATE");
    expect(result.inherentScore).toBeGreaterThanOrEqual(50);
    expect(result.requiresManualApproval).toBe(false);
    expect(result.canDispatch).toBe(true);
  });

  it("automatically infers hazard flags from physical inputs (height, voltage, confined space)", () => {
    const result = evaluateJobRisk({
      serviceVariant: {
        verticalSlug: "electrical",
        complexityTier: "TIER_2_INTERMEDIATE",
      },
      jobDetails: {
        heightMeters: 4.5,
        confinedSpaceAccess: true,
        voltageLevelVolts: 600,
      },
    });

    expect(result.hazardFlags).toContain("WORKING_AT_HEIGHTS");
    expect(result.hazardFlags).toContain("CONFINED_SPACE");
    expect(result.hazardFlags).toContain("HIGH_VOLTAGE");
    expect(result.riskTier).toBe("CRITICAL");
    expect(result.requiresManualApproval).toBe(true);

    const controlCodes = result.mandatoryControls.map((c) => c.control);
    expect(controlCodes).toContain("FALL_ARREST_EQUIPMENT");
    expect(controlCodes).toContain("ATMOSPHERIC_TESTING");
    expect(controlCodes).toContain("LOCKOUT_TAGOUT_PLAN");
    expect(controlCodes).toContain("CAL_RATED_PPE");
  });

  it("triggers RED-FLAG override for LIVE_ELECTRICAL_WORK forcing CRITICAL tier regardless of score", () => {
    const result = evaluateJobRisk({
      serviceVariant: {
        verticalSlug: "electrical",
        complexityTier: "TIER_1_STANDARD",
      },
      hazardFlags: ["LIVE_ELECTRICAL_WORK"],
      mitigationFactors: [
        { mitigation: "LICENSED_MASTER_SUPERVISOR", verified: true },
        { mitigation: "DUAL_CERTIFIED_TECHNICIAN_CREW", verified: true },
        { mitigation: "CALIBRATED_SAFETY_EQUIPMENT_CHECKLIST", verified: true },
      ],
    });

    expect(result.riskTier).toBe("CRITICAL");
    expect(result.requiresManualApproval).toBe(true);
    expect(result.decisionLog.redFlagTriggered).toBe(true);
    expect(result.canDispatch).toBe(false);
    expect(result.denyCodes).toContain("CRITICAL_RISK_MANUAL_APPROVAL_REQUIRED");
    expect(result.denyCodes).toContain("UNFULFILLED_MANDATORY_SAFETY_CONTROLS");
  });

  it("blocks dispatch when mandatory safety controls remain unfulfilled", () => {
    const result = evaluateJobRisk({
      serviceVariant: {
        verticalSlug: "roofing",
        complexityTier: "TIER_2_INTERMEDIATE",
      },
      hazardFlags: ["WORKING_AT_HEIGHTS"],
      manualApprovalStatus: "NOT_REQUIRED",
    });

    expect(result.unfulfilledControls).toContain("FALL_ARREST_EQUIPMENT");
    expect(result.canDispatch).toBe(false);
    expect(result.denyCodes).toContain("UNFULFILLED_MANDATORY_SAFETY_CONTROLS");
  });

  it("authorizes dispatch when mandatory controls are fulfilled and manual review is approved", () => {
    const result = evaluateJobRisk({
      serviceVariant: {
        verticalSlug: "electrical",
        complexityTier: "TIER_3_ADVANCED",
      },
      hazardFlags: ["HIGH_VOLTAGE"],
      manualApprovalStatus: "APPROVED",
      verifiedControls: [
        {
          control: "SITE_SPECIFIC_SAFETY_PLAN",
          fulfilledAt: new Date().toISOString(),
          notes: "Safety plan signed off by site supervisor",
        },
        {
          control: "SENIOR_SUPERVISOR_ON_SITE",
          fulfilledAt: new Date().toISOString(),
          notes: "Master Electrician ME-9921 on site",
        },
        {
          control: "LOCKOUT_TAGOUT_PLAN",
          fulfilledAt: new Date().toISOString(),
          notes: "Main breaker locked and tagged",
        },
        {
          control: "CAL_RATED_PPE",
          fulfilledAt: new Date().toISOString(),
          notes: "Category 4 40-cal arc flash suit inspected",
        },
      ],
    });

    expect(result.riskTier).toBe("CRITICAL");
    expect(result.unfulfilledControls.length).toBe(0);
    expect(result.canDispatch).toBe(true);
    expect(result.denyCodes.length).toBe(0);
  });

  it("enforces safe unknown-input behavior with conservative high-risk assumptions", () => {
    const result = evaluateJobRisk({
      hazardFlags: ["UNKNOWN_HAZARD_XYZ"],
    });

    expect(result.hazardFlags).toContain("UNKNOWN_HAZARD_XYZ");
    expect(result.inherentScore).toBeGreaterThanOrEqual(45);
    expect(
      result.decisionLog.hazardFlagAdjustments.some((h) =>
        h.reason.includes("Unrecognized hazard flag"),
      ),
    ).toBe(true);
  });

  it("applies verified mitigation deductions up to the 40-point safety ceiling", () => {
    const result = evaluateJobRisk({
      serviceVariant: {
        verticalSlug: "electrical",
        complexityTier: "TIER_3_ADVANCED",
      },
      jobDetails: {
        jobValueCents: 1200000,
        isCommercialOrIndustrial: true,
      },
      mitigationFactors: [
        { mitigation: "LICENSED_MASTER_SUPERVISOR", verified: true },
        { mitigation: "DUAL_CERTIFIED_TECHNICIAN_CREW", verified: true },
        { mitigation: "CALIBRATED_SAFETY_EQUIPMENT_CHECKLIST", verified: true },
        { mitigation: "PRE_JOB_UTILITY_DISCONNECT_VERIFIED", verified: true },
        { mitigation: "CONTRACTOR_SAFETY_EXCELLENCE", verified: true },
      ],
    });

    // Inherent is high (>80), mitigations total 60, capped at 40
    expect(result.mitigationsScore).toBe(40);
    expect(result.residualScore).toBe(result.inherentScore - 40);
  });
});
