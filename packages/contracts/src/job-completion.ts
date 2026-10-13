// packages/contracts/src/job-completion.ts

export type CompletionReportStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "ACCEPTED"
  | "DISPUTED"
  | "SUPERSEDED";

export type CompletionSyncStatus = "OFFLINE_DRAFT" | "SYNCED" | "SYNC_CONFLICT";

export interface InstalledPart {
  partNumber: string;
  description: string;
  quantity: number;
  unitCostCents?: number | undefined;
  supplierReceiptUrl?: string | undefined;
  warrantyMonths?: number | undefined;
}

export interface PerformedTest {
  testName: string;
  result: "PASS" | "FAIL" | "INCONCLUSIVE";
  measuredValue?: string | undefined;
  unit?: string | undefined;
  notes?: string | undefined;
}

export interface CompletionPhoto {
  url: string;
  caption?: string | undefined;
  timestamp?: string | undefined;
  phase: "BEFORE" | "AFTER";
}

export interface OutstandingIssue {
  description: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  actionRequired: string;
}

export interface MaintenanceRecommendation {
  recommendation: string;
  recommendedIntervalDays?: number | undefined;
  priority: "LOW" | "RECOMMENDED" | "URGENT";
}

export interface ContractorAttestation {
  attested: boolean;
  attestedByUserId?: string | undefined;
  attestedAt?: string | undefined;
  technicianName?: string | undefined;
  licenseNumber?: string | undefined;
}

export interface CustomerAcceptance {
  accepted: boolean;
  acceptedByUserId?: string | undefined;
  acceptedAt?: string | undefined;
  notes?: string | undefined;
  signatureDigest?: string | undefined;
}

export interface JobCompletionReport {
  id: string;
  jobId: string;
  serviceRequestId: string;
  contractorId: string;
  technicianId?: string | null | undefined;
  propertyId: string;
  reportNumber: string;
  version: number;
  status: CompletionReportStatus;
  syncStatus: CompletionSyncStatus;
  clientMutationId?: string | null | undefined;
  workSummary: string;
  diagnosis: string;
  workStartedAt: string;
  workCompletedAt: string;
  assetId?: string | null | undefined;
  partsInstalled: InstalledPart[];
  testsPerformed: PerformedTest[];
  beforePhotos: CompletionPhoto[];
  afterPhotos: CompletionPhoto[];
  permitId?: string | null | undefined;
  outstandingIssues: OutstandingIssue[];
  maintenanceRecommendations: MaintenanceRecommendation[];
  contractorAttestation: ContractorAttestation;
  customerAcceptance: CustomerAcceptance;
  disputeReason?: string | null | undefined;
  disputedAt?: string | null | undefined;
  disputedByUserId?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CompletionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  requiredTestsPassed: boolean;
  permitRequired: boolean;
  attestationComplete: boolean;
}
