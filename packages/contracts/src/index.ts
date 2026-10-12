export const roles = [
  "CUSTOMER",
  "CONTRACTOR_OWNER",
  "CONTRACTOR_MANAGER",
  "TECHNICIAN",
  "OPERATIONS_AGENT",
  "DISPATCHER",
  "SUPPORT_AGENT",
  "QUOTE_REVIEWER",
  "ADMIN",
  "SUPER_ADMIN",
] as const;
export type Role = (typeof roles)[number];

export const requestStatuses = [
  "DRAFT",
  "SUBMITTED",
  "QUALIFICATION_PENDING",
  "QUALIFIED",
  "SCHEDULING",
  "SCHEDULED",
  "CONTRACTOR_SEARCH",
  "ASSIGNED",
  "TECHNICIAN_EN_ROUTE",
  "TECHNICIAN_ARRIVED",
  "ASSESSMENT_IN_PROGRESS",
  "QUOTE_PENDING",
  "QUOTE_SUBMITTED",
  "QUOTE_APPROVED",
  "QUOTE_REJECTED",
  "MATERIALS_PENDING",
  "WORK_SCHEDULED",
  "WORK_IN_PROGRESS",
  "ON_HOLD",
  "CHANGE_ORDER_PENDING",
  "COMPLETION_PENDING",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
  "CLOSED",
] as const;
export type ServiceRequestStatus = (typeof requestStatuses)[number];
export type BookingUrgency = "STANDARD" | "EMERGENCY";
export type CredentialStatus =
  "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED" | "SUSPENDED";
export type QuoteItemType =
  | "DIAGNOSTIC"
  | "LABOUR"
  | "MATERIAL"
  | "EQUIPMENT"
  | "DISPOSAL"
  | "PERMIT"
  | "TRAVEL"
  | "SERVICE_FEE"
  | "OTHER";
export type QuoteStatus =
  "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED";
export type ChangeOrderStatus =
  "DRAFT" | "SUBMITTED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "SUPERSEDED";
export type PaymentMilestoneStatus =
  "PENDING" | "REQUIRES_ACTION" | "PAID" | "FAILED" | "REFUNDED" | "WAIVED";
export type Money = Readonly<{ amount: number; currency: string }>;
export type Actor = Readonly<{
  id: string;
  roles: readonly Role[];
  contractorId?: string;
}>;

export const riskTiers = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type RiskTier = (typeof riskTiers)[number];

export const pricingTypes = ["HOURLY", "FIXED", "ESTIMATE_REQUIRED"] as const;
export type PricingType = (typeof pricingTypes)[number];

export const serviceFamilies = [
  "MECHANICAL",
  "STRUCTURAL",
  "BUILDING_ENVELOPE",
  "RENOVATION",
  "PROPERTY_MAINTENANCE",
  "SITEWORK",
  "SPECIALTY",
  "GENERAL",
] as const;
export type ServiceFamily = (typeof serviceFamilies)[number];

export interface VerticalConfig {
  id: string;
  slug: string;
  name: string;
  branding: { displayName: string; logoUrl?: string; primaryDomain?: string };
  serviceCategories: ServiceCategory[];
  issueTypes: IssueType[];
  emergencyRules: EmergencyRule[];
  technicianRequirements: CredentialRequirement[];
}
export interface ServiceCategory {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  riskTier?: RiskTier;
  launchReady?: boolean;
  displayOrder?: number;
}
export interface IssueType {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description?: string | null;
  scopeSummary?: string | null;
  riskTier?: RiskTier;
  pricingType?: PricingType;
  basePriceCents?: number;
  defaultDurationMinutes?: number;
  requiresPermit?: boolean;
  permitType?: string | null;
  requiredEvidence?: string[];
  defaultWarrantyMonths?: number;
  geographicRestrictions?: string[];
  launchReady?: boolean;
  displayOrder?: number;
  tags?: string[];
  equipmentFields?: string[];
}

export interface ServiceVariant extends IssueType {
  riskTier: RiskTier;
  pricingType: PricingType;
  basePriceCents: number;
  defaultDurationMinutes: number;
  requiresPermit: boolean;
  defaultWarrantyMonths: number;
  launchReady: boolean;
  active: boolean;
}

export interface ServiceCatalogCategory extends ServiceCategory {
  verticalId: string;
  riskTier: RiskTier;
  launchReady: boolean;
  active: boolean;
  displayOrder: number;
  variants?: ServiceVariant[];
}

export interface ServiceCatalogVertical {
  id: string;
  slug: string;
  name: string;
  family: ServiceFamily;
  description?: string | null;
  icon?: string | null;
  riskTier: RiskTier;
  permitAuthority?: string | null;
  launchReady: boolean;
  active: boolean;
  displayOrder: number;
  config?: Record<string, unknown>;
  categories?: ServiceCatalogCategory[];
}

