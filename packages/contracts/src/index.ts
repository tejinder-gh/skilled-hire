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
  "CONTRACTOR_SAFETY_SUSPENDED",
  "CONTRACTOR_QUARANTINED_SCOPE",
  "TECHNICIAN_SAFETY_SUSPENDED",
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

// Safety Incident Response, Suspension, Quality Audits & Remediation (#58)
export const safetyIncidentSeverities = [
  "CRITICAL_EMERGENCY",
  "MAJOR_SAFETY",
  "MODERATE_DEFECT",
  "MINOR_HAZARD",
] as const;
export type SafetyIncidentSeverity = (typeof safetyIncidentSeverities)[number];

export const safetyIncidentStatuses = [
  "REPORTED",
  "TRIAGED",
  "INVESTIGATING",
  "QUARANTINED",
  "REMEDIATING",
  "RESOLVED",
  "APPEALED",
  "CLOSED",
] as const;
export type SafetyIncidentStatus = (typeof safetyIncidentStatuses)[number];

export const safetyIncidentTypes = [
  "ELECTRICAL_HAZARD_SHOCK",
  "GAS_LEAK_FIRE_RISK",
  "STRUCTURAL_COLLAPSE_RISK",
  "WATER_DAMAGE_FLOODING",
  "CARBON_MONOXIDE",
  "PROPERTY_DAMAGE_MAJOR",
  "REGULATORY_CODE_VIOLATION",
  "UNAUTHORIZED_UNQUALIFIED_WORK",
] as const;
export type SafetyIncidentType = (typeof safetyIncidentTypes)[number];

export const safetyActionTypes = [
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
] as const;
export type SafetyActionType = (typeof safetyActionTypes)[number];

export const quarantineTypes = [
  "FULL_CONTRACTOR_SUSPENSION",
  "TECHNICIAN_SUSPENSION",
  "VERTICAL_SCOPE_RESTRICTION",
  "PROVISIONAL_AUDIT_SUPERVISION",
] as const;
export type QuarantineType = (typeof quarantineTypes)[number];

export const qualityAuditStatuses = [
  "SCHEDULED",
  "IN_PROGRESS",
  "PASSED",
  "DEFECTS_IDENTIFIED",
  "FAILED_CRITICAL",
] as const;
export type QualityAuditStatus = (typeof qualityAuditStatuses)[number];

export const qualityAuditTriggerTypes = [
  "INCIDENT_REMEDIATION",
  "REPEAT_DEFECT_FLAG",
  "RANDOM_SPOT_CHECK",
  "HIGH_RISK_TRADE",
  "CUSTOMER_DISPUTE",
] as const;
export type QualityAuditTriggerType = (typeof qualityAuditTriggerTypes)[number];

export const contractorSafetyStatuses = [
  "ACTIVE",
  "PROBATION",
  "RESTRICTED",
  "SUSPENDED",
] as const;
export type ContractorSafetyStatus = (typeof contractorSafetyStatuses)[number];

export interface QuarantineScope {
  contractorSuspended?: boolean | undefined;
  technicianSuspended?: boolean | undefined;
  restrictedVerticalIds?: string[] | undefined;
  restrictedIssueTypeIds?: string[] | undefined;
  provisionalAuditRequired?: boolean | undefined;
}

export interface EvidenceLockerItem {
  id: string;
  title: string;
  fileKey?: string | undefined;
  url?: string | undefined;
  artifactType:
    | "PHOTO"
    | "VIDEO"
    | "INSPECTOR_REPORT"
    | "METER_READING"
    | "INCIDENT_FORM"
    | "INSURER_NOTICE";
  checksumSha256?: string | undefined;
  uploadedByUserId: string;
  uploadedAt: string;
  chainOfCustodyVerified: boolean;
  notes?: string | undefined;
}

export interface ContainmentAction {
  id: string;
  action: string;
  executedBy: string;
  executedAt: string;
  confirmedSafe: boolean;
  notes?: string | undefined;
}

