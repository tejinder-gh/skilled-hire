import { z } from "zod";
export const uuid = z.string().uuid();
export const createRequestSchema = z.object({
  propertyId: uuid,
  verticalId: uuid,
  categoryId: uuid,
  issueTypeId: uuid,
  urgency: z.enum(["STANDARD", "EMERGENCY"]),
  description: z.string().min(10).max(5000),
  equipment: z.record(z.string(), z.string()).default({}),
  preferredStartsAt: z.string().datetime().optional(),
  preferredEndsAt: z.string().datetime().optional(),
  attachmentKeys: z.array(z.string().min(1).max(512)).max(10).default([]),
});
export const quoteItemSchema = z.object({
  type: z.enum([
    "DIAGNOSTIC",
    "LABOUR",
    "MATERIAL",
    "EQUIPMENT",
    "DISPOSAL",
    "PERMIT",
    "TRAVEL",
    "SERVICE_FEE",
    "OTHER",
  ]),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  quantity: z.number().int().positive().max(10000),
  unitPriceCents: z.number().int().nonnegative().max(100_000_000),
  materialMetadata: z
    .object({
      manufacturer: z.string().max(100).optional(),
      model: z.string().max(100).optional(),
      partNumber: z.string().max(100).optional(),
      specification: z.string().max(500).optional(),
    })
    .optional(),
});
export const createQuoteSchema = z.object({
  items: z.array(quoteItemSchema).min(1).max(100),
  platformFeeCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().default(0),
  taxCents: z.number().int().nonnegative(),
  notes: z.string().max(5000).optional(),
  expiresAt: z.string().datetime(),
});
export const reviewSchema = z.object({
  overall: z.number().int().min(1).max(5),
  quality: z.number().int().min(1).max(5).optional(),
  professionalism: z.number().int().min(1).max(5).optional(),
  timeliness: z.number().int().min(1).max(5).optional(),
  communication: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(3000).optional(),
});
export const changeOrderSchema = z.object({
  reason: z.string().min(5).max(500),
  explanation: z.string().min(10).max(5000),
  attachmentKeys: z.array(z.string().min(1).max(512)).max(10).default([]),
  items: z.array(quoteItemSchema).min(1).max(100),
  platformFeeCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
});
export const supportTicketSchema = z.object({
  jobId: uuid.optional(),
  subject: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  dispute: z.boolean().default(false),
  evidenceKeys: z.array(z.string().min(1).max(512)).max(10).default([]),
});
export const evaluateComplianceSchema = z.object({
  verticalSlug: z.string().min(1).max(50),
  geography: z.string().min(1).max(10),
  entityLevel: z.enum(["CONTRACTOR", "TECHNICIAN", "EITHER"]).optional(),
  credentials: z
    .array(
      z.object({
        code: z.string().min(1).max(100),
        geography: z.string().max(10).optional(),
        status: z
          .enum(["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "SUSPENDED"])
          .default("VERIFIED"),
        expiryDate: z.string().nullable().optional(),
        documentKey: z.string().max(512).optional(),
        licenseNumber: z.string().max(100).optional(),
      }),
    )
    .default([]),
});
export const submitCredentialSchema = z.object({
  code: z.string().min(1).max(100),
  geography: z.string().min(1).max(10).default("*"),
  documentKey: z.string().min(1).max(512),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  licenseNumber: z.string().max(100).optional(),
  entityType: z.enum(["CONTRACTOR", "TECHNICIAN"]),
  technicianId: uuid.optional(),
  contractorId: uuid.optional(),
});

export const workSampleSchema = z.object({
  id: z
    .string()
    .min(1)
    .default(() => crypto.randomUUID()),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(2000),
  url: z.string().url().max(512).optional().nullable(),
  completedAt: z.string().min(1),
  verified: z.boolean().default(false),
  verifiedAt: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const referenceVerificationSchema = z.object({
  id: z
    .string()
    .min(1)
    .default(() => crypto.randomUUID()),
  clientName: z.string().min(2).max(100),
  clientContact: z.string().min(5).max(100),
  projectScope: z.string().min(5).max(1000),
  relationship: z.string().min(2).max(100),
  verified: z.boolean().default(false),
  verifiedAt: z.string().optional().nullable(),
  assessorNotes: z.string().max(1000).optional().nullable(),
});

export const toolEquipmentSchema = z.object({
  toolName: z.string().min(2).max(100),
  ownedOrLeased: z.boolean().default(true),
  calibrationOrInspectionDate: z.string().optional().nullable(),
  serialOrModelNumber: z.string().max(100).optional().nullable(),
  verified: z.boolean().default(false),
});

export const createCapabilityAssessmentSchema = z.object({
  contractorId: uuid.optional(),
  issueTypeId: uuid,
  geography: z.string().min(1).max(10).default("ON"),
  complexityTier: z
    .enum([
      "TIER_1_BASIC",
      "TIER_2_STANDARD",
      "TIER_3_ADVANCED",
      "TIER_4_SPECIALIZED",
    ])
    .default("TIER_1_BASIC"),
  yearsExperience: z.number().int().nonnegative().default(0),
  maxJobValueCents: z.number().int().nonnegative().default(250000),
  workSamples: z
    .array(workSampleSchema)
    .min(1, "At least one work sample is required"),
  references: z
    .array(referenceVerificationSchema)
    .min(1, "At least one reference is required"),
  toolsEquipment: z.array(toolEquipmentSchema).default([]),
});

export const reviewCapabilityAssessmentSchema = z.object({
  decision: z.enum([
    "APPROVED",
    "PROVISIONAL",
    "SUPERVISED",
    "REJECTED",
    "REVOKED",
  ]),
  complexityTier: z
    .enum([
      "TIER_1_BASIC",
      "TIER_2_STANDARD",
      "TIER_3_ADVANCED",
      "TIER_4_SPECIALIZED",
    ])
    .optional(),
  maxJobValueCents: z.number().int().nonnegative().optional(),
  validUntil: z.string().datetime().optional(),
  supervisedRequirements: z
    .object({
      supervisorTechnicianId: uuid.optional().nullable(),
      supervisorRequiredOnSite: z.boolean().default(false),
      mandatorySupervisorSignoff: z.boolean().default(false),
      maxProvisionalJobs: z.number().int().positive().optional().nullable(),
      completedProvisionalJobs: z.number().int().nonnegative().default(0),
    })
    .optional(),
  denialReasons: z.array(z.string().min(1).max(200)).default([]),
  decisionNotes: z.string().max(3000).optional(),
  verifiedWorkSampleIds: z.array(z.string()).default([]),
  verifiedReferenceIds: z.array(z.string()).default([]),
  verifiedToolNames: z.array(z.string()).default([]),
});

export const appealCapabilityAssessmentSchema = z.object({
  reason: z.string().min(10).max(5000),
  additionalWorkSamples: z.array(workSampleSchema).default([]),
  additionalReferences: z.array(referenceVerificationSchema).default([]),
});

export const evaluateCapabilitySchema = z.object({
  contractorId: uuid,
  issueTypeId: uuid,
  geography: z.string().min(1).max(10).default("ON"),
  requiredComplexityTier: z
    .enum([
      "TIER_1_BASIC",
      "TIER_2_STANDARD",
      "TIER_3_ADVANCED",
      "TIER_4_SPECIALIZED",
    ])
    .default("TIER_1_BASIC"),
  estimatedJobValueCents: z.number().int().nonnegative().default(0),
});

export const evaluatePreDispatchSchema = z.object({
  technicianId: uuid,
  overrideReason: z.string().min(5).max(1000).optional(),
});

export const verifyWorkerIdentitySchema = z.object({
  method: z.enum([
    "GOVT_PHOTO_ID",
    "BIOMETRIC_CHECK",
    "SUPERVISOR_CONFIRMATION",
    "DISPATCHER_OVERRIDE",
  ]),
  documentReference: z.string().min(1).max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const preWorkCommenceSchema = z.object({
  technicianId: uuid.optional(),
  notes: z.string().max(1000).optional(),
});

// Safety Incident Response, Suspension & Quality Audits (#58)
export const containmentActionSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  action: z.string().min(3).max(500),
  executedBy: z.string().min(2).max(100),
  executedAt: z.string().default(() => new Date().toISOString()),
  confirmedSafe: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
});

export const evidenceLockerItemSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  title: z.string().min(2).max(200),
  fileKey: z.string().max(512).optional(),
  url: z.string().url().max(512).optional(),
  artifactType: z.enum([
    "PHOTO",
    "VIDEO",
    "INSPECTOR_REPORT",
    "METER_READING",
    "INCIDENT_FORM",
    "INSURER_NOTICE",
  ]),
  checksumSha256: z.string().max(128).optional(),
  chainOfCustodyVerified: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
});

export const reportSafetyIncidentSchema = z.object({
  jobId: uuid.optional(),
  serviceRequestId: uuid.optional(),
  propertyId: uuid.optional(),
  contractorId: uuid,
  technicianId: uuid.optional(),
  reporterRole: z.enum([
    "CUSTOMER",
    "CONTRACTOR",
    "TECHNICIAN",
    "DISPATCHER",
    "INSPECTOR",
    "INSURER",
    "ADMIN",
  ]),
  severity: z
    .enum([
      "CRITICAL_EMERGENCY",
      "MAJOR_SAFETY",
      "MODERATE_DEFECT",
      "MINOR_HAZARD",
    ])
    .default("MODERATE_DEFECT"),
  incidentType: z.enum([
    "ELECTRICAL_HAZARD_SHOCK",
    "GAS_LEAK_FIRE_RISK",
    "STRUCTURAL_COLLAPSE_RISK",
    "WATER_DAMAGE_FLOODING",
    "CARBON_MONOXIDE",
    "PROPERTY_DAMAGE_MAJOR",
    "REGULATORY_CODE_VIOLATION",
    "UNAUTHORIZED_UNQUALIFIED_WORK",
  ]),
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(5000),
  occurredAt: z.string().default(() => new Date().toISOString()),
  containmentActions: z.array(containmentActionSchema).default([]),
  evidenceLocker: z.array(evidenceLockerItemSchema).default([]),
  immediateQuarantine: z.boolean().default(false),
});

export const triageSafetyIncidentSchema = z.object({
  severity: z.enum([
    "CRITICAL_EMERGENCY",
    "MAJOR_SAFETY",
    "MODERATE_DEFECT",
    "MINOR_HAZARD",
  ]),
  triageNotes: z.string().min(5).max(2000),
  applyQuarantine: z.boolean().default(false),
  quarantineType: z
    .enum([
      "FULL_CONTRACTOR_SUSPENSION",
      "TECHNICIAN_SUSPENSION",
      "VERTICAL_SCOPE_RESTRICTION",
      "PROVISIONAL_AUDIT_SUPERVISION",
    ])
    .optional(),
  restrictedVerticalIds: z.array(uuid).default([]),
  restrictedIssueTypeIds: z.array(uuid).default([]),
  notifyInsurer: z.boolean().default(false),
  insurerClaimReference: z.string().max(100).optional(),
  legalRetentionHold: z.boolean().default(false),
});

export const recordSafetyActionSchema = z.object({
  actionType: z.enum([
    "TRIAGE",
    "EMERGENCY_ESCALATION",
    "EVIDENCE_PRESERVED",
    "CONTRACTOR_SUSPENDED",
    "TECHNICIAN_SUSPENDED",
    "SCOPE_RESTRICTED",
    "INSURER_NOTIFIED",
    "INDEPENDENT_REVIEW_ASSIGNED",
    "SPOT_INSPECTION_ORDERED",
    "CORRECTIVE_ACTION_REQUIRED",
    "REMEDIATION_SUBMITTED",
    "REMEDIATION_ACCEPTED",
    "QUARANTINE_LIFTED",
    "APPEAL_FILED",
    "APPEAL_DECIDED",
    "CLOSED",
  ]),
  notes: z.string().min(3).max(2000).optional(),
  payload: z.record(z.unknown()).default({}),
});

export const submitRemediationSchema = z.object({
  resolutionSummary: z.string().min(10).max(5000),
  correctiveActionsTaken: z.array(z.string().min(3).max(500)).min(1),
  evidenceFiles: z.array(evidenceLockerItemSchema).default([]),
  requestInspection: z.boolean().default(true),
});

export const createQualityAuditSchema = z.object({
  jobId: uuid.optional(),
  contractorId: uuid,
  technicianId: uuid.optional(),
  incidentId: uuid.optional(),
  triggerType: z.enum([
    "INCIDENT_REMEDIATION",
    "REPEAT_DEFECT_FLAG",
    "RANDOM_SPOT_CHECK",
    "HIGH_RISK_TRADE",
    "CUSTOMER_DISPUTE",
  ]),
  inspectorUserId: uuid.optional(),
  scheduledDate: z.string().optional(),
});

export const conductQualityAuditSchema = z.object({
  status: z.enum(["PASSED", "DEFECTS_IDENTIFIED", "FAILED_CRITICAL"]),
  findings: z
    .array(
      z.object({
        code: z.string().min(2).max(100),
        description: z.string().min(5).max(1000),
        severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]),
        rectified: z.boolean().default(false),
      }),
    )
    .default([]),
  repeatDefectCount: z.number().int().nonnegative().default(0),
  remediationRequired: z.boolean().default(false),
  remediationDeadline: z.string().optional(),
  reportNotes: z.string().max(2000).optional(),
});

