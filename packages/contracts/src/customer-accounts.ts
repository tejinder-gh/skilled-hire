// packages/contracts/src/customer-accounts.ts

export type PropertyType =
  | "DETACHED"
  | "SEMI_DETACHED"
  | "TOWNHOUSE"
  | "CONDO"
  | "COMMERCIAL";

export interface CustomerProfileDTO {
  id: string;
  email: string;
  fullName: string;
  phoneNumber?: string | null | undefined;
  role: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  propertiesCount: number;
  activeServiceRequestsCount: number;
  completedJobsCount: number;
  courtesyCreditBalanceCents: number;
  createdAt: string;
}

export interface CustomerPropertyDTO {
  id: string;
  customerId: string;
  label: string;
  addressLine1: string;
  unitNumber?: string | null | undefined;
  city: string;
  region: string;
  postalCode: string;
  propertyType: PropertyType;
  accessNotes?: string | null | undefined;
  isPrimary: boolean;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  equipmentCount?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePropertyRequest {
  label: string;
  addressLine1: string;
  unitNumber?: string | undefined;
  city: string;
  region: string;
  postalCode: string;
  propertyType?: PropertyType | undefined;
  accessNotes?: string | undefined;
  isPrimary?: boolean | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export interface UpdatePropertyRequest {
  label?: string | undefined;
  addressLine1?: string | undefined;
  unitNumber?: string | undefined;
  city?: string | undefined;
  region?: string | undefined;
  postalCode?: string | undefined;
  propertyType?: PropertyType | undefined;
  accessNotes?: string | undefined;
  isPrimary?: boolean | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export interface UpdateCustomerProfileRequest {
  fullName?: string | undefined;
  phoneNumber?: string | undefined;
}

export interface BookingDraftDTO {
  id: string;
  customerId: string;
  step: number;
  draftPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SaveBookingDraftRequest {
  step: number;
  draftPayload: Record<string, unknown>;
}

export interface BookingReceiptDTO {
  serviceRequestId: string;
  referenceNumber: string;
  status: string;
  customerId: string;
  customerName: string;
  customerPhone?: string | undefined;
  propertyId: string;
  propertyLabel: string;
  propertyAddress: string;
  verticalSlug: string;
  tradeName: string;
  categoryName: string;
  issueName: string;
  urgency: "STANDARD" | "EMERGENCY";
  description: string;
  equipmentSummary?: string | undefined;
  scheduledStart?: string | undefined;
  scheduledEnd?: string | undefined;
  basePriceCents: number;
  protectionCoverageCents: number;
  guaranteeSummary: string;
  cancellationPolicySummary: string;
  statutoryDisclosures: string[];
  submittedAt: string;
}