export interface SafetyIncident {
  id: string;
  incidentNumber: string;
  jobId?: string | null | undefined;
  serviceRequestId?: string | null | undefined;
  propertyId?: string | null | undefined;
  contractorId: string;
  technicianId?: string | null | undefined;
  reportedByUserId: string;
  reporterRole: string;
  severity: SafetyIncidentSeverity;
  status: SafetyIncidentStatus;
  incidentType: SafetyIncidentType;
  title: string;
  description: string;
  occurredAt: string;
  reportedAt: string;
  containmentActions: ContainmentAction[];
  evidenceLocker: EvidenceLockerItem[];
  insurerNotified: boolean;
  insurerNotifiedAt?: string | null | undefined;
  insurerClaimReference?: string | null | undefined;
  legalRetentionHold: boolean;
  quarantineScope: QuarantineScope;
  triageNotes?: string | null | undefined;
  triagedByUserId?: string | null | undefined;
  triagedAt?: string | null | undefined;
  independentReviewNotes?: string | null | undefined;
  reviewedByUserId?: string | null | undefined;
  reviewedAt?: string | null | undefined;
  resolutionSummary?: string | null | undefined;
  resolvedAt?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface SafetyIncidentAction {
  id: string;
  incidentId: string;
  actorUserId: string;
  actionType: SafetyActionType;
  previousStatus?: string | null | undefined;
  newStatus?: string | null | undefined;
  actionPayload: Record<string, unknown>;
  notes?: string | null | undefined;
  createdAt: string;
}

export interface ContractorSafetyQuarantine {
  id: string;
  incidentId: string;
  contractorId: string;
  technicianId?: string | null | undefined;
  quarantineType: QuarantineType;
  restrictedVerticalIds: string[];
  restrictedIssueTypeIds: string[];
  active: boolean;
  reason: string;
  issuedByUserId: string;
  issuedAt: string;
  liftedAt?: string | null | undefined;
  liftedByUserId?: string | null | undefined;
  liftingNotes?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface QualityAudit {
  id: string;
  auditNumber: string;
  jobId?: string | null | undefined;
  contractorId: string;
  technicianId?: string | null | undefined;
  incidentId?: string | null | undefined;
  triggerType: QualityAuditTriggerType;
  inspectorUserId?: string | null | undefined;
  status: QualityAuditStatus;
  findings: Array<{
    code: string;
    description: string;
    severity: string;
    rectified: boolean;
  }>;
  repeatDefectCount: number;
  remediationRequired: boolean;
  remediationDeadline?: string | null | undefined;
  remediationCompletedAt?: string | null | undefined;
  reportNotes?: string | null | undefined;
  conductedAt?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

// Electrical Permits, Inspection Evidence & ESA Compliance (#59)
export const permitStatuses = [
  "FILED",
  "DISCONNECT_SCHEDULED",
  "DISCONNECTED",
  "WORK_COMPLETED",
  "INSPECTION_REQUESTED",
  "DEFICIENCIES_RECORDED",
  "CERTIFICATE_ISSUED",
  "EXCEPTION_APPROVED",
  "CLOSED",
] as const;
export type PermitStatus = (typeof permitStatuses)[number];

export const inspectionStatuses = [
  "NOT_REQUESTED",
  "REQUESTED",
  "SCHEDULED",
  "DEFICIENCIES_ISSUED",
  "PASSED",
  "WAIVED_EXCEPTION",
] as const;
export type InspectionStatus = (typeof inspectionStatuses)[number];

export const regulatorySignOffStatuses = [
  "NOT_APPLICABLE",
  "PENDING",
  "DEFICIENCIES_OUTSTANDING",
  "FULLY_ACCEPTED",
  "EXCEPTION_APPROVED",
] as const;
export type RegulatorySignOffStatus =
  (typeof regulatorySignOffStatuses)[number];

export const defectSeverities = ["CRITICAL", "MAJOR", "MINOR"] as const;
export type DefectSeverity = (typeof defectSeverities)[number];

export const defectStatuses = [
  "OPEN",
  "RECTIFIED",
  "CLEARED_BY_INSPECTOR",
] as const;
export type DefectStatus = (typeof defectStatuses)[number];

export const regulatoryAcceptanceDenyCodes = [
  "PERMIT_NOT_FILED",
  "UNRESOLVED_ESA_DEFICIENCIES",
  "MISSING_CERTIFICATE_OF_ACCEPTANCE",
  "ECRA_LICENSE_MISMATCH",
  "REGULATORY_EXCEPTION_NOT_DOCUMENTED",
] as const;
export type RegulatoryAcceptanceDenyCode =
  (typeof regulatoryAcceptanceDenyCodes)[number];

export interface ElectricalPermit {
  id: string;
  permitNumber: string;
  jobId: string;
  propertyId: string;
  contractorId: string;
  technicianId?: string | null | undefined;
  jurisdiction: string;
  permitAuthority: string;
  permitType: string;
  esaNotificationNumber: string;
  ecraLicenseNumber: string;
  designatedMasterElectrician: string;
  scopeOfWork: string;
  status: PermitStatus;
  utilityDisconnectRequired: boolean;
  utilityProvider?: string | null | undefined;
  utilityMeterNumber?: string | null | undefined;
  utilityDisconnectDate?: string | null | undefined;
  utilityReconnectAuthorizationCode?: string | null | undefined;
  utilityReconnectDate?: string | null | undefined;
  inspectionStatus: InspectionStatus;
  inspectorName?: string | null | undefined;
  inspectorBadgeNumber?: string | null | undefined;
  inspectedAt?: string | null | undefined;
  certificateOfAcceptanceNumber?: string | null | undefined;
  certificateOfAcceptanceUrl?: string | null | undefined;
  certificateOfAcceptanceIssuedAt?: string | null | undefined;
  documentedExceptionReason?: string | null | undefined;
  documentedExceptionApprovedByUserId?: string | null | undefined;
  documentedExceptionAt?: string | null | undefined;
  regulatorySignOffStatus: RegulatorySignOffStatus;
  provenanceAudit: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PermitDeficiency {
  id: string;
  permitId: string;
  defectCode: string;
  severity: DefectSeverity;
  description: string;
  correctiveActionRequired: string;
  status: DefectStatus;
  issuedAt: string;
  rectifiedAt?: string | null | undefined;
  rectifiedByUserId?: string | null | undefined;
  rectificationNotes?: string | null | undefined;
  rectificationEvidenceUrl?: string | null | undefined;
  clearedAt?: string | null | undefined;
  clearedByInspector?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ElectricalAcceptanceEvaluation {
  canFullyAccept: boolean;
  regulatorySignOffStatus: RegulatorySignOffStatus;
  workFinished: boolean;
  regulatorySignOffAchieved: boolean;
  missingItems: RegulatoryAcceptanceDenyCode[];
  permit: ElectricalPermit | null;
  deficiencies: PermitDeficiency[];
  customerSummary: {
    requiresPermit: boolean;
    permitAuthority: string;
    esaNotificationNumber?: string | undefined;
    ecraLicenseNumber?: string | undefined;
    certificateOfAcceptanceNumber?: string | undefined;
    utilityDisconnectCoordinated: boolean;
    hasOutstandingDefects: boolean;
    missingArtifactsText: string[];
  };
}

// 15. Versioned Job Risk Scoring & Dispatch Controls (#60)
export const hazardFlags = [
  "LIVE_ELECTRICAL_WORK",
  "HIGH_VOLTAGE",
  "GAS_COMBUSTION",
  "CONFINED_SPACE",
  "WORKING_AT_HEIGHTS",
  "STRUCTURAL_LOAD_BEARING",
  "HAZARDOUS_MATERIALS_ASBESTOS",
  "WATER_PROXIMITY_ELECTRICAL",
] as const;
export type HazardFlag = (typeof hazardFlags)[number];

export const hazardSeverities = ["RED_FLAG", "HIGH", "MODERATE"] as const;
export type HazardSeverity = (typeof hazardSeverities)[number];

export const manualApprovalStatuses = [
  "NOT_REQUIRED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
] as const;
export type ManualApprovalStatus = (typeof manualApprovalStatuses)[number];

export const riskDenyCodes = [
  "CRITICAL_RISK_MANUAL_APPROVAL_REQUIRED",
  "UNFULFILLED_MANDATORY_SAFETY_CONTROLS",
  "HAZARD_FLAG_RESTRICTION",
  "CONTRACTOR_TIER_INSUFFICIENT",
] as const;
export type RiskDenyCode = (typeof riskDenyCodes)[number];

export interface MandatoryControlItem {
  control: string;
  description: string;
  requiredFor: string;
  fulfilled: boolean;
  fulfilledAt?: string | null | undefined;
  fulfilledByUserId?: string | null | undefined;
  notes?: string | null | undefined;
  evidenceUrl?: string | null | undefined;
}

export interface RiskDecisionLog {
  baseScore: number;
  complexityAdjustment: number;
  valueAdjustment: number;
  hazardFlagAdjustments: Array<{
    flag: string;
    add: number;
    severity: string;
    reason: string;
  }>;
  totalInherent: number;
  mitigationsApplied: Array<{
    mitigation: string;
    deduction: number;
    verified: boolean;
  }>;
  totalMitigations: number;
  residualScore: number;
  calculatedTier: RiskTier;
  redFlagTriggered: boolean;
  triggerReasons: string[];
  mandatoryControlsMandated: string[];
}

export interface RiskPolicy {
  id: string;
  version: string;
  name: string;
  isActive: boolean;
  effectiveDate: string;
  dimensionsConfig: Record<string, unknown>;
  hazardFlagRules: Array<{
    flag: string;
    severity: string;
    inherentAdd: number;
    requiresManualApproval: boolean;
  }>;
  tierThresholds: {
    lowMax: number;
    moderateMax: number;
    highMax: number;
    criticalMin: number;
  };
  mandatoryControlsConfig: Array<{
    trigger: string;
    control: string;
  }>;
  calibrationNotes?: string | null | undefined;
  provenanceAudit: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface JobRiskAssessment {
  id: string;
  jobId: string | null;
  serviceRequestId?: string | null | undefined;
  policyId: string;
  policyVersion: string;
  inherentScore: number;
  mitigationsScore: number;
  residualScore: number;
  riskTier: RiskTier;
  hazardFlags: HazardFlag[];
  mandatoryControls: MandatoryControlItem[];
  verifiedControls: MandatoryControlItem[];
  decisionLog: RiskDecisionLog;
  requiresManualApproval: boolean;
  manualApprovalStatus: ManualApprovalStatus;
  manualApprovedByUserId?: string | null | undefined;
  manualApprovedAt?: string | null | undefined;
  manualApprovalNotes?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface RiskEvaluationResult {
  canDispatch: boolean;
  riskTier: RiskTier;
  inherentScore: number;
  mitigationsScore: number;
  residualScore: number;
  hazardFlags: HazardFlag[];
  mandatoryControls: MandatoryControlItem[];
  unfulfilledControls: string[];
  requiresManualApproval: boolean;
  manualApprovalStatus: ManualApprovalStatus;
  denyCodes: RiskDenyCode[];
  decisionLog: RiskDecisionLog;
}

export * from "./legal.js";
export * from "./insurance.js";
export * from "./risk-documentation.js";




