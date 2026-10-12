import type {
  ContractorSafetyQuarantine,
  QuarantineScope,
  SafetyActionType,
  SafetyIncident,
  SafetyIncidentSeverity,
  SafetyIncidentStatus,
  SafetyIncidentType,
} from "@marketplace/contracts";

export interface TriageAssessmentResult {
  recommendedSeverity: SafetyIncidentSeverity;
  emergencyEscalation: boolean;
  mandatoryQuarantine: boolean;
  recommendedQuarantineScope: QuarantineScope;
  mandatoryInsurerNotification: boolean;
  mandatoryIndependentReview: boolean;
  remediationInspectionRequired: boolean;
  rationale: string[];
}

export interface EvaluateIncidentTriageParams {
  incidentType: SafetyIncidentType;
  reportedSeverity: SafetyIncidentSeverity;
  contractorId: string;
  technicianId?: string | null | undefined;
  serviceVerticalId?: string | undefined;
  issueTypeId?: string | undefined;
  repeatDefectsCount?: number | undefined;
}

/**
 * Evaluates incident severity triage and determines automated safety containment mandates (#58).
 */
export function evaluateIncidentTriage(
  params: EvaluateIncidentTriageParams,
): TriageAssessmentResult {
  const rationale: string[] = [];
  let emergencyEscalation = false;
  let mandatoryQuarantine = false;
  let mandatoryInsurerNotification = false;
  let mandatoryIndependentReview = false;
  let remediationInspectionRequired = true;

  const isLifeSafetyRisk =
    params.incidentType === "ELECTRICAL_HAZARD_SHOCK" ||
    params.incidentType === "GAS_LEAK_FIRE_RISK" ||
    params.incidentType === "STRUCTURAL_COLLAPSE_RISK" ||
    params.incidentType === "CARBON_MONOXIDE";

  let finalSeverity = params.reportedSeverity;

  // Rule 1: Automatic severity escalation for life-safety risks
  if (isLifeSafetyRisk && finalSeverity !== "CRITICAL_EMERGENCY") {
    finalSeverity = "CRITICAL_EMERGENCY";
    rationale.push(
      `Automated escalation to CRITICAL_EMERGENCY: Incident type '${params.incidentType}' represents an immediate life-safety or structural hazard.`,
    );
  }

  // Rule 2: Critical emergency triggers mandatory quarantine and insurer alert
  if (finalSeverity === "CRITICAL_EMERGENCY") {
    emergencyEscalation = true;
    mandatoryQuarantine = true;
    mandatoryInsurerNotification = true;
    mandatoryIndependentReview = true;
    rationale.push(
      "Mandatory full suspension/quarantine activated pending independent technical root-cause investigation.",
    );
    rationale.push(
      "Insurer notification workflow triggered for commercial general liability claims governance.",
    );
  } else if (finalSeverity === "MAJOR_SAFETY") {
    mandatoryQuarantine = true;
    mandatoryIndependentReview = true;
    rationale.push(
      "Major safety hazard: Scope restriction or suspension required until corrective action plan approved.",
    );
  }

  // Rule 3: Repeat defect escalation
  const repeatDefects = params.repeatDefectsCount ?? 0;
  if (repeatDefects >= 2) {
    mandatoryQuarantine = true;
    rationale.push(
      `Repeat defect threshold triggered (${repeatDefects} prior recorded defects). Mandatory provisional audit supervision required.`,
    );
  }

  const recommendedScope: QuarantineScope = {
    contractorSuspended:
      finalSeverity === "CRITICAL_EMERGENCY" || repeatDefects >= 3,
    technicianSuspended: Boolean(params.technicianId),
    restrictedVerticalIds: params.serviceVerticalId
      ? [params.serviceVerticalId]
      : [],
    restrictedIssueTypeIds: params.issueTypeId ? [params.issueTypeId] : [],
    provisionalAuditRequired: true,
  };

  return {
    recommendedSeverity: finalSeverity,
    emergencyEscalation,
    mandatoryQuarantine,
    recommendedQuarantineScope: recommendedScope,
    mandatoryInsurerNotification,
    mandatoryIndependentReview,
    remediationInspectionRequired,
    rationale,
  };
}

export interface QuarantineGateCheckParams {
  contractorId: string;
  technicianId: string;
  verticalId: string;
  issueTypeId?: string | null | undefined;
  contractorSafetyStatus: string;
  technicianSafetyStatus: string;
  activeQuarantines: readonly {
    quarantineType: string;
    restrictedVerticalIds: string[];
    restrictedIssueTypeIds: string[];
  }[];
}

export interface QuarantineGateResult {
  blocked: boolean;
  reason?: string | undefined;
  denyCode?:
    | "CONTRACTOR_SAFETY_SUSPENDED"
    | "CONTRACTOR_QUARANTINED_SCOPE"
    | "TECHNICIAN_SAFETY_SUSPENDED"
    | undefined;
}

/**
 * Evaluates whether an active safety quarantine blocks dispatch assignment or commencement (#58).
 */
export function evaluateQuarantineGate(
  params: QuarantineGateCheckParams,
): QuarantineGateResult {
  if (params.contractorSafetyStatus === "SUSPENDED") {
    return {
      blocked: true,
      reason: `Contractor '${params.contractorId}' is suspended due to safety sanction.`,
      denyCode: "CONTRACTOR_SAFETY_SUSPENDED",
    };
  }

  if (params.technicianSafetyStatus === "SUSPENDED") {
    return {
      blocked: true,
      reason: `Technician '${params.technicianId}' is suspended due to safety sanction.`,
      denyCode: "TECHNICIAN_SAFETY_SUSPENDED",
    };
  }

  for (const q of params.activeQuarantines) {
    if (q.quarantineType === "FULL_CONTRACTOR_SUSPENSION") {
      return {
        blocked: true,
        reason: "Contractor is subject to an active safety quarantine suspension order.",
        denyCode: "CONTRACTOR_SAFETY_SUSPENDED",
      };
    }
    if (q.quarantineType === "TECHNICIAN_SUSPENSION") {
      return {
        blocked: true,
        reason: "Assigned technician is subject to an active safety quarantine suspension order.",
        denyCode: "TECHNICIAN_SAFETY_SUSPENDED",
      };
    }
    if (q.quarantineType === "VERTICAL_SCOPE_RESTRICTION") {
      const verticalRestricted = q.restrictedVerticalIds.includes(
        params.verticalId,
      );
      const issueRestricted =
        Boolean(params.issueTypeId) &&
        q.restrictedIssueTypeIds.includes(params.issueTypeId!);
      if (verticalRestricted || issueRestricted) {
        return {
          blocked: true,
          reason: `Contractor is safety-restricted from performing work in vertical scope '${params.verticalId}'.`,
          denyCode: "CONTRACTOR_QUARANTINED_SCOPE",
        };
      }
    }
  }

  return { blocked: false };
}
