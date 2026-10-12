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
