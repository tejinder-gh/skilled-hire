// packages/contracts/src/property-passport.ts

export type PropertyAssetWarrantyStatus =
  | "ACTIVE"
  | "EXPIRED"
  | "UNKNOWN"
  | "EXTENDED";

export type AccessGrantScope =
  | "FULL_HISTORY"
  | "SERVICE_SPECIFIC"
  | "REDACTED_COMMERCIAL";

export type AccessGrantStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export type OwnershipTransferStatus =
  | "PENDING"
  | "VERIFIED_ACCEPTED"
  | "CANCELLED"
  | "REJECTED";

export interface PropertyAsset {
  id: string;
  propertyId: string;
  verticalId: string;
  name: string;
  assetType: string;
  manufacturer?: string | null | undefined;
  modelNumber?: string | null | undefined;
  serialNumber?: string | null | undefined;
  installedOn?: string | null | undefined;
  warrantyStatus: PropertyAssetWarrantyStatus;
  lastServiceRecordId?: string | null | undefined;
  lastServicedAt?: string | null | undefined;
  installedByContractorId?: string | null | undefined;
  metadata: Record<string, unknown>;
}

export interface PropertyAccessGrant {
  id: string;
  propertyId: string;
  granteeContractorId: string;
  grantedByUserId: string;
  scope: AccessGrantScope;
  serviceVerticalId?: string | null | undefined;
  reason?: string | null | undefined;
  status: AccessGrantStatus;
  expiresAt: string;
  revokedAt?: string | null | undefined;
  revokedByUserId?: string | null | undefined;
  createdAt: string;
}

export interface PropertyOwnershipTransfer {
  id: string;
  propertyId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  status: OwnershipTransferStatus;
  verificationToken: string;
  verifiedAt?: string | null | undefined;
  transferNotes?: string | null | undefined;
  createdAt: string;
}

export interface PassportServiceHistoryItem {
  serviceRecordId: string;
  jobId: string;
  completedAt: string;
  vertical: string;
  summary: string;
  contractorName?: string | undefined;
  costRedacted: boolean;
  regulatoryStatus?: string | undefined;
  documentationPackageId?: string | null | undefined;
  completionReportId?: string | null | undefined;
}

export interface PropertyPassportView {
  propertyId: string;
  label: string;
  address: {
    addressLine1: string;
    city: string;
    region: string;
    postalCode: string;
  };
  assets: PropertyAsset[];
  serviceHistory: PassportServiceHistoryItem[];
  activeGrants: PropertyAccessGrant[];
  isOwner: boolean;
  accessScope: AccessGrantScope;
}