export interface CatalogSearchResult {
  verticalId: string;
  verticalSlug: string;
  verticalName: string;
  verticalFamily: ServiceFamily;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  variantId: string;
  variantSlug: string;
  variantName: string;
  description: string;
  riskTier: RiskTier;
  pricingType: PricingType;
  basePriceCents: number;
  requiresPermit: boolean;
  permitType?: string | null | undefined;
  launchReady: boolean;
  matchScore: number;
}

export interface EmergencyRule {
  serviceCategoryId: string;
  targetMinutes: number;
  calloutFeeCents: number;
}
export interface CredentialRequirement {
  code: string;
  geography: string;
  verificationRequired: boolean;
}
export interface QuoteItemInput {
  type: QuoteItemType;
  title: string;
  description?: string | undefined;
  quantity: number;
  unitPriceCents: number;
  materialMetadata?:
    | {
        manufacturer?: string | undefined;
        model?: string | undefined;
        partNumber?: string | undefined;
        specification?: string | undefined;
      }
    | undefined;
}
export interface PaymentRule {
  id: string;
  verticalId: string;
  minAmountCents: number;
  maxAmountCents: number | null;
  milestones: Array<{
    trigger: string;
    percentageBps: number;
    evidenceRequired: boolean;
  }>;
}
export interface RankedCandidate {
  technicianId: string;
  contractorId: string;
  score: number;
  reasons: string[];
}
export interface DomainEvent {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}
export interface FeeRule {
  verticalId?: string;
  contractorId?: string;
  relationshipStage: "FIRST_JOB" | "FIRST_REPEAT" | "ESTABLISHED";
  takeRateBps: number;
}

export const verificationSources = [
  "MANUAL_AUDIT",
  "REGULATOR_API",
  "SELF_UPLOAD",
] as const;
export type VerificationSource = (typeof verificationSources)[number];

export interface TradeRegulatoryPolicy {
  id: string;
  verticalSlug: string;
  categorySlug: string;
  variantSlug: string;
  geography: string;
  policyVersion: number;
  contractorMandatoryCodes: string[];
  technicianMandatoryCodes: string[];
  apprenticeEligible: boolean;
  supervisorRatio: string;
  permitRequired: boolean;
  inspectionAuthority?: string | null;
  legalAuthorityDisclaimer: string;
  active: boolean;
}

export interface RegulatoryEligibilityResult {
  eligible: boolean;
  failClosed: boolean;
  reasons: string[];
  contractorDeficiencies: string[];
  technicianDeficiencies: string[];
  requiredPermits: string[];
  inspectionAuthority?: string | null;
  legalAuthorityDisclaimer?: string | null;
  policyVersion: number;
  checkedAt: string;
}

export interface CredentialVerificationRecord {
  id?: string | null | undefined;
  contractorId?: string | null | undefined;
  technicianId?: string | null | undefined;
  code: string;
  geography: string;
  status: CredentialStatus;
  verificationSource: VerificationSource;
  verifiedByUserId?: string | null | undefined;
  regulatorReference?: string | null | undefined;
  checkedAt?: string | null | undefined;
  expiryDate?: string | null | undefined;
  limitations?: string | null | undefined;
  documentKey?: string | null | undefined;
  auditorNotes?: string | null | undefined;
}

export const credentialGroupCodes = [
  "TRADE_LICENSING",
  "ENVIRONMENTAL_HAZARDOUS",
  "INSURANCE_FINANCIAL",
  "HEALTH_SAFETY",
  "STATUTORY_REGISTRATION",
  "TRUST_IDENTITY",
] as const;
export type CredentialGroupCode = (typeof credentialGroupCodes)[number];

export interface CredentialGroup {
  code: CredentialGroupCode;
  name: string;
  description: string;
  displayOrder: number;
  icon: string;
}

export type EntityLevel = "CONTRACTOR" | "TECHNICIAN" | "EITHER";
export type RequirementLevel = "MANDATORY" | "RECOMMENDED";
export type VerificationMethod =
  "DOCUMENT_UPLOAD" | "REGISTRY_API" | "MANUAL_AUDIT";

export interface ComplianceStandard {
  id: string;
  groupCode: CredentialGroupCode;
  credentialCode: string;
  name: string;
  description: string;
  verticalSlug: string;
  geography: string;
  entityLevel: EntityLevel;
  requirementLevel: RequirementLevel;
  issuingAuthority: string;
  legalReference?: string | undefined;
  verificationMethod: VerificationMethod;
  validityPeriodMonths?: number | null | undefined;
  active: boolean;
}

export type ComplianceEvaluationStatus =
  "VERIFIED" | "DEFICIENT" | "EXPIRED" | "PENDING_REVIEW";
