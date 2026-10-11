import type {
  CredentialVerificationRecord,
  RegulatoryEligibilityResult,
  TradeRegulatoryPolicy,
} from "@marketplace/contracts";

export const CANONICAL_TRADE_POLICIES: readonly TradeRegulatoryPolicy[] = [
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
 * Strict fail-closed regulatory eligibility evaluator.
 * Prevents dispatch of unverified, self-uploaded-only, expired, or non-compliant contractors and technicians.
 */
export function evaluateRegulatoryEligibility(params: {
  policy: TradeRegulatoryPolicy;
  contractorCredentials: readonly CredentialVerificationRecord[];
  technicianCredentials: readonly CredentialVerificationRecord[];
  isApprentice?: boolean | undefined;
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
    level: "CONTRACTOR" | "TECHNICIAN",
  ) {
    for (const code of mandatoryCodes) {
      const match = credentials.find(
        (c) =>
          c.code.toUpperCase() === code.toUpperCase() &&
          (!c.geography || c.geography === "*" || c.geography.toUpperCase() === params.policy.geography.toUpperCase()),
      );

      if (!match) {
        failClosed = true;
        const msg = `Missing mandatory ${level.toLowerCase()} credential: ${code}`;
        reasons.push(msg);
        if (level === "CONTRACTOR") contractorDeficiencies.push(code);
        else technicianDeficiencies.push(code);
        continue;
      }

      // Rule: Self-uploaded documents alone never establish verification
      if (match.verificationSource === "SELF_UPLOAD" || !match.checkedAt) {
        failClosed = true;
        const msg = `${level} credential ${code} is self-uploaded and has not been authoritatively verified by regulator registry or compliance audit.`;
        reasons.push(msg);
        if (level === "CONTRACTOR") contractorDeficiencies.push(code);
        else technicianDeficiencies.push(code);
        continue;
      }

      // Rule: Status must be VERIFIED
      if (match.status !== "VERIFIED") {
        failClosed = true;
        const msg = `${level} credential ${code} is in status ${match.status} (must be VERIFIED).`;
        reasons.push(msg);
        if (level === "CONTRACTOR") contractorDeficiencies.push(code);
        else technicianDeficiencies.push(code);
        continue;
      }

      // Rule: Expired credentials fail closed
      if (match.expiryDate && new Date(match.expiryDate) < asOf) {
        failClosed = true;
        const msg = `${level} credential ${code} expired on ${match.expiryDate}. Active renewal is required by ${params.policy.inspectionAuthority ?? "regulator"}.`;
        reasons.push(msg);
        if (level === "CONTRACTOR") contractorDeficiencies.push(code);
        else technicianDeficiencies.push(code);
        continue;
      }
    }
  }

  // 1. Evaluate Contractor Mandatory Business Authorization
  evaluateCredentialList(params.policy.contractorMandatoryCodes, params.contractorCredentials, "CONTRACTOR");

  // 2. Evaluate Technician Mandatory Trade Authorization
  evaluateCredentialList(params.policy.technicianMandatoryCodes, params.technicianCredentials, "TECHNICIAN");

  const eligible = !failClosed;
  if (eligible) {
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
