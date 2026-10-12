import { describe, expect, it } from "vitest";
import { evaluateIncidentTriage, evaluateQuarantineGate } from "./safety.js";
import { evaluatePreDispatchEligibility } from "./predispatch.js";

describe("Safety Incident Response & Quarantine Evaluator (#58)", () => {
  const contractorId = "99999999-9999-9999-9999-999999999999";
  const technicianId = "88888888-8888-8888-8888-888888888888";
  const elecVerticalId = "11111111-1111-1111-1111-111111111111";
  const panelUpgradeId = "22222222-2222-2222-2222-222222222222";

  it("automatically escalates electrical shock hazard to CRITICAL_EMERGENCY and triggers mandatory quarantine + insurer alert", () => {
    const result = evaluateIncidentTriage({
      incidentType: "ELECTRICAL_HAZARD_SHOCK",
      reportedSeverity: "MAJOR_SAFETY",
      contractorId,
      technicianId,
      serviceVerticalId: elecVerticalId,
      issueTypeId: panelUpgradeId,
    });

    expect(result.recommendedSeverity).toBe("CRITICAL_EMERGENCY");
    expect(result.emergencyEscalation).toBe(true);
    expect(result.mandatoryQuarantine).toBe(true);
    expect(result.mandatoryInsurerNotification).toBe(true);
    expect(result.mandatoryIndependentReview).toBe(true);
    expect(result.recommendedQuarantineScope.contractorSuspended).toBe(true);
    expect(result.recommendedQuarantineScope.technicianSuspended).toBe(true);
    expect(result.rationale).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Automated escalation to CRITICAL_EMERGENCY"),
        expect.stringContaining("Insurer notification workflow triggered"),
      ]),
    );
  });

  it("automatically escalates gas leak and fire risks to CRITICAL_EMERGENCY", () => {
    const result = evaluateIncidentTriage({
      incidentType: "GAS_LEAK_FIRE_RISK",
      reportedSeverity: "MODERATE_DEFECT",
      contractorId,
      technicianId,
    });

    expect(result.recommendedSeverity).toBe("CRITICAL_EMERGENCY");
    expect(result.mandatoryQuarantine).toBe(true);
    expect(result.mandatoryInsurerNotification).toBe(true);
  });

  it("handles moderate defect without full platform suspension but mandates remediation inspection", () => {
    const result = evaluateIncidentTriage({
      incidentType: "REGULATORY_CODE_VIOLATION",
      reportedSeverity: "MODERATE_DEFECT",
      contractorId,
      technicianId,
    });

    expect(result.recommendedSeverity).toBe("MODERATE_DEFECT");
    expect(result.emergencyEscalation).toBe(false);
    expect(result.mandatoryQuarantine).toBe(false);
    expect(result.mandatoryInsurerNotification).toBe(false);
    expect(result.remediationInspectionRequired).toBe(true);
  });

  it("escalates to mandatory quarantine when repeat defect threshold is met (>= 2)", () => {
    const result = evaluateIncidentTriage({
      incidentType: "PROPERTY_DAMAGE_MAJOR",
      reportedSeverity: "MODERATE_DEFECT",
      contractorId,
      technicianId,
      repeatDefectsCount: 3,
    });

    expect(result.mandatoryQuarantine).toBe(true);
    expect(result.recommendedQuarantineScope.contractorSuspended).toBe(true);
    expect(result.rationale).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Repeat defect threshold triggered (3 prior recorded defects)"),
      ]),
    );
  });

  it("quarantine gate blocks contractor with safetyStatus === SUSPENDED", () => {
    const gate = evaluateQuarantineGate({
      contractorId,
      technicianId,
      verticalId: elecVerticalId,
      contractorSafetyStatus: "SUSPENDED",
      technicianSafetyStatus: "ACTIVE",
      activeQuarantines: [],
    });

    expect(gate.blocked).toBe(true);
    expect(gate.denyCode).toBe("CONTRACTOR_SAFETY_SUSPENDED");
    expect(gate.reason).toContain("suspended due to safety sanction");
  });

  it("quarantine gate blocks technician with safetyStatus === SUSPENDED", () => {
    const gate = evaluateQuarantineGate({
      contractorId,
      technicianId,
      verticalId: elecVerticalId,
      contractorSafetyStatus: "ACTIVE",
      technicianSafetyStatus: "SUSPENDED",
      activeQuarantines: [],
    });

    expect(gate.blocked).toBe(true);
    expect(gate.denyCode).toBe("TECHNICIAN_SAFETY_SUSPENDED");
  });

  it("quarantine gate enforces vertical scope restriction", () => {
    const gate = evaluateQuarantineGate({
      contractorId,
      technicianId,
      verticalId: elecVerticalId,
      contractorSafetyStatus: "ACTIVE",
      technicianSafetyStatus: "ACTIVE",
      activeQuarantines: [
        {
          quarantineType: "VERTICAL_SCOPE_RESTRICTION",
          restrictedVerticalIds: [elecVerticalId],
          restrictedIssueTypeIds: [],
        },
      ],
    });

    expect(gate.blocked).toBe(true);
    expect(gate.denyCode).toBe("CONTRACTOR_QUARANTINED_SCOPE");

    // Unrelated vertical should pass through
    const hvacVerticalId = "33333333-3333-3333-3333-333333333333";
    const passGate = evaluateQuarantineGate({
      contractorId,
      technicianId,
      verticalId: hvacVerticalId,
      contractorSafetyStatus: "ACTIVE",
      technicianSafetyStatus: "ACTIVE",
      activeQuarantines: [
        {
          quarantineType: "VERTICAL_SCOPE_RESTRICTION",
          restrictedVerticalIds: [elecVerticalId],
          restrictedIssueTypeIds: [],
        },
      ],
    });

    expect(passGate.blocked).toBe(false);
  });

  it("integrates into evaluatePreDispatchEligibility to block suspended contractor", () => {
    const res = evaluatePreDispatchEligibility({
      serviceRequest: {
        id: "req-1",
        verticalId: elecVerticalId,
        verticalSlug: "electrical",
        urgency: "STANDARD",
        region: "ON",
      },
      contractor: {
        id: contractorId,
        name: "Acme Electric",
        status: "VERIFIED",
        verticalIds: [elecVerticalId],
        safetyStatus: "SUSPENDED",
      },
      technician: {
        id: technicianId,
        contractorId,
        displayName: "Bob E.",
        active: true,
      },
      contractorCredentials: [],
      technicianCredentials: [],
    });

    expect(res.eligible).toBe(false);
    expect(res.denyCodes).toContain("CONTRACTOR_SAFETY_SUSPENDED");
  });

  it("integrates into evaluatePreDispatchEligibility to block scoped quarantine on issue type", () => {
    const res = evaluatePreDispatchEligibility({
      serviceRequest: {
        id: "req-2",
        verticalId: elecVerticalId,
        verticalSlug: "electrical",
        issueTypeId: panelUpgradeId,
        urgency: "STANDARD",
        region: "ON",
      },
      contractor: {
        id: contractorId,
        name: "Acme Electric",
        status: "VERIFIED",
        verticalIds: [elecVerticalId],
        safetyStatus: "ACTIVE",
        activeQuarantines: [
          {
            quarantineType: "VERTICAL_SCOPE_RESTRICTION",
            restrictedVerticalIds: [],
            restrictedIssueTypeIds: [panelUpgradeId],
          },
        ],
      },
      technician: {
        id: technicianId,
        contractorId,
        displayName: "Bob E.",
        active: true,
      },
      contractorCredentials: [],
      technicianCredentials: [],
    });

    expect(res.eligible).toBe(false);
    expect(res.denyCodes).toContain("CONTRACTOR_QUARANTINED_SCOPE");
  });
});
