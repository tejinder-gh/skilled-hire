import type {
  HazardFlag,
  HazardSeverity,
  JobRiskAssessment,
  MandatoryControlItem,
  ManualApprovalStatus,
  RiskDecisionLog,
  RiskDenyCode,
  RiskEvaluationResult,
  RiskPolicy,
  RiskTier,
} from "@marketplace/contracts";

export interface JobRiskEvaluationInput {
  serviceVariant?: {
    slug?: string | undefined;
    verticalSlug?: string | undefined;
    complexityTier?: string | undefined;
    riskTier?: string | undefined;
    basePriceCents?: number | undefined;
  } | undefined;
  jobDetails?: {
    jobValueCents?: number | undefined;
    propertyAgeYears?: number | undefined;
    isCommercialOrIndustrial?: boolean | undefined;
    heightMeters?: number | undefined;
    confinedSpaceAccess?: boolean | undefined;
    voltageLevelVolts?: number | undefined;
    gasApplianceInvolved?: boolean | undefined;
  } | undefined;
  hazardFlags?: string[] | undefined;
  contractor?: {
    ratingBps?: number | undefined;
    completedJobsCount?: number | undefined;
    tier?: string | undefined;
  } | undefined;
  mitigationFactors?: Array<{
    mitigation: string;
    verified: boolean;
    notes?: string | undefined;
  }> | undefined;
  policy?: RiskPolicy | null | undefined;
  manualApprovalStatus?: ManualApprovalStatus | undefined;
  verifiedControls?: Array<{
    control: string;
    fulfilledAt?: string | null | undefined;
    notes?: string | null | undefined;
    evidenceUrl?: string | null | undefined;
  }> | undefined;
}

const RED_FLAG_HAZARDS: Record<string, { inherentAdd: number; severity: HazardSeverity }> = {
  LIVE_ELECTRICAL_WORK: { inherentAdd: 45, severity: "RED_FLAG" },
  HIGH_VOLTAGE: { inherentAdd: 40, severity: "RED_FLAG" },
  GAS_COMBUSTION: { inherentAdd: 35, severity: "RED_FLAG" },
  STRUCTURAL_LOAD_BEARING: { inherentAdd: 40, severity: "RED_FLAG" },
  HAZARDOUS_MATERIALS_ASBESTOS: { inherentAdd: 45, severity: "RED_FLAG" },
  CONFINED_SPACE: { inherentAdd: 30, severity: "HIGH" },
  WORKING_AT_HEIGHTS: { inherentAdd: 25, severity: "HIGH" },
  WATER_PROXIMITY_ELECTRICAL: { inherentAdd: 30, severity: "HIGH" },
};

const MANDATORY_CONTROLS_MAP: Record<string, { control: string; description: string }> = {
  CRITICAL: {
    control: "SITE_SPECIFIC_SAFETY_PLAN",
    description: "Documented site safety plan required prior to work commencement",
  },
  CRITICAL_SUPERVISOR: {
    control: "SENIOR_SUPERVISOR_ON_SITE",
    description: "Certified senior journeyperson or master on-site supervision",
  },
  HIGH_VOLTAGE: {
    control: "LOCKOUT_TAGOUT_PLAN",
    description: "OSHA/CSA compliant lockout-tagout procedure and breaker padlock",
  },
  HIGH_VOLTAGE_PPE: {
    control: "CAL_RATED_PPE",
    description: "Arc-flash calibrated personal protective equipment",
  },
  CONFINED_SPACE: {
    control: "ATMOSPHERIC_TESTING",
    description: "Pre-entry 4-gas atmospheric meter testing",
  },
  WORKING_AT_HEIGHTS: {
    control: "FALL_ARREST_EQUIPMENT",
    description: "Full body harness and verified anchor point setup",
  },
  LIVE_ELECTRICAL_WORK: {
    control: "TWO_PERSON_CREW",
    description: "Mandatory 2-person crew with certified CPR/first-aid second technician",
  },
};

/**
 * Deterministically evaluates inherent and residual risk scores, assigns risk tiers,
 * identifies red-flag triggers, mandates safety controls, and compiles an explainable decision log (#60).
 */
