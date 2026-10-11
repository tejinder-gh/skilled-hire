import type {
  ComplianceGroupSummary,
  ComplianceScorecard,
  ComplianceStandard,
  CredentialGroup,
  CredentialRequirement,
  EntityLevel,
  PaymentRule,
  StandardEvaluationItem,
  StandardItemStatus,
  SubmittedCredentialInput,
  VerticalConfig,
} from "@marketplace/contracts";

export * from "./catalog.js";
export * from "./regulatory.js";

export function validateVerticalConfig(config: VerticalConfig): void {
  const categoryIds = new Set(
    config.serviceCategories.map((category) => category.id),
  );
  if (
    new Set(config.serviceCategories.map((category) => category.slug)).size !==
    config.serviceCategories.length
  ) {
    throw new Error("Service category slugs must be unique per vertical");
  }
  for (const issue of config.issueTypes) {
    if (!categoryIds.has(issue.categoryId))
      throw new Error(`Issue ${issue.id} references an unknown category`);
  }
}

export function requiredCredentials(
  requirements: readonly CredentialRequirement[],
  geography: string,
): readonly CredentialRequirement[] {
  return requirements.filter(
    (requirement) =>
      requirement.geography === geography || requirement.geography === "*",
  );
}

export function selectPaymentRule(
  rules: readonly PaymentRule[],
  verticalId: string,
  totalCents: number,
): PaymentRule {
  const rule = rules.find(
    (candidate) =>
      candidate.verticalId === verticalId &&
      totalCents >= candidate.minAmountCents &&
      (candidate.maxAmountCents === null ||
        totalCents <= candidate.maxAmountCents),
  );
  if (!rule) throw new Error("No payment rule covers this quote total");
  const bps = rule.milestones.reduce(
    (sum, milestone) => sum + milestone.percentageBps,
    0,
  );
  if (bps !== 10_000)
    throw new Error("Payment rule milestones must total 100% ");
  return rule;
}

export const CREDENTIAL_GROUPS: readonly CredentialGroup[] = [
  {
    code: "TRADE_LICENSING",
    name: "Trade & Professional Licensing",
    description:
      "Occupational trade certificates, journeyperson cards, master licenses, and statutory contractor board authorizations.",
    displayOrder: 1,
    icon: "badge-check",
  },
  {
    code: "ENVIRONMENTAL_HAZARDOUS",
    name: "Environmental & Hazardous Materials",
    description:
      "Federal and state/provincial environmental protection compliance including EPA refrigerants, ODS, and hazardous material management.",
    displayOrder: 2,
    icon: "leaf",
  },
  {
    code: "INSURANCE_FINANCIAL",
    name: "Insurance, Bonding & Financial Security",
    description:
      "Commercial general liability, workers compensation clearance certificates, commercial auto insurance, and statutory surety bonds.",
    displayOrder: 3,
    icon: "shield-check",
  },
  {
    code: "HEALTH_SAFETY",
    name: "Occupational Health & Site Safety",
    description:
      "Worker and jobsite safety certifications including fall protection/working at heights, OSHA construction safety, and emergency response.",
    displayOrder: 4,
    icon: "hard-hat",
  },
  {
    code: "STATUTORY_REGISTRATION",
    name: "Statutory Business & Municipal Registration",
    description:
      "Corporate entity registration, municipal business licensing, and technical safety authority contractor licenses in good standing.",
    displayOrder: 5,
    icon: "building",
  },
  {
    code: "TRUST_IDENTITY",
    name: "Trust, Safety & Identity Verification",
    description:
      "Identity validation, annual criminal background screening with vulnerable sector checks, and clean driving abstracts.",
    displayOrder: 6,
    icon: "user-check",
  },
];