// Electrical Permits, Inspection Evidence & ESA Compliance (#59)
export const fileElectricalPermitSchema = z.object({
  jobId: uuid,
  esaNotificationNumber: z.string().min(5).max(100),
  ecraLicenseNumber: z.string().min(5).max(100),
  designatedMasterElectrician: z.string().min(2).max(150),
  scopeOfWork: z.string().min(10).max(2000),
  utilityDisconnectRequired: z.boolean().default(false),
  utilityProvider: z.string().max(100).optional(),
  utilityMeterNumber: z.string().max(100).optional(),
  utilityDisconnectDate: z.string().optional(),
});

export const coordinateUtilitySchema = z.object({
  utilityProvider: z.string().min(2).max(100),
  utilityMeterNumber: z.string().min(2).max(100),
  utilityDisconnectDate: z.string().optional(),
  utilityReconnectAuthorizationCode: z.string().min(3).max(100),
  utilityReconnectDate: z.string().optional(),
});

export const recordPermitDeficiencySchema = z.object({
  defectCode: z.string().min(2).max(50),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]).default("MAJOR"),
  description: z.string().min(5).max(1000),
  correctiveActionRequired: z.string().min(5).max(1000),
});

export const rectifyPermitDeficiencySchema = z.object({
  rectificationNotes: z.string().min(5).max(1000),
  rectificationEvidenceUrl: z.string().url().max(512).optional(),
});