export type StandardItemStatus =
  "PASS" | "FAIL_MISSING" | "FAIL_EXPIRED" | "FAIL_PENDING" | "FAIL_REJECTED";

export interface StandardEvaluationItem {
  standard: ComplianceStandard;
  matchedCredential?:
    | {
        id?: string | undefined;
        code: string;
        geography?: string | undefined;
        status: CredentialStatus;
        expiryDate?: string | null | undefined;
        documentKey?: string | null | undefined;
        licenseNumber?: string | undefined;
      }
    | undefined;
  status: StandardItemStatus;
  reason: string;
}

export interface ComplianceGroupSummary {
  groupCode: CredentialGroupCode;
  groupName: string;
  icon: string;
  totalRequired: number;
  passed: number;
  status: "PASS" | "FAIL" | "PENDING";
  items: StandardEvaluationItem[];
}

export interface ComplianceScorecard {
  verticalSlug: string;
  geography: string;
  entityLevel?: EntityLevel | undefined;
  overallStatus: ComplianceEvaluationStatus;
  scoreBps: number;
  mandatoryTotal: number;
  mandatoryPassed: number;
  recommendedTotal: number;
  recommendedPassed: number;
  groups: ComplianceGroupSummary[];
  missingMandatoryCodes: string[];
  actionItems: string[];
}

export interface SubmittedCredentialInput {
  id?: string | undefined;
  code: string;
  geography?: string | undefined;
  status?: CredentialStatus | undefined;
  expiryDate?: string | null | undefined;
  documentKey?: string | null | undefined;
  licenseNumber?: string | undefined;
}

export interface AlternativeSlot {
  id: string;
  label: string;
  day: string;
  time: string;
  guaranteed: boolean;
  demandLevel: "LOW" | "NORMAL" | "HIGH";
  badge: string;
}

export interface SlotAvailabilityResponse {
  verticalSlug: string;
  verticalName: string;
  region: string;
  queriedSlot: string;
  available: boolean;
  status: "AVAILABLE" | "BUSIER_THAN_USUAL";
  headline: string;
  reason: string;
  metrics?: {
    activeCertifiedTechnicians: number;
    dispatchedCount: number;
    capacitySaturationBps: number;
    estimatedWaitMinutes: number;
  };
  alternativeSlots?: AlternativeSlot[];
  emergencyOption?: {
    available: boolean;
    title: string;
    badge: string;
    description: string;
    calloutFeeCents: number;
    slaMinutes: number;
  };
  standbyWaitlist?: {
    available: boolean;
    title: string;
    badge: string;
    description: string;
    queuePosition: number;
    estimatedNoticeMinutes: number;
  };
}

export const complexityTiers = [
  "TIER_1_BASIC",
  "TIER_2_STANDARD",
  "TIER_3_ADVANCED",
  "TIER_4_SPECIALIZED",
] as const;
export type ComplexityTier = (typeof complexityTiers)[number];

export const capabilityAssessmentStatuses = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "PROVISIONAL",
  "SUPERVISED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
  "APPEALED",
] as const;
export type CapabilityAssessmentStatus =
  (typeof capabilityAssessmentStatuses)[number];

