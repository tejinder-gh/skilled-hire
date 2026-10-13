export type ProviderApplicationStatus =
  | "PROSPECT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED"
  | "ABANDONED";

export type BusinessType =
  | "CORPORATION"
  | "SOLE_PROPRIETORSHIP"
  | "PARTNERSHIP";

export type ApprovalDecision =
  | "APPROVED"
  | "CONDITIONALLY_APPROVED"
  | "REJECTED";

export type BackgroundCheckStatus =
  | "PENDING"
  | "CLEARED"
  | "FLAGGED"
  | "EXEMPT";

export interface ProviderRateProposal {
  verticalSlug: string;
  hourlyRateCents: number;
  diagnosticFeeCents: number;
  emergencyRateMultiplierBps?: number | undefined;
}

export interface TechnicianRosterInput {
  fullName: string;
  email: string;
  phone: string;
  tradeLicenseCode: string;
  licenseNumber: string;
  licenseExpiry: string;
  isEmergencyAvailable?: boolean | undefined;
}

export interface ProviderDraftApplicationInput {
  prospectEmail: string;
  businessName: string;
  businessNumber?: string | undefined;
  businessType?: BusinessType | undefined;
  phone: string;
  postalCodes?: string[] | undefined;
  selectedVerticals?: string[] | undefined;
  serviceRatesProposal?: ProviderRateProposal[] | undefined;
  weeklyCapacity?: number | undefined;
  draftStep?: number | undefined;
  draftPayload?: Record<string, unknown> | undefined;
  saveToken?: string | undefined;
}

export interface ProviderSubmitApplicationInput {
  saveToken: string;
  businessNumber: string;
  businessType: BusinessType;
  postalCodes: string[];
  selectedVerticals: string[];
  serviceRatesProposal: ProviderRateProposal[];
  weeklyCapacity: number;
  technicians: TechnicianRosterInput[];
  consentAccepted: boolean;
  applicantUserId?: string | undefined;
}

export interface ServiceGeographyDecision {
  verticalSlug: string;
  territoryCode: string;
  status: ApprovalDecision;
  reason?: string | undefined;
}

export interface ProviderApplicationReviewInput {
  decision: "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO";
  reviewNotes?: string | undefined;
  serviceGeographyDecisions: ServiceGeographyDecision[];
  convertAndProvision?: boolean | undefined;
}

export interface ProviderServiceGeographyApprovalDTO {
  id: string;
  applicationId: string;
  contractorId?: string | undefined;
  verticalSlug: string;
  territoryCode: string;
  status: string;
  decisionReason?: string | undefined;
  reviewedAt?: string | undefined;
}

export interface ProviderTechnicianRosterDTO {
  id: string;
  applicationId: string;
  fullName: string;
  email: string;
  phone: string;
  tradeLicenseCode: string;
  licenseNumber: string;
  licenseExpiry: string;
  backgroundCheckStatus: BackgroundCheckStatus;
  isEmergencyAvailable: boolean;
  createdAt: string;
}

export interface ProviderApplicationDTO {
  id: string;
  prospectEmail: string;
  businessName: string;
  businessNumber?: string | undefined;
  businessType: BusinessType;
  phone: string;
  postalCodes: string[];
  selectedVerticals: string[];
  serviceRatesProposal: ProviderRateProposal[];
  weeklyCapacity: number;
  technicianCount: number;
  status: ProviderApplicationStatus;
  saveToken: string;
  draftStep: number;
  draftPayload?: Record<string, unknown> | undefined;
  consentAccepted: boolean;
  consentAcceptedAt?: string | undefined;
  applicantUserId?: string | undefined;
  convertedContractorId?: string | undefined;
  reviewedByUserId?: string | undefined;
  reviewNotes?: string | undefined;
  createdAt: string;
  updatedAt: string;
  approvals?: ProviderServiceGeographyApprovalDTO[] | undefined;
  technicians?: ProviderTechnicianRosterDTO[] | undefined;
}

export interface ProviderOnboardingDraftResponse {
  applicationId: string;
  saveToken: string;
  status: ProviderApplicationStatus;
  draftStep: number;
  expiresInDays: number;
  message: string;
}
