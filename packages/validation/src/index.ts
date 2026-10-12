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



