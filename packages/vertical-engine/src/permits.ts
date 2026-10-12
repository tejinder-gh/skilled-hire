import type {
  ElectricalAcceptanceEvaluation,
  ElectricalPermit,
  PermitDeficiency,
  RegulatoryAcceptanceDenyCode,
  RegulatorySignOffStatus,
} from "@marketplace/contracts";

export interface EvaluateElectricalAcceptanceInput {
  isPermitRequired: boolean;
  permit: ElectricalPermit | null;
  deficiencies: PermitDeficiency[];
}

/**
 * Evaluates whether electrical work can be labeled fully accepted,
 * strictly distinguishing physical work finished vs legal/regulatory sign-off (#59).
 */
export function evaluateElectricalAcceptance(
  input: EvaluateElectricalAcceptanceInput,
): ElectricalAcceptanceEvaluation {
  const { isPermitRequired, permit, deficiencies } = input;

  if (!isPermitRequired) {
    return {
      canFullyAccept: true,
      regulatorySignOffStatus: "NOT_APPLICABLE",
      workFinished: true,
      regulatorySignOffAchieved: true,
      missingItems: [],
      permit: null,
      deficiencies: [],
      customerSummary: {
        requiresPermit: false,
        permitAuthority: "NONE",
        utilityDisconnectCoordinated: false,
        hasOutstandingDefects: false,
        missingArtifactsText: [],
      },
    };
  }

  // Permit required: verify existence of filed permit
  if (!permit) {
    return {
      canFullyAccept: false,
      regulatorySignOffStatus: "PENDING",
      workFinished: false,
      regulatorySignOffAchieved: false,
      missingItems: ["PERMIT_NOT_FILED"],
      permit: null,
      deficiencies: [],
      customerSummary: {
        requiresPermit: true,
        permitAuthority: "ESA",
        utilityDisconnectCoordinated: false,
        hasOutstandingDefects: false,
        missingArtifactsText: [
          "Mandatory electrical permit/notification has not been filed with the Electrical Safety Authority.",
        ],
      },
    };
  }

  const missingItems: RegulatoryAcceptanceDenyCode[] = [];
  const missingArtifactsText: string[] = [];

  // Check documented exception
  const hasDocumentedException = Boolean(
    permit.documentedExceptionReason &&
      permit.documentedExceptionApprovedByUserId,
  );

  if (hasDocumentedException) {
    return {
      canFullyAccept: true,
      regulatorySignOffStatus: "EXCEPTION_APPROVED",
      workFinished: true,
      regulatorySignOffAchieved: true,
      missingItems: [],
      permit,
      deficiencies,
      customerSummary: {
        requiresPermit: true,
        permitAuthority: permit.permitAuthority,
        esaNotificationNumber: permit.esaNotificationNumber,
        ecraLicenseNumber: permit.ecraLicenseNumber,
        certificateOfAcceptanceNumber: undefined,
        utilityDisconnectCoordinated: permit.utilityDisconnectRequired
          ? Boolean(permit.utilityReconnectAuthorizationCode)
          : false,
        hasOutstandingDefects: false,
        missingArtifactsText: [],
      },
    };
  }

  // Check for unresolved deficiencies (must be CLEARED_BY_INSPECTOR)
  const outstandingDefects = deficiencies.filter(
    (d) => d.status === "OPEN" || d.status === "RECTIFIED",
  );

  if (outstandingDefects.length > 0) {
    missingItems.push("UNRESOLVED_ESA_DEFICIENCIES");
    missingArtifactsText.push(
      `${outstandingDefects.length} outstanding inspector defect notice(s) must be rectified and cleared by an ESA inspector.`,
    );
  }

  // Check for authoritative Certificate of Acceptance
  const hasCertificate = Boolean(
    permit.certificateOfAcceptanceNumber &&
      permit.certificateOfAcceptanceNumber.trim().length >= 5 &&
      (permit.inspectionStatus === "PASSED" ||
        permit.status === "CERTIFICATE_ISSUED"),
  );

  if (!hasCertificate) {
    missingItems.push("MISSING_CERTIFICATE_OF_ACCEPTANCE");
    missingArtifactsText.push(
      "Official ESA Certificate of Acceptance has not been issued for this installation.",
    );
  }

  let computedStatus: RegulatorySignOffStatus = "PENDING";
  if (outstandingDefects.length > 0) {
    computedStatus = "DEFICIENCIES_OUTSTANDING";
  } else if (hasCertificate) {
    computedStatus = "FULLY_ACCEPTED";
  }

  const canFullyAccept = missingItems.length === 0;

  return {
    canFullyAccept,
    regulatorySignOffStatus: computedStatus,
    workFinished: permit.status === "WORK_COMPLETED" || hasCertificate,
    regulatorySignOffAchieved: canFullyAccept,
    missingItems,
    permit,
    deficiencies,
    customerSummary: {
      requiresPermit: true,
      permitAuthority: permit.permitAuthority,
      esaNotificationNumber: permit.esaNotificationNumber,
      ecraLicenseNumber: permit.ecraLicenseNumber,
      certificateOfAcceptanceNumber:
        permit.certificateOfAcceptanceNumber ?? undefined,
      utilityDisconnectCoordinated: permit.utilityDisconnectRequired
        ? Boolean(permit.utilityReconnectAuthorizationCode)
        : false,
      hasOutstandingDefects: outstandingDefects.length > 0,
      missingArtifactsText,
    },
  };
}