export const clearPermitDeficiencySchema = z.object({
  clearedByInspector: z.string().min(2).max(150),
  clearedNotes: z.string().max(1000).optional(),
});

export const uploadCertificateOfAcceptanceSchema = z.object({
  certificateOfAcceptanceNumber: z.string().min(5).max(100),
  certificateOfAcceptanceUrl: z.string().url().max(512).optional(),
  inspectorName: z.string().min(2).max(150),
  inspectorBadgeNumber: z.string().min(2).max(100).optional(),
  issuedAt: z.string().optional(),
});

export const documentRegulatoryExceptionSchema = z.object({
  documentedExceptionReason: z.string().min(10).max(2000),
  exceptionRuleReference: z.string().min(3).max(100),
});

// Versioned Job Risk Scoring & Dispatch Controls (#60)
export const assessJobRiskSchema = z.object({
  policyVersion: z.string().min(1).max(50).optional(),
  hazardFlags: z.array(z.string()).default([]),
  jobValueCents: z.number().int().nonnegative().optional(),
  propertyAgeYears: z.number().int().nonnegative().optional(),
  isCommercialOrIndustrial: z.boolean().default(false),
  heightMeters: z.number().nonnegative().optional(),
  confinedSpaceAccess: z.boolean().default(false),
  voltageLevelVolts: z.number().nonnegative().optional(),
  gasApplianceInvolved: z.boolean().default(false),
  mitigationFactors: z
    .array(
      z.object({
        mitigation: z.string(),
        verified: z.boolean(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
});

export const reviewJobRiskAssessmentSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  approvalNotes: z.string().min(5).max(2000),
  conditions: z.array(z.string()).optional(),
});

export const fulfillMandatoryControlSchema = z.object({
  control: z.string().min(2).max(100),
  notes: z.string().min(5).max(1000).optional(),
  evidenceUrl: z.string().url().max(512).optional(),
});

export const createRiskPolicySchema = z.object({
  version: z.string().min(1).max(50),
  name: z.string().min(3).max(200),
  dimensionsConfig: z.record(z.string(), z.unknown()).default({}),
  hazardFlagRules: z
    .array(
      z.object({
        flag: z.string(),
        severity: z.enum(["RED_FLAG", "HIGH", "MODERATE"]),
        inherentAdd: z.number().int().min(0).max(100),
        requiresManualApproval: z.boolean(),
      }),
    )
    .default([]),
  tierThresholds: z.object({
    lowMax: z.number().int().min(0).max(100),
    moderateMax: z.number().int().min(0).max(100),
    highMax: z.number().int().min(0).max(100),
    criticalMin: z.number().int().min(0).max(100),
  }),
  mandatoryControlsConfig: z
    .array(
      z.object({
        trigger: z.string(),
        control: z.string(),
      }),
    )
    .default([]),
  calibrationNotes: z.string().max(2000).optional(),
});

// Legal Agreements, Provider Indemnity & Signed Agreements (#61)
export const createLegalAgreementSchema = z.object({
  type: z.enum([
    "INDEPENDENT_CONTRACTOR_AGREEMENT",
    "CUSTOMER_SERVICE_TERMS",
    "PLATFORM_TERMS_OF_SERVICE",
    "PRIVACY_POLICY",
  ]),
  version: z.string().min(1).max(20),
  jurisdiction: z.string().min(1).max(10).default("ON"),
  title: z.string().min(3).max(255),
  summary: z.string().min(10).max(2000),
  contentMarkdown: z.string().min(20),
  legalCounselRef: z.string().max(100).optional(),
  keyTerms: z.record(z.string(), z.unknown()).default({}),
});

export const signAgreementSchema = z.object({
  agreementId: uuid,
  entityType: z.enum(["CONTRACTOR", "CUSTOMER", "TECHNICIAN"]),
  contractorId: uuid.optional(),
  signerLegalName: z.string().min(2).max(150),
  signerTitle: z.string().min(2).max(100).optional(),
  agreementChecksum: z.string().min(64).max(64),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const queryAgreementStatusSchema = z.object({
  type: z.enum([
    "INDEPENDENT_CONTRACTOR_AGREEMENT",
    "CUSTOMER_SERVICE_TERMS",
    "PLATFORM_TERMS_OF_SERVICE",
    "PRIVACY_POLICY",
  ]),
  jurisdiction: z.string().default("ON"),
  contractorId: uuid.optional(),
  userId: uuid.optional(),
});

// Customer Protection Product & Coverage Eligibility (#62)
export const createProtectionProductSchema = z.object({
  slug: z.string().min(3).max(100),
  name: z.string().min(3).max(200),
  version: z.string().min(1).max(20).default("1.0.0"),
  jurisdiction: z.string().min(1).max(10).default("ON"),
  underwriterName: z.string().min(3).max(200),
  underwriterPolicyRef: z.string().min(3).max(100),
  brokerName: z.string().min(3).max(200),
  brokerLicenseRef: z.string().min(3).max(100),
  coverageLimitCents: z.number().int().positive(),
  deductibleCents: z.number().int().nonnegative(),
  durationMonths: z.number().int().positive().default(12),
  baseRateBps: z.number().int().positive().default(250),
  minPremiumCents: z.number().int().positive().default(4900),
  brokerCommissionBps: z.number().int().nonnegative().default(1500),
  platformFeeBps: z.number().int().nonnegative().default(1000),
  taxRateBps: z.number().int().nonnegative().default(800),
  termsMarkdown: z.string().min(20),
  disclaimers: z.array(z.string()).default([]),
  allowedVerticalIds: z.array(z.string()).default([]),
  maxJobValueCents: z.number().int().positive().default(50000000),
  active: z.boolean().default(true),
});

export const quoteProtectionSchema = z.object({
  serviceRequestId: uuid,
  productSlug: z.string().optional(),
  productId: uuid.optional(),
  jobValueCents: z.number().int().positive().optional(),
});

export const bindProtectionPolicySchema = z.object({
  quoteId: uuid,
  acknowledgedDisclosures: z.boolean().refine((val) => val === true, {
    message: "Must acknowledge statutory broker and coverage disclosures",
  }),
  paymentMethodRef: z.string().min(3).max(100).optional(),
});

export const cancelProtectionPolicySchema = z.object({
  reason: z.string().min(5).max(500),
});

export const createProtectionClaimSchema = z.object({
  incidentDate: z.string().datetime(),
  incidentDescription: z.string().min(10).max(3000),
  claimedAmountCents: z.number().int().positive(),
  evidenceUrls: z.array(z.string().url()).min(1),
});

export const adjudicateProtectionClaimSchema = z.object({
  decision: z.enum(["APPROVED", "PARTIALLY_APPROVED", "DECLINED"]),
  approvedAmountCents: z.number().int().nonnegative().optional(),
  deductibleCents: z.number().int().nonnegative().optional(),
  adjudicationNotes: z.string().min(5).max(2000),
  declineReasonCode: z
    .enum([
      "PRE_EXISTING_DEFECT",
      "WEAR_AND_TEAR",
      "UNAUTHORIZED_MODIFICATION",
      "CLAIM_EXCEEDS_POLICY_PERIOD",
      "OUTSIDE_COVERAGE_SCOPE",
      "INSUFFICIENT_EVIDENCE",
    ])
    .optional(),
});

export const queryProtectionReconciliationSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  policyId: uuid.optional(),
});

// 18. Risk-based Job Documentation, Inspections & Incident Escalation (#63)
export const evidencePhotoSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(500).optional(),
  timestamp: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phase: z.enum(["BEFORE", "IN_PROGRESS", "AFTER"]),
});

