export type FileScanStatus = "PENDING_SCAN" | "CLEAN" | "QUARANTINED" | "REJECTED";

export type FileAttachmentStatus =
  | "INITIATED"
  | "UPLOADED"
  | "ACTIVE"
  | "DELETED"
  | "QUARANTINED";

export type FileVisibility =
  | "PRIVATE"
  | "CUSTOMER_VISIBLE"
  | "CONTRACTOR_VISIBLE"
  | "SHARED"
  | "INTERNAL_ONLY";

export type FileCategory =
  | "JOB_BEFORE_PHOTO"
  | "JOB_IN_PROGRESS_PHOTO"
  | "JOB_AFTER_PHOTO"
  | "SERVICE_REQUEST_ATTACHMENT"
  | "DISPUTE_EVIDENCE"
  | "CONTRACTOR_CREDENTIAL"
  | "INSURANCE_CLAIM_EVIDENCE"
  | "WARRANTY_CLAIM_EVIDENCE"
  | "SERVICE_RECOMMENDATION_PHOTO"
  | "GENERAL_DOCUMENT";

export interface PresignedUploadInitiateInput {
  fileName: string;
  mimeType: string;
  byteSize: number;
  category: FileCategory;
  visibility?: FileVisibility | undefined;
  contractorId?: string | undefined;
  customerId?: string | undefined;
  jobId?: string | undefined;
  serviceRequestId?: string | undefined;
}

export interface PresignedUploadInitiateResponse {
  fileId: string;
  storageKey: string;
  uploadUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
  maxByteSize: number;
}

export interface PresignedUploadFinalizeInput {
  fileId: string;
  storageKey: string;
  sha256Checksum?: string | undefined;
  byteSize?: number | undefined;
  contentBase64?: string | undefined;
}

export interface PresignedUploadFinalizeResponse {
  fileId: string;
  storageKey: string;
  status: FileAttachmentStatus;
  scanStatus: FileScanStatus;
  quarantineReason?: string | null | undefined;
  signedUrl?: string | null | undefined;
}

export interface FileAttachmentDTO {
  id: string;
  storageKey: string;
  ownerUserId: string;
  contractorId?: string | null | undefined;
  customerId?: string | null | undefined;
  jobId?: string | null | undefined;
  serviceRequestId?: string | null | undefined;
  category: FileCategory;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256Checksum?: string | null | undefined;
  scanStatus: FileScanStatus;
  quarantineReason?: string | null | undefined;
  visibility: FileVisibility;
  status: FileAttachmentStatus;
  uploadedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface SignedFileDownloadResponse {
  fileId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  downloadUrl: string;
  expiresAt: string;
}
