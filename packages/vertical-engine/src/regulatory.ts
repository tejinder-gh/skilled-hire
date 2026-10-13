import type {
  CredentialVerificationRecord,
  RegulatoryEligibilityResult,
  TradeRegulatoryPolicy,
} from "@marketplace/contracts";

export const CANONICAL_TRADE_POLICIES: readonly TradeRegulatoryPolicy[] = [
  // 1. Electrical - Baseline
  {
    id: "pol-elec-on-v1",
    verticalSlug: "electrical",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_ESA_LEC_CONTRACTOR", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_SKILLED_TRADES_309A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:1",
    permitRequired: true,
    inspectionAuthority: "Electrical Safety Authority (ESA / ECRA)",
    legalAuthorityDisclaimer:
      "Electricity Act, 1998, O.Reg 570/05 requires all electrical work to be contracted by an ECRA/ESA Licensed Electrical Contractor and executed by a certified 309A electrician or supervised apprentice.",
    active: true,
  },
  // 1b. Electrical - Panel Service Upgrade (Variant Specific)
  {
    id: "pol-elec-panel-on-v1",
    verticalSlug: "electrical",
    categorySlug: "panel-service",
    variantSlug: "panel-upgrade-200a",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_ESA_LEC_CONTRACTOR", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_SKILLED_TRADES_309A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: false,
    supervisorRatio: "1:1",
    permitRequired: true,
    inspectionAuthority: "Electrical Safety Authority (ESA / ECRA)",
    legalAuthorityDisclaimer:
      "Ontario Electrical Safety Code Rule 2-004 & O.Reg 570/05 require ESA notification and connection authorization for 200A service panel changes. Master or 309A journeyperson required.",
    active: true,
  },
  // 2. Plumbing - Baseline
  {
    id: "pol-plumb-on-v1",
    verticalSlug: "plumbing",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_SKILLED_TRADES_306A", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:1",
    permitRequired: false,
    inspectionAuthority: "Municipal Building / Plumbing Authority",
    legalAuthorityDisclaimer:
      "Building Opportunities in the Skilled Trades Act (BOSTA) mandates that only 306A certified plumbers or registered apprentices under supervision may install or service potable and wastewater plumbing.",
    active: true,
  },
  // 2b. Plumbing - Drain Cleaning (Variant Specific)
  {
    id: "pol-plumb-drain-on-v1",
    verticalSlug: "plumbing",
    categorySlug: "drain-sewer",
    variantSlug: "main-drain-clog",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:1",
    permitRequired: false,
    inspectionAuthority: "Municipal Building / Plumbing Authority",
    legalAuthorityDisclaimer:
      "Mechanical drain augering and camera inspections do not modify fixed potable piping.",
    active: true,
  },
  // 3. HVAC - Baseline
  {
    id: "pol-hvac-on-v1",
    verticalSlug: "hvac",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_TSSA_CONTRACTOR_REG", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_TSSA_GAS_G2", "ON_SKILLED_TRADES_313A", "CA_ODS_REFRIGERANT", "ON_MOL_HEIGHTS", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: false,
    supervisorRatio: "1:1",
    permitRequired: false,
    inspectionAuthority: "Technical Standards and Safety Authority (TSSA)",
    legalAuthorityDisclaimer:
      "TSSA Act Fuel Safety Division & Ontario Reg 215/01 require heating fuels contractor registration and individual TSSA G2/G1 gas certificate plus Skilled Trades Ontario 313A refrigeration mechanics.",
    active: true,
  },
  // 3b. HVAC - Gas Heating & Furnace (Variant Specific)
  {
    id: "pol-hvac-heating-furnace-on-v1",
    verticalSlug: "hvac",
    categorySlug: "heating",
    variantSlug: "furnace-no-heat",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_TSSA_CONTRACTOR_REG", "ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M", "COMMERCIAL_AUTO_1M"],
    technicianMandatoryCodes: ["ON_TSSA_GAS_G2", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: false,
    supervisorRatio: "1:1",
    permitRequired: false,
    inspectionAuthority: "Technical Standards and Safety Authority (TSSA)",
    legalAuthorityDisclaimer:
      "TSSA Act Fuel Safety Division & Ontario Reg 215/01 require heating fuels contractor registration and individual TSSA G2/G1 gas certificate.",
    active: true,
  },
  // 3c. HVAC - Air Quality & Filter Service (Variant Specific)
  {
    id: "pol-hvac-air-quality-on-v1",
    verticalSlug: "hvac",
    categorySlug: "air-quality",
    variantSlug: "hrv-erv-service",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["ON_WSIB_CLEARANCE", "CGL_INSURANCE_2M"],
    technicianMandatoryCodes: ["GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:1",
    permitRequired: false,
    inspectionAuthority: "Ontario Ministry of Labour",
    legalAuthorityDisclaimer:
      "General ventilation and indoor air filter maintenance does not involve fuel or sealed refrigerant circuits.",
    active: true,
  },
  // 4. Roofing - Baseline
  {
    id: "pol-roof-on-v1",
    verticalSlug: "roofing",
    categorySlug: "*",
    variantSlug: "*",
    geography: "ON",
    policyVersion: 1,
    contractorMandatoryCodes: ["CGL_INSURANCE_2M", "ON_WSIB_CLEARANCE", "ROOFING_OPEN_FLAME_INSURANCE"],
    technicianMandatoryCodes: ["ON_MOL_HEIGHTS", "ROOFING_FALL_PROTECTION", "GOVT_PHOTO_ID", "BACKGROUND_CHECK_ANNUAL"],
    apprenticeEligible: true,
    supervisorRatio: "1:2",
    permitRequired: false,
    inspectionAuthority: "Ontario Ministry of Labour, Immigration, Training & Skills",
    legalAuthorityDisclaimer:
      "Occupational Health and Safety Act, O.Reg 297/13 mandates CPO-approved Working at Heights training for all workers at heights.",
    active: true,
  },
];

/**
 * Resolves the most specific matching regulatory policy using a hierarchical waterfall:
 * 1. Exact variant match (vertical + category + variant + geography)
 * 2. Category match (vertical + category + wildcard variant + geography)
 * 3. Trade default match (vertical + wildcard category + wildcard variant + geography)
 */
export function resolveRegulatoryPolicy(
  policies: readonly TradeRegulatoryPolicy[],
  params: {
    verticalSlug: string;
    categorySlug?: string | undefined;
    variantSlug?: string | undefined;
    geography: string;
  },
): TradeRegulatoryPolicy | undefined {
  const matching = policies.filter(
    (p) =>
      p.active &&
      p.verticalSlug.toLowerCase() === params.verticalSlug.toLowerCase() &&
      p.geography.toUpperCase() === params.geography.toUpperCase() &&
      (!params.categorySlug || p.categorySlug === "*" || p.categorySlug.toLowerCase() === params.categorySlug.toLowerCase()) &&
      (!params.variantSlug || p.variantSlug === "*" || p.variantSlug.toLowerCase() === params.variantSlug.toLowerCase()),
  );

  return matching.sort((a, b) => {
    const aVariantScore = params.variantSlug && a.variantSlug.toLowerCase() === params.variantSlug.toLowerCase() ? 2 : 0;
    const bVariantScore = params.variantSlug && b.variantSlug.toLowerCase() === params.variantSlug.toLowerCase() ? 2 : 0;
    const aCatScore = params.categorySlug && a.categorySlug.toLowerCase() === params.categorySlug.toLowerCase() ? 1 : 0;
    const bCatScore = params.categorySlug && b.categorySlug.toLowerCase() === params.categorySlug.toLowerCase() ? 1 : 0;

    const scoreDiff = (bVariantScore + bCatScore) - (aVariantScore + aCatScore);
    if (scoreDiff !== 0) return scoreDiff;
    return b.policyVersion - a.policyVersion;
  })[0];
}

/**
 * Strict fail-closed regulatory eligibility evaluator.
 * Evaluates contractor business authorization and technician trade credentials.
 * Handles duplicate submissions, unverified provenance, expiration, and apprentice supervision.
 */
export function evaluateRegulatoryEligibility(params: {
  policy: TradeRegulatoryPolicy;
  contractorCredentials: readonly CredentialVerificationRecord[];
  technicianCredentials: readonly CredentialVerificationRecord[];
  isApprentice?: boolean | undefined;
  supervisorCredentials?: readonly CredentialVerificationRecord[] | undefined;
  asOfDate?: Date | undefined;
}): RegulatoryEligibilityResult {
  const asOf = params.asOfDate ?? new Date();
  const reasons: string[] = [];
  const contractorDeficiencies: string[] = [];
  const technicianDeficiencies: string[] = [];
  let failClosed = false;

  function evaluateCredentialList(
    mandatoryCodes: readonly string[],
    credentials: readonly CredentialVerificationRecord[],
    level: "CONTRACTOR" | "TECHNICIAN" | "SUPERVISOR",
  ): { ok: boolean; deficiencies: string[] } {
    const deficiencies: string[] = [];

    for (const code of mandatoryCodes) {
      const matching = credentials.filter(
        (c) =>
          c.code.toUpperCase() === code.toUpperCase() &&
          (!c.geography || c.geography === "*" || c.geography.toUpperCase() === params.policy.geography.toUpperCase()),
      );

      if (matching.length === 0) {
        failClosed = true;
        const msg = `Missing mandatory ${level.toLowerCase()} credential: ${code}`;
        reasons.push(msg);
        deficiencies.push(code);
        continue;
      }

      // Check if any matching credential is valid, unexpired, and authoritatively verified
      const validVerified = matching.find(
        (c) =>
          c.status === "VERIFIED" &&
          c.verificationSource !== "SELF_UPLOAD" &&
          Boolean(c.checkedAt) &&
          (!c.expiryDate || new Date(c.expiryDate) >= asOf),
      );

      if (validVerified) {
        continue;
      }

      // None of the submissions are valid; inspect available records for exact failure reason
      failClosed = true;
      deficiencies.push(code);

      const expiredRecord = matching.find((c) => c.expiryDate && new Date(c.expiryDate) < asOf);
      const selfUploadRecord = matching.find((c) => c.verificationSource === "SELF_UPLOAD" || !c.checkedAt);
      const nonVerifiedRecord = matching.find((c) => c.status !== "VERIFIED");

      if (expiredRecord) {
        reasons.push(
          `${level} credential ${code} expired on ${expiredRecord.expiryDate}. Active renewal is required by ${params.policy.inspectionAuthority ?? "regulator"}.`,
        );
      } else if (selfUploadRecord) {
        reasons.push(
          `${level} credential ${code} is self-uploaded and has not been authoritatively verified by regulator registry or compliance audit.`,
        );
      } else if (nonVerifiedRecord) {
        reasons.push(
          `${level} credential ${code} is in status ${nonVerifiedRecord.status} (must be VERIFIED).`,
        );
      } else {
        reasons.push(`Missing valid verified ${level.toLowerCase()} credential: ${code}`);
      }
    }

    return { ok: deficiencies.length === 0, deficiencies };
  }

  // 1. Evaluate Contractor Mandatory Business Authorization
  const contractorEval = evaluateCredentialList(
    params.policy.contractorMandatoryCodes,
    params.contractorCredentials,
    "CONTRACTOR",
  );
  contractorDeficiencies.push(...contractorEval.deficiencies);

  // 2. Evaluate Technician / Apprentice Trade Authorization
  if (params.isApprentice) {
    if (!params.policy.apprenticeEligible) {
      failClosed = true;
      reasons.push(
        `Apprentices are not permitted for ${params.policy.verticalSlug} under ${params.policy.inspectionAuthority ?? "applicable trade regulations"}; work requires a certified journeyperson.`,
      );
      technicianDeficiencies.push("APPRENTICE_NOT_PERMITTED");
    } else if (!params.supervisorCredentials || params.supervisorCredentials.length === 0) {
      failClosed = true;
      reasons.push(
        `Apprentice supervision exception requires a verified supervising journeyperson on file (supervision ratio: ${params.policy.supervisorRatio ?? "1:1"}). No verified supervisor credentials found.`,
      );
      technicianDeficiencies.push("SUPERVISOR_NOT_VERIFIED");
    } else {
      const supervisorEval = evaluateCredentialList(
        params.policy.technicianMandatoryCodes,
        params.supervisorCredentials,
        "SUPERVISOR",
      );
      if (!supervisorEval.ok) {
        failClosed = true;
        reasons.push(
          `Supervising journeyperson does not meet mandatory trade requirements: ${supervisorEval.deficiencies.join(", ")}`,
        );
        technicianDeficiencies.push("SUPERVISOR_DEFICIENT");
      } else {
        reasons.push(
          `Apprentice authorized under direct ${params.policy.supervisorRatio ?? "1:1"} supervision of verified journeyperson.`,
        );
      }
    }
  } else {
    const techEval = evaluateCredentialList(
      params.policy.technicianMandatoryCodes,
      params.technicianCredentials,
      "TECHNICIAN",
    );
    technicianDeficiencies.push(...techEval.deficiencies);
  }

  const eligible = !failClosed;
  if (eligible && !params.isApprentice) {
    reasons.push(
      `Fully verified for ${params.policy.verticalSlug.toUpperCase()} in ${params.policy.geography}. Governed by ${params.policy.inspectionAuthority ?? "statutory regulations"}.`,
    );
  }

  return {
    eligible,
    failClosed,
    reasons,
    contractorDeficiencies,
    technicianDeficiencies,
    requiredPermits: params.policy.permitRequired && params.policy.inspectionAuthority ? [params.policy.inspectionAuthority] : [],
    inspectionAuthority: params.policy.inspectionAuthority ?? null,
    legalAuthorityDisclaimer: params.policy.legalAuthorityDisclaimer,
    policyVersion: params.policy.policyVersion,
    checkedAt: asOf.toISOString(),
  };
}