export const riskChecklistItemSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  confirmed: z.boolean(),
  notes: z.string().max(500).optional(),
  criticalHazard: z.boolean().optional(),
});

export const submitJobDocumentationSchema = z.object({
  beforePhotos: z.array(evidencePhotoSchema).default([]),
  inProgressPhotos: z.array(evidencePhotoSchema).default([]),
  afterPhotos: z.array(evidencePhotoSchema).default([]),
  workerIdentityConfirmed: z.boolean().default(false),
  workerIdentityNotes: z.string().max(1000).optional(),
  riskChecklist: z.array(riskChecklistItemSchema).default([]),
  permitId: uuid.optional(),
});

export const customerSignoffSchema = z.object({
  customerName: z.string().min(1).max(100),
  feedback: z.string().max(1000).optional(),
  signatureDigest: z.string().min(10).max(128).optional(),
});

export const reviewJobDocumentationSchema = z.object({
  status: z.enum(["VERIFIED_COMPLIANT", "DEFICIENT"]),
  reviewNotes: z.string().min(3).max(2000),
  deficiencies: z
    .array(
      z.object({
        code: z.string().min(1).max(50),
        severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]),
        description: z.string().min(3).max(500),
        rectified: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const exceptionApprovalSchema = z.object({
  reason: z.string().min(5).max(1000),
  conditions: z.array(z.string()).default([]),
});

export const qaSampleJobSchema = z.object({
  triggerType: z
    .enum([
      "HIGH_RISK_TRADE",
      "RANDOM_SPOT_CHECK",
      "INCIDENT_REMEDIATION",
      "REPEAT_DEFECT_FLAG",
      "CUSTOMER_DISPUTE",
    ])
    .default("HIGH_RISK_TRADE"),
  inspectorUserId: uuid.optional(),
  notes: z.string().max(1000).optional(),
});

// 19. Structured Job Completion Reports & Acceptance (Issue #50)
export const installedPartSchema = z.object({
  partNumber: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(1000),
  unitCostCents: z.number().int().min(0).optional(),
  supplierReceiptUrl: z.string().url().optional(),
  warrantyMonths: z.number().int().min(0).optional(),
});

export const performedTestSchema = z.object({
  testName: z.string().min(1).max(200),
  result: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  measuredValue: z.string().max(100).optional(),
  unit: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

export const completionPhotoSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(500).optional(),
  timestamp: z.string().optional(),
  phase: z.enum(["BEFORE", "AFTER"]),
});

export const outstandingIssueSchema = z.object({
  description: z.string().min(1).max(500),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]),
  actionRequired: z.string().min(1).max(500),
});

export const maintenanceRecommendationSchema = z.object({
  recommendation: z.string().min(1).max(500),
  recommendedIntervalDays: z.number().int().min(1).optional(),
  priority: z.enum(["LOW", "RECOMMENDED", "URGENT"]),
});

export const createCompletionReportSchema = z.object({
  workSummary: z.string().min(5).max(2000),
  diagnosis: z.string().min(5).max(2000),
  workStartedAt: z.string(),
  workCompletedAt: z.string(),
  assetId: uuid.optional(),
  partsInstalled: z.array(installedPartSchema).default([]),
  testsPerformed: z.array(performedTestSchema).default([]),
  beforePhotos: z.array(completionPhotoSchema).default([]),
  afterPhotos: z.array(completionPhotoSchema).default([]),
  permitId: uuid.optional(),
  outstandingIssues: z.array(outstandingIssueSchema).default([]),
  maintenanceRecommendations: z.array(maintenanceRecommendationSchema).default([]),
  clientMutationId: z.string().max(100).optional(),
  isDraft: z.boolean().default(false),
});

export const contractorAttestationSchema = z.object({
  technicianName: z.string().min(1).max(100),
  licenseNumber: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const customerAcceptanceSchema = z.object({
  accepted: z.boolean(),
  notes: z.string().max(1000).optional(),
  signatureDigest: z.string().min(10).max(128).optional(),
});

export const disputeCompletionReportSchema = z.object({
  reason: z.string().min(5).max(2000),
});

// 20. Property Service Passport, Assets & Access Grants (Issue #51)
export const createPropertyAssetSchema = z.object({
  name: z.string().min(1).max(200),
  verticalId: uuid,
  assetType: z.string().min(1).max(100).default("GENERAL_EQUIPMENT"),
  manufacturer: z.string().max(100).optional(),
  modelNumber: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  installedOn: z.string().optional(),
  warrantyStatus: z
    .enum(["ACTIVE", "EXPIRED", "UNKNOWN", "EXTENDED"])
    .default("ACTIVE"),
  metadata: z.record(z.unknown()).default({}),
});

export const createPropertyAccessGrantSchema = z.object({
  granteeContractorId: uuid,
  scope: z
    .enum(["FULL_HISTORY", "SERVICE_SPECIFIC", "REDACTED_COMMERCIAL"])
    .default("FULL_HISTORY"),
  serviceVerticalId: uuid.optional(),
  reason: z.string().max(500).optional(),
  durationDays: z.number().int().min(1).max(365).default(30),
});

export const initiatePropertyTransferSchema = z.object({
  newOwnerEmail: z.string().email(),
  transferNotes: z.string().max(500).optional(),
});

export const acceptPropertyTransferSchema = z.object({
  verificationToken: z.string().min(10).max(100),
});

// 21. Workmanship Warranty & Claims (Issues #48, #49)
export const createWarrantyPolicySchema = z.object({
  policyCode: z.string().min(2).max(50),
  version: z.string().min(1).max(20).default("1.0.0"),
  verticalId: uuid.optional(),
  categoryId: uuid.optional(),
  jurisdiction: z.string().min(2).max(10).default("ON"),
  durationMonths: z.number().int().min(1).max(120).default(12),
  responseSlaHours: z.number().int().min(1).max(168).default(48),
  emergencySlaHours: z.number().int().min(1).max(72).default(24),
  coveredDefects: z.array(z.string().min(1).max(200)).default([]),
  exclusions: z.array(z.string().min(1).max(200)).default([]),
  statutoryTerms: z.string().min(1).max(5000),
  active: z.boolean().default(true),
});

export const createWarrantySnapshotSchema = z.object({
  jobId: uuid,
  policyId: uuid.optional(),
  warrantyType: z
    .enum(["STANDARD_WORKMANSHIP", "PREMIUM_EXTENDED", "STATUTORY_MANDATORY"])
    .default("STANDARD_WORKMANSHIP"),
  durationMonths: z.number().int().min(1).max(120).optional(),
  startsAt: z.string().optional(),
  coveredDefects: z.array(z.string()).optional(),
  exclusions: z.array(z.string()).optional(),
  contractorAcknowledged: z.boolean().default(true),
});

export const fileWarrantyClaimSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(3000),
  evidencePhotos: z.array(z.string().url()).default([]),
  urgency: z
    .enum([
      "STANDARD",
      "URGENT_NO_HEAT",
      "URGENT_WATER_LEAK",
      "EMERGENCY_SAFETY_HAZARD",
    ])
    .default("STANDARD"),
});

export const respondWarrantyClaimSchema = z.object({
  accepted: z.boolean(),
  contractorResponseNotes: z.string().max(2000).optional(),
  scheduledCallbackAt: z.string().optional(),
});

export const disputeWarrantyClaimSchema = z.object({
  reason: z.string().min(5).max(2000),
});

export const remediateWarrantyClaimSchema = z.object({
  notes: z.string().min(5).max(2000),
  remediationCompletedAt: z.string().optional(),
});

export const recordWarrantyRecoverySchema = z.object({
  contractorId: uuid,
  amountCents: z.number().int().min(1),
  reason: z.string().min(3).max(500),
  status: z
    .enum([
      "PENDING",
      "RECOVERED_FROM_PAYOUT",
      "MANUAL_INVOICE_SENT",
      "WRITTEN_OFF",
    ])
    .default("PENDING"),
});

// 22. Post-Job Surveys, Fair Reviews & Rewards Ledger (Issue #52)
export const updateCustomerFeedbackPreferencesSchema = z.object({
  feedbackOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
  emailOptIn: z.boolean().optional(),
});

export const createSurveyInvitationSchema = z.object({
  jobId: uuid,
  channel: z.enum(["EMAIL", "SMS", "IN_APP"]).default("EMAIL"),
  expiresInDays: z.number().int().min(1).max(60).default(14),
});

export const submitPostJobSurveySchema = z.object({
  overallRating: z.number().int().min(1).max(5),
  qualityRating: z.number().int().min(1).max(5).optional(),
  professionalismRating: z.number().int().min(1).max(5).optional(),
  timelinessRating: z.number().int().min(1).max(5).optional(),
  communicationRating: z.number().int().min(1).max(5).optional(),
  npsScore: z.number().int().min(0).max(10).optional(),
  feedbackComment: z.string().max(3000).optional(),
  shareAsPublicReview: z.boolean().default(true),
});

export const redeemRewardCreditSchema = z.object({
  creditId: uuid,
  jobId: uuid,
  amountCents: z.number().int().min(1).optional(),
});

export const surveyWebhookPayloadSchema = z.object({
  surveyToken: z.string().min(5).max(100),
  overallRating: z.number().int().min(1).max(5),
  qualityRating: z.number().int().min(1).max(5).optional(),
  professionalismRating: z.number().int().min(1).max(5).optional(),
  timelinessRating: z.number().int().min(1).max(5).optional(),
  communicationRating: z.number().int().min(1).max(5).optional(),
  npsScore: z.number().int().min(0).max(10).optional(),
  feedbackComment: z.string().max(3000).optional(),
  externalSubmissionId: z.string().min(1).max(100).optional(),
});

// Marketplace Analytics & Supply Coverage Dashboard (#54)
export const marketplaceAnalyticsQuerySchema = z.object({
  timeWindow: z.enum(["24H", "7D", "30D", "90D", "ALL"]).default("30D"),
  verticalSlug: z.string().optional(),
  neighbourhood: z.string().optional(),
});

export const updateOperationalAlertSchema = z.object({
  status: z.enum(["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
  resolutionNotes: z.string().max(2000).optional(),
});

export const createOperationalAlertSchema = z.object({
  alertType: z.enum([
    "SUPPLY_DEFICIT",
    "SLA_BREACH",
    "WARRANTY_SPIKE",
    "FRAUD_SIGNAL",
    "FAIRNESS_SKEW",
  ]),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  title: z.string().min(3).max(200),
  description: z.string().min(5).max(2000),
  verticalSlug: z.string().optional(),
  neighbourhood: z.string().optional(),
  metricsPayload: z.record(z.unknown()).optional(),
});

// Multi-Service Provider Onboarding & Supply CRM (#41, #6)
export const providerRateProposalSchema = z.object({
  verticalSlug: z.string().min(1),
  hourlyRateCents: z.number().int().min(1000).max(100000),
  diagnosticFeeCents: z.number().int().min(0).max(50000),
  emergencyRateMultiplierBps: z.number().int().min(10000).max(30000).optional(),
});

export const technicianRosterInputSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(30),
  tradeLicenseCode: z.string().min(1).max(50),
  licenseNumber: z.string().min(1).max(80),
  licenseExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
  isEmergencyAvailable: z.boolean().optional(),
});

export const providerDraftApplicationSchema = z.object({
  prospectEmail: z.string().email(),
  businessName: z.string().min(2).max(200),
  businessNumber: z.string().max(50).optional(),
  businessType: z
    .enum(["CORPORATION", "SOLE_PROPRIETORSHIP", "PARTNERSHIP"])
    .optional(),
  phone: z.string().min(7).max(30),
  postalCodes: z.array(z.string().min(2).max(10)).optional(),
  selectedVerticals: z.array(z.string()).optional(),
  serviceRatesProposal: z.array(providerRateProposalSchema).optional(),
  weeklyCapacity: z.number().int().min(1).max(500).optional(),
  draftStep: z.number().int().min(1).max(10).optional(),
  draftPayload: z.record(z.unknown()).optional(),
  saveToken: z.string().optional(),
});

export const providerSubmitApplicationSchema = z.object({
  saveToken: z.string().min(8),
  businessNumber: z.string().min(3).max(50),
  businessType: z.enum(["CORPORATION", "SOLE_PROPRIETORSHIP", "PARTNERSHIP"]),
  postalCodes: z.array(z.string().min(2).max(10)).min(1),
  selectedVerticals: z.array(z.string().min(2)).min(1),
  serviceRatesProposal: z.array(providerRateProposalSchema).min(1),
  weeklyCapacity: z.number().int().min(1).max(500),
  technicians: z.array(technicianRosterInputSchema).min(1),
  consentAccepted: z.literal(true),
  applicantUserId: z.string().uuid().optional(),
});

export const serviceGeographyDecisionSchema = z.object({
  verticalSlug: z.string().min(1),
  territoryCode: z.string().min(1),
  status: z.enum(["APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"]),
  reason: z.string().max(1000).optional(),
});

export const providerApplicationReviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_MORE_INFO"]),
  reviewNotes: z.string().max(2000).optional(),
  serviceGeographyDecisions: z.array(serviceGeographyDecisionSchema).default([]),
  convertAndProvision: z.boolean().optional(),
});

export const providerApplicationsQuerySchema = z.object({
  status: z
    .enum([
      "PROSPECT",
      "SUBMITTED",
      "UNDER_REVIEW",
      "APPROVED",
      "REJECTED",
      "SUSPENDED",
      "ALL",
    ])
    .default("ALL"),
  verticalSlug: z.string().optional(),
  territoryCode: z.string().optional(),
  search: z.string().optional(),
});