export const DEFAULT_COMPLIANCE_STANDARDS: readonly ComplianceStandard[] = [
  // HVAC - Ontario (Canada)
  {
    id: "std-hvac-on-g2",
    groupCode: "TRADE_LICENSING",
    credentialCode: "ON_TSSA_GAS_G2",
    name: "TSSA Gas Technician 2 (G2) or G1",
    description:
      "Required to install, inspect, and service residential & commercial natural gas and propane heating systems.",
    verticalSlug: "hvac",
    geography: "ON",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Technical Standards and Safety Authority (TSSA)",
    legalReference: "Technical Standards and Safety Act, O.Reg 215/01",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 36,
    active: true,
  },
  {
    id: "std-hvac-on-313a",
    groupCode: "TRADE_LICENSING",
    credentialCode: "ON_SKILLED_TRADES_313A",
    name: "313A Refrigeration & Air Conditioning Systems Mechanic",
    description:
      "Mandatory certificate of qualification to install, test, and repair refrigeration and air conditioning systems.",
    verticalSlug: "hvac",
    geography: "ON",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Skilled Trades Ontario",
    legalReference: "Building Opportunities in the Skilled Trades Act (BOSTA)",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 36,
    active: true,
  },
  {
    id: "std-hvac-on-ods",
    groupCode: "ENVIRONMENTAL_HAZARDOUS",
    credentialCode: "CA_ODS_REFRIGERANT",
    name: "ODS Environmental Refrigerant Handling Certificate",
    description:
      "Environmental certificate for handling ozone-depleting substances and fluorocarbon refrigerants.",
    verticalSlug: "hvac",
    geography: "ON",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority:
      "Heating, Refrigeration and Air Conditioning Institute (HRAI) / MOECC",
    legalReference: "Ontario Reg 463/10",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 60,
    active: true,
  },
  {
    id: "std-hvac-on-tssa-reg",
    groupCode: "STATUTORY_REGISTRATION",
    credentialCode: "ON_TSSA_CONTRACTOR_REG",
    name: "TSSA Heating Fuels Contractor Registration",
    description:
      "Mandatory annual business registration for companies performing heating fuel installation and maintenance.",
    verticalSlug: "hvac",
    geography: "ON",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Technical Standards and Safety Authority (TSSA)",
    legalReference: "TSSA Act Fuel Safety Division",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-hvac-on-wsib",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "ON_WSIB_CLEARANCE",
    name: "WSIB Clearance Certificate",
    description:
      "Mandatory clearance certificate verifying active registration and compliance with Ontario workers injury insurance.",
    verticalSlug: "hvac",
    geography: "ON",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Workplace Safety and Insurance Board (WSIB)",
    legalReference: "Workplace Safety and Insurance Act, Section 141",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 3,
    active: true,
  },
  {
    id: "std-hvac-on-heights",
    groupCode: "HEALTH_SAFETY",
    credentialCode: "ON_MOL_HEIGHTS",
    name: "Working at Heights Training (CPO Approved)",
    description:
      "Chief Prevention Officer approved fall protection training required for rooftop and elevated service work.",
    verticalSlug: "hvac",
    geography: "ON",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority:
      "Ontario Ministry of Labour, Immigration, Training & Skills",
    legalReference: "Occupational Health and Safety Act, O.Reg 297/13",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 36,
    active: true,
  },

  // HVAC - California (USA)
  {
    id: "std-hvac-ca-c20",
    groupCode: "TRADE_LICENSING",
    credentialCode: "CA_CSLB_C20",
    name: "CSLB Class C-20 Warm-Air Heating, Ventilating & AC",
    description:
      "Mandatory California specialty contractor license to install, maintain, or repair HVAC systems.",
    verticalSlug: "hvac",
    geography: "CA",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "California Contractors State License Board (CSLB)",
    legalReference: "California Business and Professions Code § 7058",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 24,
    active: true,
  },
  {
    id: "std-hvac-ca-epa608",
    groupCode: "ENVIRONMENTAL_HAZARDOUS",
    credentialCode: "US_EPA_608_UNIVERSAL",
    name: "EPA Section 608 Universal Refrigerant Certification",
    description:
      "Federal Clean Air Act mandatory certification for servicing stationary refrigeration equipment.",
    verticalSlug: "hvac",
    geography: "CA",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "US Environmental Protection Agency (EPA)",
    legalReference: "Clean Air Act Section 608 (40 CFR Part 82)",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: null,
    active: true,
  },
  {
    id: "std-hvac-ca-bond",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "CA_CSLB_SURETY_BOND",
    name: "CSLB Contractor License Surety Bond ($25,000)",
    description:
      "Statutory performance and compliance bond deposited with the California State License Board.",
    verticalSlug: "hvac",
    geography: "CA",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Licensed California Surety Underwriter",
    legalReference: "California Business and Professions Code § 7071.6",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-hvac-ca-wc",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "CA_WORKERS_COMP",
    name: "California Workers Compensation Insurance Certificate",
    description:
      "Statutory workers compensation insurance covering all field technicians and apprentices.",
    verticalSlug: "hvac",
    geography: "CA",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "California Department of Industrial Relations (DIR)",
    legalReference: "California Labor Code § 3700",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-hvac-ca-osha10",
    groupCode: "HEALTH_SAFETY",
    credentialCode: "US_OSHA_10_CONST",
    name: "OSHA 10-Hour Construction Safety Card",
    description:
      "Comprehensive occupational construction safety training covering jobsite hazard mitigation.",
    verticalSlug: "hvac",
    geography: "CA",
    entityLevel: "TECHNICIAN",
    requirementLevel: "RECOMMENDED",
    issuingAuthority: "Occupational Safety and Health Administration (OSHA)",
    legalReference: "29 CFR 1926 Safety and Health Regulations",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: null,
    active: true,
  },

  // HVAC - Texas (USA)
  {
    id: "std-hvac-tx-tdlr",
    groupCode: "TRADE_LICENSING",
    credentialCode: "TX_TDLR_ACR_CLASS_A",
    name: "TDLR Air Conditioning & Refrigeration Contractor (Class A/B)",
    description:
      "State license authorizing environmental air conditioning, commercial refrigeration, and process cooling/heating.",
    verticalSlug: "hvac",
    geography: "TX",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Texas Department of Licensing and Regulation (TDLR)",
    legalReference: "Texas Occupations Code Chapter 1302",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-hvac-tx-epa608",
    groupCode: "ENVIRONMENTAL_HAZARDOUS",
    credentialCode: "US_EPA_608_UNIVERSAL",
    name: "EPA Section 608 Universal Refrigerant Certification",
    description:
      "Federal Clean Air Act mandatory certification for servicing stationary refrigeration equipment.",
    verticalSlug: "hvac",
    geography: "TX",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "US Environmental Protection Agency (EPA)",
    legalReference: "Clean Air Act Section 608",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: null,
    active: true,
  },
  {
    id: "std-hvac-tx-ins",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "TX_TDLR_INSURANCE",
    name: "TDLR Commercial Liability Insurance Certificate",
    description:
      "State-mandated commercial liability insurance on file with the licensing authority.",
    verticalSlug: "hvac",
    geography: "TX",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Texas Department of Insurance / TDLR",
    legalReference: "16 TAC § 75.40 Insurance Requirements",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },

  // HVAC - British Columbia (Canada)
  {
    id: "std-hvac-bc-gas",
    groupCode: "TRADE_LICENSING",
    credentialCode: "BC_TECH_SAFETY_GAS_A_B",
    name: "Technical Safety BC Gas Fitter Certificate Class A/B",
    description:
      "Provincial authorization to install, test, service, and alter gas equipment and heating systems.",
    verticalSlug: "hvac",
    geography: "BC",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Technical Safety BC",
    legalReference: "Safety Standards Act & Gas Safety Regulation",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 36,
    active: true,
  },
  {
    id: "std-hvac-bc-worksafe",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "BC_WORKSAFE_CLEARANCE",
    name: "WorkSafeBC Clearance Letter",
    description:
      "Statutory proof of active registration and good standing with WorkSafeBC.",
    verticalSlug: "hvac",
    geography: "BC",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "WorkSafeBC",
    legalReference: "Workers Compensation Act Part 5",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 3,
    active: true,
  },

  // Universal Standards (Cross-Vertical & Cross-Location)
  {
    id: "std-univ-cgl-2m",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "CGL_INSURANCE_2M",
    name: "Commercial General Liability Insurance ($2,000,000 Min)",
    description:
      "Active policy protecting consumers against third-party bodily injury, property damage, and completed operations.",
    verticalSlug: "*",
    geography: "*",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Recognized Commercial Insurance Carrier",
    legalReference: "Standard Field Services Marketplace Carrier Policy",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-univ-comm-auto",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "COMMERCIAL_AUTO_1M",
    name: "Commercial Auto Fleet Liability Insurance ($1,000,000)",
    description:
      "Coverage for service vans, trucks, and equipment transports traveling to residential job sites.",
    verticalSlug: "*",
    geography: "*",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Recognized Commercial Auto Underwriter",
    legalReference: "Fleet Insurance Policy Standard",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-univ-photo-id",
    groupCode: "TRUST_IDENTITY",
    credentialCode: "GOVT_PHOTO_ID",
    name: "Government-Issued Photo Identification",
    description:
      "Official government driver license or passport verifying identity of all dispatched field technicians.",
    verticalSlug: "*",
    geography: "*",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "State / Provincial Licensing Authority",
    legalReference: "Marketplace Identity Verification Standard",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: null,
    active: true,
  },
  {
    id: "std-univ-bg-check",
    groupCode: "TRUST_IDENTITY",
    credentialCode: "BACKGROUND_CHECK_ANNUAL",
    name: "Annual Criminal Background & Judicial Check",
    description:
      "Clean background screening with vulnerable sector verification completed within past 12 months.",
    verticalSlug: "*",
    geography: "*",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority:
      "Accredited Background Screening Partner / Police Service",
    legalReference: "Residential Trust & Safety Policy",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-univ-first-aid",
    groupCode: "HEALTH_SAFETY",
    credentialCode: "FIRST_AID_CPR_C",
    name: "Standard First Aid & CPR Level C (AED)",
    description:
      "Accredited basic life support and emergency trauma response training.",
    verticalSlug: "*",
    geography: "*",
    entityLevel: "TECHNICIAN",
    requirementLevel: "RECOMMENDED",
    issuingAuthority: "Red Cross / St. John Ambulance / AHA",
    legalReference: "Workplace Safety Guidelines",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 36,
    active: true,
  },

  // Plumbing Standards
  {
    id: "std-plumb-on-306a",
    groupCode: "TRADE_LICENSING",
    credentialCode: "ON_SKILLED_TRADES_306A",
    name: "306A Plumber Certificate of Qualification",
    description:
      "Mandatory trade qualification for installing, repairing, and maintaining water supply and drainage systems.",
    verticalSlug: "plumbing",
    geography: "ON",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Skilled Trades Ontario",
    legalReference: "Building Opportunities in the Skilled Trades Act",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 36,
    active: true,
  },
  {
    id: "std-plumb-ca-c36",
    groupCode: "TRADE_LICENSING",
    credentialCode: "CA_CSLB_C36",
    name: "CSLB Class C-36 Plumbing Contractor License",
    description:
      "California contractor license authorizing water supply, sewer, and gas line service.",
    verticalSlug: "plumbing",
    geography: "CA",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "California Contractors State License Board",
    legalReference: "California B&P Code § 7058",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 24,
    active: true,
  },

  // Electrical Standards
  {
    id: "std-elec-on-lec",
    groupCode: "TRADE_LICENSING",
    credentialCode: "ON_ESA_LEC_CONTRACTOR",
    name: "ESA Licensed Electrical Contractor (LEC)",
    description:
      "Statutory license required to operate an electrical contracting business and pull permits in Ontario.",
    verticalSlug: "electrical",
    geography: "ON",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Electrical Safety Authority (ESA / ECRA)",
    legalReference: "Electricity Act, 1998, O.Reg 570/05",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 12,
    active: true,
  },
  {
    id: "std-elec-on-309a",
    groupCode: "TRADE_LICENSING",
    credentialCode: "ON_SKILLED_TRADES_309A",
    name: "309A Electrician - Construction and Maintenance",
    description:
      "Certificate of qualification permitting installation and maintenance of electrical systems in buildings.",
    verticalSlug: "electrical",
    geography: "ON",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Skilled Trades Ontario",
    legalReference: "BOSTA Act 2021",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 36,
    active: true,
  },
  {
    id: "std-elec-ca-c10",
    groupCode: "TRADE_LICENSING",
    credentialCode: "CA_CSLB_C10",
    name: "CSLB Class C-10 Electrical Contractor License",
    description:
      "California license to install, maintain, and connect electrical wires, conduits, apparatus, and fixtures.",
    verticalSlug: "electrical",
    geography: "CA",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "California Contractors State License Board",
    legalReference: "California B&P Code § 7058",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 24,
    active: true,
  },

  // Roofing Standards
  {
    id: "std-roof-fall-prot",
    groupCode: "HEALTH_SAFETY",
    credentialCode: "ROOFING_FALL_PROTECTION",
    name: "Comprehensive Fall Protection & Rescue Certification",
    description:
      "Mandatory safety protocol training for high-angle roofing operations.",
    verticalSlug: "roofing",
    geography: "*",
    entityLevel: "TECHNICIAN",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Accredited Safety Training Institute",
    legalReference: "OSHA 1926 Subpart M / Provincial Safety Regs",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 36,
    active: true,
  },
  {
    id: "std-roof-ca-c39",
    groupCode: "TRADE_LICENSING",
    credentialCode: "CA_CSLB_C39",
    name: "CSLB Class C-39 Roofing Contractor License",
    description:
      "California specialty contractor license for installation and repair of all roof coverings.",
    verticalSlug: "roofing",
    geography: "CA",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "California Contractors State License Board",
    legalReference: "California B&P Code § 7058",
    verificationMethod: "REGISTRY_API",
    validityPeriodMonths: 24,
    active: true,
  },
  {
    id: "std-roof-open-flame",
    groupCode: "INSURANCE_FINANCIAL",
    credentialCode: "ROOFING_OPEN_FLAME_INSURANCE",
    name: "CGL Open Flame / Hot-Tar Endorsement ($3,000,000)",
    description:
      "Specific insurance endorsement covering torch-applied roofing systems and fire liability.",
    verticalSlug: "roofing",
    geography: "*",
    entityLevel: "CONTRACTOR",
    requirementLevel: "MANDATORY",
    issuingAuthority: "Commercial Insurance Underwriter",
    legalReference: "Roofing Specialty Policy Terms",
    verificationMethod: "DOCUMENT_UPLOAD",
    validityPeriodMonths: 12,
    active: true,
  },
];