export function evaluateJobRisk(input: JobRiskEvaluationInput): RiskEvaluationResult {
  const {
    serviceVariant,
    jobDetails,
    hazardFlags: rawFlags = [],
    contractor,
    mitigationFactors = [],
    manualApprovalStatus = "NOT_REQUIRED",
    verifiedControls = [],
  } = input;

  // 1. Identify baseline inherent score
  let baseScore = 20;
  const vertical = serviceVariant?.verticalSlug?.toLowerCase() ?? "";
  if (vertical === "electrical" || vertical === "roofing" || vertical === "hvac") {
    baseScore = 35;
  } else if (vertical === "structural" || vertical === "gas") {
    baseScore = 45;
  } else if (vertical === "plumbing") {
    baseScore = 15;
  }

  // 2. Complexity adjustment (safe unknown-input defaults to highest caution)
  let complexityAdjustment = 0;
  const complexity = serviceVariant?.complexityTier ?? "UNKNOWN";
  if (complexity === "TIER_1_STANDARD") {
    complexityAdjustment = 5;
  } else if (complexity === "TIER_2_INTERMEDIATE") {
    complexityAdjustment = 15;
  } else if (complexity === "TIER_3_ADVANCED" || complexity === "UNKNOWN") {
    complexityAdjustment = 25;
  }

  // 3. Value ceiling adjustment
  let valueAdjustment = 0;
  const valueCents = jobDetails?.jobValueCents ?? serviceVariant?.basePriceCents ?? 0;
  if (valueCents > 1000000) {
    valueAdjustment = 15;
  } else if (valueCents > 500000) {
    valueAdjustment = 10;
  } else if (valueCents > 150000) {
    valueAdjustment = 5;
  }

  // 4. Property characteristics adjustment
  let propertyAdjustment = 0;
  if (jobDetails?.isCommercialOrIndustrial) {
    propertyAdjustment += 15;
  }
  if (jobDetails?.propertyAgeYears && jobDetails.propertyAgeYears > 50) {
    propertyAdjustment += 10;
  } else if (jobDetails?.propertyAgeYears && jobDetails.propertyAgeYears > 25) {
    propertyAdjustment += 5;
  }

  // 5. Aggregate active hazard flags
  const activeFlags = new Set<string>();
  for (const flag of rawFlags) {
    if (flag) activeFlags.add(flag);
  }

  // Infer automatic flags from physical characteristics
  if (jobDetails?.heightMeters && jobDetails.heightMeters >= 3) {
    activeFlags.add("WORKING_AT_HEIGHTS");
  }
  if (jobDetails?.confinedSpaceAccess) {
    activeFlags.add("CONFINED_SPACE");
  }
  if (jobDetails?.voltageLevelVolts && jobDetails.voltageLevelVolts >= 240) {
    activeFlags.add("HIGH_VOLTAGE");
  }
  if (jobDetails?.gasApplianceInvolved) {
    activeFlags.add("GAS_COMBUSTION");
  }

  const hazardFlagAdjustments: Array<{
    flag: string;
    add: number;
    severity: string;
    reason: string;
  }> = [];

  let redFlagTriggered = false;
  const triggerReasons: string[] = [];

  for (const flag of activeFlags) {
    const config = RED_FLAG_HAZARDS[flag];
    if (config) {
      hazardFlagAdjustments.push({
        flag,
        add: config.inherentAdd,
        severity: config.severity,
        reason: `Hazard flag ${flag} adds ${config.inherentAdd} to inherent risk score`,
      });
      if (config.severity === "RED_FLAG") {
        redFlagTriggered = true;
        triggerReasons.push(`Critical red-flag hazard detected: ${flag}`);
      }
    } else {
      // Safe unknown-input behavior: default unknown hazard flag to high severity
      hazardFlagAdjustments.push({
        flag,
        add: 25,
        severity: "HIGH",
        reason: `Unrecognized hazard flag ${flag} evaluated conservatively at +25`,
      });
    }
  }

  const hazardAddTotal = hazardFlagAdjustments.reduce((sum, h) => sum + h.add, 0);

  // Total inherent score clamped to 0-100
  const rawInherent =
    baseScore + complexityAdjustment + valueAdjustment + propertyAdjustment + hazardAddTotal;
  const inherentScore = Math.min(100, Math.max(0, rawInherent));

  // 6. Mitigations deduction
  const mitigationsApplied: Array<{
    mitigation: string;
    deduction: number;
    verified: boolean;
  }> = [];

  let mitigationsTotal = 0;
  for (const factor of mitigationFactors) {
    if (!factor.verified) continue;
    let deduction = 0;
    if (factor.mitigation === "LICENSED_MASTER_SUPERVISOR") deduction = 15;
    else if (factor.mitigation === "DUAL_CERTIFIED_TECHNICIAN_CREW") deduction = 15;
    else if (factor.mitigation === "CALIBRATED_SAFETY_EQUIPMENT_CHECKLIST") deduction = 10;
    else if (factor.mitigation === "PRE_JOB_UTILITY_DISCONNECT_VERIFIED") deduction = 10;
    else if (factor.mitigation === "CONTRACTOR_SAFETY_EXCELLENCE") deduction = 10;
    else deduction = 5;

    mitigationsTotal += deduction;
    mitigationsApplied.push({
      mitigation: factor.mitigation,
      deduction,
      verified: true,
    });
  }

  // Contractor track record bonus deduction
  if (
    contractor &&
    (contractor.ratingBps ?? 0) >= 4800 &&
    (contractor.completedJobsCount ?? 0) >= 20
  ) {
    const trackRecordDeduction = 5;
    mitigationsTotal += trackRecordDeduction;
    mitigationsApplied.push({
      mitigation: "VERIFIED_TRACK_RECORD_EXCELLENCE",
      deduction: trackRecordDeduction,
      verified: true,
    });
  }

  // Mitigation credit capped at 40 points to prevent bypassing core risks
  const mitigationsScore = Math.min(40, mitigationsTotal);

  // Residual score
  let residualScore = Math.max(0, inherentScore - mitigationsScore);

  // 7. Tier calculation
  let calculatedTier: RiskTier = "LOW";
  if (residualScore <= 25) {
    calculatedTier = "LOW";
  } else if (residualScore <= 55) {
    calculatedTier = "MODERATE";
  } else if (residualScore <= 80) {
    calculatedTier = "HIGH";
  } else {
    calculatedTier = "CRITICAL";
  }

  // RED-FLAG OVERRIDE: Any red-flag hazard automatically elevates tier to CRITICAL
  // and mandates manual safety officer review before dispatch
  let requiresManualApproval = false;
  if (redFlagTriggered || calculatedTier === "CRITICAL") {
    calculatedTier = "CRITICAL";
    requiresManualApproval = true;
    if (!triggerReasons.includes("Tier is CRITICAL requiring manual review")) {
      triggerReasons.push("Critical risk score requires mandatory manual operations sign-off");
    }
  }

  // 8. Mandatory safety controls compilation
  const mandatoryControls: MandatoryControlItem[] = [];
  const controlsMandatedSet = new Set<string>();

  function addControl(key: string, ctrlDef: { control: string; description: string }) {
    if (!controlsMandatedSet.has(ctrlDef.control)) {
      controlsMandatedSet.add(ctrlDef.control);
      const verified = verifiedControls.find((v) => v.control === ctrlDef.control);
      mandatoryControls.push({
        control: ctrlDef.control,
        description: ctrlDef.description,
        requiredFor: key,
        fulfilled: Boolean(verified),
        fulfilledAt: verified?.fulfilledAt ?? null,
        notes: verified?.notes ?? null,
        evidenceUrl: verified?.evidenceUrl ?? null,
      });
    }
  }

  if (calculatedTier === "CRITICAL") {
    addControl("CRITICAL", MANDATORY_CONTROLS_MAP.CRITICAL!);
    addControl("CRITICAL", MANDATORY_CONTROLS_MAP.CRITICAL_SUPERVISOR!);
  }

  if (activeFlags.has("HIGH_VOLTAGE")) {
    addControl("HIGH_VOLTAGE", MANDATORY_CONTROLS_MAP.HIGH_VOLTAGE!);
    addControl("HIGH_VOLTAGE", MANDATORY_CONTROLS_MAP.HIGH_VOLTAGE_PPE!);
  }
  if (activeFlags.has("CONFINED_SPACE")) {
    addControl("CONFINED_SPACE", MANDATORY_CONTROLS_MAP.CONFINED_SPACE!);
  }
  if (activeFlags.has("WORKING_AT_HEIGHTS")) {
    addControl("WORKING_AT_HEIGHTS", MANDATORY_CONTROLS_MAP.WORKING_AT_HEIGHTS!);
  }
  if (activeFlags.has("LIVE_ELECTRICAL_WORK")) {
    addControl("LIVE_ELECTRICAL_WORK", MANDATORY_CONTROLS_MAP.LIVE_ELECTRICAL_WORK!);
  }

  // 9. Gate check: can job be dispatched?
  const denyCodes: RiskDenyCode[] = [];
  const unfulfilledControls: string[] = [];

  for (const ctrl of mandatoryControls) {
    if (!ctrl.fulfilled) {
      unfulfilledControls.push(ctrl.control);
    }
  }

  if (unfulfilledControls.length > 0) {
    denyCodes.push("UNFULFILLED_MANDATORY_SAFETY_CONTROLS");
  }

  if (requiresManualApproval) {
    if (manualApprovalStatus !== "APPROVED") {
      denyCodes.push("CRITICAL_RISK_MANUAL_APPROVAL_REQUIRED");
    }
  }

  const canDispatch = denyCodes.length === 0;

  const decisionLog: RiskDecisionLog = {
    baseScore,
    complexityAdjustment,
    valueAdjustment,
    hazardFlagAdjustments,
    totalInherent: inherentScore,
    mitigationsApplied,
    totalMitigations: mitigationsScore,
    residualScore,
    calculatedTier,
    redFlagTriggered,
    triggerReasons,
    mandatoryControlsMandated: Array.from(controlsMandatedSet),
  };

  return {
    canDispatch,
    riskTier: calculatedTier,
    inherentScore,
    mitigationsScore,
    residualScore,
    hazardFlags: Array.from(activeFlags) as HazardFlag[],
    mandatoryControls,
    unfulfilledControls,
    requiresManualApproval,
    manualApprovalStatus,
    denyCodes,
    decisionLog,
  };
}
