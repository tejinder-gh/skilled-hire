import { describe, expect, it } from "vitest";
import type { ElectricalPermit, PermitDeficiency } from "@marketplace/contracts";
import { evaluateElectricalAcceptance } from "./permits.js";

describe("Electrical Permits & ESA Regulatory Acceptance (#59)", () => {
  const mockPermit: ElectricalPermit = {
    id: "9918a221-f123-4411-8822-112233445566",
    permitNumber: "PERM-202610-8821",
    jobId: "11111111-2222-3333-4444-555555555555",
    propertyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    contractorId: "22222222-3333-4444-5555-666666666666",
    technicianId: "33333333-4444-5555-6666-777777777777",
    jurisdiction: "ON",
    permitAuthority: "ESA",
    permitType: "ESA_LEC_NOTIFICATION",
    esaNotificationNumber: "ESA-NOTIF-991823",
    ecraLicenseNumber: "ECRA-ESA-7001122",
    designatedMasterElectrician: "Marcus Aurelius (ME-8829)",
    scopeOfWork: "200A main service panel upgrade and sub-panel installation",
    status: "FILED",
    utilityDisconnectRequired: true,
    utilityProvider: "Toronto Hydro",
    utilityMeterNumber: "TH-MTR-99218",
    utilityDisconnectDate: "2026-10-14T08:00:00Z",
    inspectionStatus: "NOT_REQUESTED",
    regulatorySignOffStatus: "PENDING",
    provenanceAudit: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("passes non-permit required trade work with NOT_APPLICABLE status", () => {
    const result = evaluateElectricalAcceptance({
      isPermitRequired: false,
      permit: null,
      deficiencies: [],
    });

    expect(result.canFullyAccept).toBe(true);
    expect(result.regulatorySignOffStatus).toBe("NOT_APPLICABLE");
    expect(result.regulatorySignOffAchieved).toBe(true);
    expect(result.missingItems).toHaveLength(0);
    expect(result.customerSummary.requiresPermit).toBe(false);
  });

  it("fails closed when permit is required but not filed on record", () => {
    const result = evaluateElectricalAcceptance({
      isPermitRequired: true,
      permit: null,
      deficiencies: [],
    });

    expect(result.canFullyAccept).toBe(false);
    expect(result.regulatorySignOffStatus).toBe("PENDING");
    expect(result.missingItems).toContain("PERMIT_NOT_FILED");
    expect(result.customerSummary.missingArtifactsText[0]).toMatch(/permit/i);
  });

  it("fails closed when permit is filed but Certificate of Acceptance is pending", () => {
    const result = evaluateElectricalAcceptance({
      isPermitRequired: true,
      permit: {
        ...mockPermit,
        status: "WORK_COMPLETED",
        inspectionStatus: "REQUESTED",
      },
      deficiencies: [],
    });

    expect(result.canFullyAccept).toBe(false);
    expect(result.regulatorySignOffStatus).toBe("PENDING");
    expect(result.workFinished).toBe(true); // Contractor finished physical work
    expect(result.regulatorySignOffAchieved).toBe(false); // But regulatory sign-off is NOT achieved
    expect(result.missingItems).toContain("MISSING_CERTIFICATE_OF_ACCEPTANCE");
  });

  it("fails closed and marks DEFICIENCIES_OUTSTANDING when ESA inspector issues defects", () => {
    const defect: PermitDeficiency = {
      id: "def-1",
      permitId: mockPermit.id,
      defectCode: "OESC-10-204",
      severity: "MAJOR",
      description: "Main bonding jumper conductor undersized for 200A service rating",
      correctiveActionRequired: "Install minimum #6 AWG copper bonding jumper to water meter",
      status: "OPEN",
      issuedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = evaluateElectricalAcceptance({
      isPermitRequired: true,
      permit: {
        ...mockPermit,
        inspectionStatus: "DEFICIENCIES_ISSUED",
        certificateOfAcceptanceNumber: null,
      },
      deficiencies: [defect],
    });

    expect(result.canFullyAccept).toBe(false);
    expect(result.regulatorySignOffStatus).toBe("DEFICIENCIES_OUTSTANDING");
    expect(result.missingItems).toContain("UNRESOLVED_ESA_DEFICIENCIES");
    expect(result.customerSummary.hasOutstandingDefects).toBe(true);
  });

  it("fails closed when contractor rectified defect but inspector has not cleared it", () => {
    const rectifiedDefect: PermitDeficiency = {
      id: "def-2",
      permitId: mockPermit.id,
      defectCode: "OESC-10-204",
      severity: "MAJOR",
      description: "Main bonding jumper conductor undersized for 200A service rating",
      correctiveActionRequired: "Install minimum #6 AWG copper bonding jumper",
      status: "RECTIFIED", // Rectified by contractor, awaiting re-inspection
      issuedAt: new Date().toISOString(),
      rectifiedAt: new Date().toISOString(),
      rectifiedByUserId: "tech-user-1",
      rectificationNotes: "Installed #6 AWG copper bond with approved bronze clamp",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = evaluateElectricalAcceptance({
      isPermitRequired: true,
      permit: {
        ...mockPermit,
        inspectionStatus: "DEFICIENCIES_ISSUED",
      },
      deficiencies: [rectifiedDefect],
    });

    expect(result.canFullyAccept).toBe(false);
    expect(result.regulatorySignOffStatus).toBe("DEFICIENCIES_OUTSTANDING");
    expect(result.missingItems).toContain("UNRESOLVED_ESA_DEFICIENCIES");
  });

  it("authorizes full regulatory acceptance when defects are cleared and Certificate of Acceptance is verified", () => {
    const clearedDefect: PermitDeficiency = {
      id: "def-3",
      permitId: mockPermit.id,
      defectCode: "OESC-10-204",
      severity: "MAJOR",
      description: "Main bonding jumper conductor undersized",
      correctiveActionRequired: "Install #6 AWG copper jumper",
      status: "CLEARED_BY_INSPECTOR",
      issuedAt: new Date().toISOString(),
      rectifiedAt: new Date().toISOString(),
      clearedAt: new Date().toISOString(),
      clearedByInspector: "ESA Inspector #4109",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = evaluateElectricalAcceptance({
      isPermitRequired: true,
      permit: {
        ...mockPermit,
        status: "CERTIFICATE_ISSUED",
        inspectionStatus: "PASSED",
        certificateOfAcceptanceNumber: "ESA-COA-2026-992144",
        certificateOfAcceptanceUrl: "https://evidence.example.test/esa/coa-992144.pdf",
        certificateOfAcceptanceIssuedAt: new Date().toISOString(),
      },
      deficiencies: [clearedDefect],
    });

    expect(result.canFullyAccept).toBe(true);
    expect(result.regulatorySignOffStatus).toBe("FULLY_ACCEPTED");
    expect(result.regulatorySignOffAchieved).toBe(true);
    expect(result.missingItems).toHaveLength(0);
    expect(result.customerSummary.certificateOfAcceptanceNumber).toBe(
      "ESA-COA-2026-992144",
    );
  });

  it("authorizes acceptance when formal documented exception is approved by operations", () => {
    const result = evaluateElectricalAcceptance({
      isPermitRequired: true,
      permit: {
        ...mockPermit,
        status: "EXCEPTION_APPROVED",
        inspectionStatus: "WAIVED_EXCEPTION",
        documentedExceptionReason:
          "Pre-approved emergency service disconnect reconnect under utility master protocol OESC Rule 2-005 waiver.",
        documentedExceptionApprovedByUserId: "admin-ops-user-1",
        documentedExceptionAt: new Date().toISOString(),
      },
      deficiencies: [],
    });

    expect(result.canFullyAccept).toBe(true);
    expect(result.regulatorySignOffStatus).toBe("EXCEPTION_APPROVED");
    expect(result.regulatorySignOffAchieved).toBe(true);
    expect(result.missingItems).toHaveLength(0);
  });

  it("correctly indicates utility disconnect and reconnect coordination status", () => {
    const coordinatedPermit: ElectricalPermit = {
      ...mockPermit,
      utilityDisconnectRequired: true,
      utilityProvider: "Alectra Utilities",
      utilityMeterNumber: "MTR-88124",
      utilityDisconnectDate: "2026-10-15T08:00:00Z",
      utilityReconnectAuthorizationCode: "ALECTRA-AUTH-99120",
      utilityReconnectDate: "2026-10-15T16:00:00Z",
    };

    const result = evaluateElectricalAcceptance({
      isPermitRequired: true,
      permit: coordinatedPermit,
      deficiencies: [],
    });

    expect(result.customerSummary.utilityDisconnectCoordinated).toBe(true);
  });
});