export function filterComplianceStandards(
  standards: readonly ComplianceStandard[],
  verticalSlug: string,
  geography: string,
  entityLevel?: EntityLevel,
): ComplianceStandard[] {
  return standards.filter((standard) => {
    if (!standard.active) return false;
    const matchesVertical =
      standard.verticalSlug === "*" ||
      standard.verticalSlug.toLowerCase() === verticalSlug.toLowerCase();
    const matchesGeography =
      standard.geography === "*" ||
      standard.geography.toUpperCase() === geography.toUpperCase();
    const matchesEntity =
      !entityLevel ||
      entityLevel === "EITHER" ||
      standard.entityLevel === "EITHER" ||
      standard.entityLevel === entityLevel;
    return matchesVertical && matchesGeography && matchesEntity;
  });
}

export function evaluateCompliance(
  applicableStandards: readonly ComplianceStandard[],
  submittedCredentials: readonly SubmittedCredentialInput[],
  options: {
    verticalSlug: string;
    geography: string;
    entityLevel?: EntityLevel | undefined;
    asOfDate?: Date | undefined;
  },
): ComplianceScorecard {
  const asOfDate = options.asOfDate ?? new Date();
  const evaluationItems: StandardEvaluationItem[] = [];
  const missingMandatoryCodes: string[] = [];
  const actionItems: string[] = [];

  for (const standard of applicableStandards) {
    const matched = submittedCredentials.find((cred) => {
      const codeMatch =
        cred.code.toUpperCase() === standard.credentialCode.toUpperCase();
      const geoMatch =
        !cred.geography ||
        cred.geography === "*" ||
        cred.geography.toUpperCase() === standard.geography.toUpperCase();
      return codeMatch && geoMatch;
    });

    if (!matched) {
      const status: StandardItemStatus = "FAIL_MISSING";
      const reason = `Missing required document/license. Regulated by ${standard.issuingAuthority}.`;
      evaluationItems.push({ standard, status, reason });
      if (standard.requirementLevel === "MANDATORY") {
        missingMandatoryCodes.push(standard.credentialCode);
        actionItems.push(
          `Acquire or upload ${standard.name} (${standard.issuingAuthority})`,
        );
      }
      continue;
    }

    const credStatus = matched.status ?? "PENDING";
    if (credStatus === "VERIFIED") {
      if (matched.expiryDate && new Date(matched.expiryDate) < asOfDate) {
        const reason = `Expired on ${matched.expiryDate}. Current renewal required.`;
        evaluationItems.push({
          standard,
          matchedCredential: { ...matched, status: credStatus },
          status: "FAIL_EXPIRED",
          reason,
        });
        if (standard.requirementLevel === "MANDATORY") {
          missingMandatoryCodes.push(standard.credentialCode);
          actionItems.push(
            `Renew expired ${standard.name} (expired ${matched.expiryDate})`,
          );
        }
      } else {
        evaluationItems.push({
          standard,
          matchedCredential: { ...matched, status: credStatus },
          status: "PASS",
          reason: "Verified and currently in good standing.",
        });
      }
    } else if (credStatus === "PENDING") {
      evaluationItems.push({
        standard,
        matchedCredential: { ...matched, status: credStatus },
        status: "FAIL_PENDING",
        reason: "Document submitted; pending platform compliance audit.",
      });
      if (standard.requirementLevel === "MANDATORY") {
        actionItems.push(`Pending verification: ${standard.name}`);
      }
    } else {
      evaluationItems.push({
        standard,
        matchedCredential: { ...matched, status: credStatus },
        status: "FAIL_REJECTED",
        reason: `Credential is marked ${credStatus.toLowerCase()}. Re-submission required.`,
      });
      if (standard.requirementLevel === "MANDATORY") {
        missingMandatoryCodes.push(standard.credentialCode);
        actionItems.push(`Re-submit rejected credential for ${standard.name}`);
      }
    }
  }

  // Group summary mapping
  const groupMap = new Map<string, StandardEvaluationItem[]>();
  for (const item of evaluationItems) {
    const list = groupMap.get(item.standard.groupCode) ?? [];
    list.push(item);
    groupMap.set(item.standard.groupCode, list);
  }

  const groups: ComplianceGroupSummary[] = CREDENTIAL_GROUPS.map((group) => {
    const items = groupMap.get(group.code) ?? [];
    const totalRequired = items.filter(
      (i) => i.standard.requirementLevel === "MANDATORY",
    ).length;
    const passed = items.filter((i) => i.status === "PASS").length;
    const hasFails = items.some(
      (i) =>
        i.standard.requirementLevel === "MANDATORY" &&
        (i.status === "FAIL_MISSING" ||
          i.status === "FAIL_EXPIRED" ||
          i.status === "FAIL_REJECTED"),
    );
    const hasPending = items.some((i) => i.status === "FAIL_PENDING");

    return {
      groupCode: group.code,
      groupName: group.name,
      icon: group.icon,
      totalRequired,
      passed,
      status: (hasFails ? "FAIL" : hasPending ? "PENDING" : "PASS") as
        "PASS" | "FAIL" | "PENDING",
      items,
    };
  }).filter((group) => group.items.length > 0);

  const mandatoryStandards = evaluationItems.filter(
    (i) => i.standard.requirementLevel === "MANDATORY",
  );
  const mandatoryPassed = mandatoryStandards.filter(
    (i) => i.status === "PASS",
  ).length;
  const recommendedStandards = evaluationItems.filter(
    (i) => i.standard.requirementLevel === "RECOMMENDED",
  );
  const recommendedPassed = recommendedStandards.filter(
    (i) => i.status === "PASS",
  ).length;

  // Score in basis points: Mandatory is 80%, Recommended is 20%
  const mandatoryWeight =
    mandatoryStandards.length > 0
      ? (mandatoryPassed / mandatoryStandards.length) * 8000
      : 8000;
  const recommendedWeight =
    recommendedStandards.length > 0
      ? (recommendedPassed / recommendedStandards.length) * 2000
      : 2000;
  const scoreBps = Math.round(mandatoryWeight + recommendedWeight);

  let overallStatus: ComplianceScorecard["overallStatus"] = "VERIFIED";
  if (mandatoryPassed < mandatoryStandards.length) {
    const hasExpired = mandatoryStandards.some(
      (i) => i.status === "FAIL_EXPIRED",
    );
    const hasPending = mandatoryStandards.some(
      (i) => i.status === "FAIL_PENDING",
    );
    if (hasExpired) overallStatus = "EXPIRED";
    else if (
      hasPending &&
      !mandatoryStandards.some(
        (i) => i.status === "FAIL_MISSING" || i.status === "FAIL_REJECTED",
      )
    ) {
      overallStatus = "PENDING_REVIEW";
    } else {
      overallStatus = "DEFICIENT";
    }
  }

  return {
    verticalSlug: options.verticalSlug,
    geography: options.geography,
    entityLevel: options.entityLevel,
    overallStatus,
    scoreBps,
    mandatoryTotal: mandatoryStandards.length,
    mandatoryPassed,
    recommendedTotal: recommendedStandards.length,
    recommendedPassed,
    groups,
    missingMandatoryCodes,
    actionItems,
  };
}