export interface WorkSampleRecord {
  id: string;
  title: string;
  description: string;
  url?: string | null | undefined;
  completedAt: string;
  verified?: boolean | undefined;
  verifiedAt?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface ReferenceVerificationRecord {
  id: string;
  clientName: string;
  clientContact: string;
  projectScope: string;
  relationship: string;
  verified?: boolean | undefined;
  verifiedAt?: string | null | undefined;
  assessorNotes?: string | null | undefined;
}

export interface ToolEquipmentRecord {
  toolName: string;
  ownedOrLeased: boolean;
  calibrationOrInspectionDate?: string | null | undefined;
  serialOrModelNumber?: string | null | undefined;
  verified?: boolean | undefined;
}

export interface SupervisedRequirements {
  supervisorTechnicianId?: string | null | undefined;
  supervisorRequiredOnSite?: boolean | undefined;
  mandatorySupervisorSignoff?: boolean | undefined;
  maxProvisionalJobs?: number | null | undefined;
  completedProvisionalJobs?: number | undefined;
}

export interface AppealRecord {
  id: string;
  submittedAt: string;
  appellantUserId: string;
  reason: string;
  additionalWorkSamples?: WorkSampleRecord[] | undefined;
  additionalReferences?: ReferenceVerificationRecord[] | undefined;
  assessorUserId?: string | null | undefined;
  reviewedAt?: string | null | undefined;
  outcome?:
    | "APPROVED"
    | "PROVISIONAL"
    | "SUPERVISED"
    | "REJECTED"
    | "UPHELD"
    | undefined;
  assessorNotes?: string | null | undefined;
}

export interface ContractorCapabilityAssessment {
  id: string;
  contractorId: string;
  issueTypeId: string;
  geography: string;
  status: CapabilityAssessmentStatus;
  complexityTier: ComplexityTier;
  yearsExperience: number;
  maxJobValueCents: number;
  workSamples: WorkSampleRecord[];
  references: ReferenceVerificationRecord[];
  toolsEquipment: ToolEquipmentRecord[];
  supervisedRequirements?: SupervisedRequirements | null | undefined;
  denialReasons: string[];
  assessedByUserId?: string | null | undefined;
  assessedAt?: string | null | undefined;
  validUntil?: string | null | undefined;
  decisionNotes?: string | null | undefined;
  appealHistory: AppealRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityEvaluationResult {
  eligible: boolean;
  contractorId: string;
  issueTypeId: string;
  status: CapabilityAssessmentStatus | "NOT_FOUND";
  approvedComplexityTier?: ComplexityTier | undefined;
  requiredComplexityTier?: ComplexityTier | undefined;
  approvedMaxJobValueCents?: number | undefined;
  estimatedJobValueCents?: number | undefined;
  supervised: boolean;
  provisional: boolean;
  supervisorRequiredOnSite: boolean;
  mandatorySupervisorSignoff: boolean;
  failClosedReason?: string | undefined;
  restrictions: string[];
  evaluatedAt: string;
}

export const workerIdentityMethods = [
  "GOVT_PHOTO_ID",
  "BIOMETRIC_CHECK",
  "SUPERVISOR_CONFIRMATION",
  "DISPATCHER_OVERRIDE",
] as const;
export type WorkerIdentityMethod = (typeof workerIdentityMethods)[number];

export const preDispatchDenyCodes = [
  "REGULATORY_POLICY_DEFICIENCY",
  "REGULATORY_CREDENTIAL_LAPSED",
  "CAPABILITY_NOT_FOUND",
  "CAPABILITY_SCOPE_MISMATCH",
  "CAPABILITY_ASSESSMENT_NOT_APPROVED",
  "INSUFFICIENT_COMPLEXITY_TIER",
  "EXCEEDS_MAX_JOB_VALUE_CEILING",
  "UNAUTHORIZED_WORKER_SUBSTITUTION",
  "CONTRACTOR_COMPANY_MISMATCH",
  "TECHNICIAN_NOT_ACTIVE",
  "CONTRACTOR_NOT_VERIFIED",
  "WORKER_IDENTITY_UNVERIFIED",
  "INSURANCE_GAP_DETECTED",
] as const;
export type PreDispatchDenyCode = (typeof preDispatchDenyCodes)[number];

export interface EvidenceSnapshot {
  snapshotVersion: number;
  capturedAt: string;
  regulatoryPolicy?: {
    policyId: string;
    policyVersion: number;
    verticalSlug: string;
    categorySlug?: string | undefined;
    variantSlug?: string | undefined;
    geography: string;
    verifiedContractorCredentialCodes: string[];
    verifiedTechnicianCredentialCodes: string[];
  } | null | undefined;
  capabilityAssessment?: {
    assessmentId: string;
    status: CapabilityAssessmentStatus;
    complexityTier: ComplexityTier;
    maxJobValueCents: number;
    validUntil?: string | null | undefined;
    supervised: boolean;
    provisional: boolean;
  } | null | undefined;
  contractor: {
    contractorId: string;
    companyName: string;
    status: string;
  };
  technician: {
    technicianId: string;
    displayName: string;
    active: boolean;
    credentials: Array<{
      code: string;
      status: CredentialStatus;
      expiryDate?: string | null | undefined;
    }>;
  };
  jurisdiction: string;
  serviceScope: {
    verticalId: string;
    verticalSlug?: string | undefined;
    categoryId?: string | null | undefined;
    categorySlug?: string | null | undefined;
    issueTypeId?: string | null | undefined;
    variantSlug?: string | null | undefined;
    urgency?: BookingUrgency | undefined;
  };
}

export interface PreDispatchEvaluationResult {
  eligible: boolean;
  serviceRequestId: string;
  contractorId: string;
  technicianId: string;
  failClosedReason?: string | undefined;
  denyCodes: PreDispatchDenyCode[];
  evidenceSnapshot: EvidenceSnapshot;
  requiresSupervisorOnSite: boolean;
  mandatorySupervisorSignoff: boolean;
  evaluatedAt: string;
}

export interface PreWorkCheckResult {
  allowedToCommence: boolean;
  jobId: string;
  workerIdentityVerified: boolean;
  workerIdentityMethod?: WorkerIdentityMethod | null | undefined;
  failClosedReason?: string | undefined;
  denyCodes: PreDispatchDenyCode[];
  evaluatedAt: string;
}

export interface WorkerIdentityVerificationInput {
  method: WorkerIdentityMethod;
  documentReference?: string | undefined;
  verifiedByUserId: string;
  notes?: string | undefined;
}

