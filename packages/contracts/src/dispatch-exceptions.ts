export type DispatchExceptionType =
  | "TECHNICIAN_DECLINE"
  | "TECHNICIAN_NO_SHOW"
  | "TECHNICIAN_LATE_ARRIVAL"
  | "DISPATCH_OFFER_TIMEOUT"
  | "FAILED_DISPATCH"
  | "CUSTOMER_CANCELLATION"
  | "CONTRACTOR_CANCELLATION"
  | "FORCE_MAJEURE_WEATHER";

export type DispatchExceptionSeverity =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type DispatchExceptionStatus =
  | "OPEN"
  | "RESOLVED"
  | "ESCALATED"
  | "WAIVED";

export type DispatchResolutionType =
  | "REASSIGNED"
  | "RESCHEDULED"
  | "REFUNDED_FULL"
  | "REFUNDED_PARTIAL_WITH_FEE"
  | "COMPENSATION_CREDIT_ISSUED"
  | "CANCELLED_NO_FEE";

export type CancellationPolicyType =
  | "FREE_CANCELLATION_WINDOW"
  | "LATE_CUSTOMER_CANCELLATION_FEE"
  | "CONTRACTOR_FAULT_FULL_REFUND_WITH_CREDIT"
  | "FORCE_MAJEURE_WAIVER"
  | "DISPATCH_TIMEOUT_AUTO_CANCEL";

export type CancellationReason =
  | "CUSTOMER_SCHEDULE_CONFLICT"
  | "CUSTOMER_NO_LONGER_NEEDED"
  | "CUSTOMER_ACCIDENTAL_BOOKING"
  | "CUSTOMER_PRICE_DISSATISFACTION"
  | "CONTRACTOR_EMERGENCY"
  | "CONTRACTOR_EQUIPMENT_BREAKDOWN"
  | "CONTRACTOR_OVERBOOKED"
  | "TECHNICIAN_NO_SHOW"
  | "DISPATCH_SLA_EXCEEDED"
  | "SEVERE_WEATHER_HAZARD"
  | "OTHER";

export interface DispatchExceptionDTO {
  id: string;
  serviceRequestId: string;
  jobId?: string | null | undefined;
  contractorId?: string | null | undefined;
  technicianId?: string | null | undefined;
  exceptionType: DispatchExceptionType;
  reason: string;
  notes?: string | null | undefined;
  severity: DispatchExceptionSeverity;
  status: DispatchExceptionStatus;
  slaDeadlineAt: string;
  escalatedAt?: string | null | undefined;
  resolvedAt?: string | null | undefined;
  resolvedByUserId?: string | null | undefined;
  resolutionType?: DispatchResolutionType | null | undefined;
  compensationAmountCents: number;
  feeAmountCents: number;
  customerCreditCents: number;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface JobCancellationDTO {
  id: string;
  jobId?: string | null | undefined;
  serviceRequestId: string;
  cancelledByRole: "CUSTOMER" | "CONTRACTOR" | "OPERATIONS" | "SYSTEM";
  cancelledByUserId: string;
  cancellationReason: CancellationReason | string;
  cancellationNotes?: string | null | undefined;
  policyApplied: CancellationPolicyType;
  originalAmountPaidCents: number;
  cancellationFeeCents: number;
  refundAmountCents: number;
  contractorPayoutCents: number;
  customerCreditCents: number;
  contractorPenaltyCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerServiceCreditDTO {
  id: string;
  customerId: string;
  amountCents: number;
  balanceCents: number;
  reason: string;
  referenceType?: string | null | undefined;
  referenceId?: string | null | undefined;
  expiresAt?: string | null | undefined;
  status: "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "REVOKED";
  createdAt: string;
  updatedAt: string;
}

export interface ContractorDispatchPenaltyDTO {
  id: string;
  contractorId: string;
  technicianId?: string | null | undefined;
  jobId?: string | null | undefined;
  strikeType: string;
  penaltyAmountCents: number;
  strikePoints: number;
  notes?: string | null | undefined;
  status: "ACTIVE" | "APPEALED" | "WAIVED";
  createdAt: string;
  updatedAt: string;
}

export interface CancellationQuoteRequest {
  jobId: string;
  cancelledByRole?: "CUSTOMER" | "CONTRACTOR" | "OPERATIONS" | undefined;
}

export interface CancellationQuoteResponse {
  jobId: string;
  scheduledStartsAt?: string | null | undefined;
  minutesUntilStart: number;
  policyApplied: CancellationPolicyType;
  originalAmountPaidCents: number;
  cancellationFeeCents: number;
  refundAmountCents: number;
  contractorPayoutCents: number;
  customerCreditCents: number;
  explanation: string;
  canCancelFree: boolean;
  freeCancellationDeadline?: string | null | undefined;
}

export interface CancelJobRequest {
  reason: CancellationReason | string;
  notes?: string | undefined;
  forceMajeure?: boolean | undefined;
}

export interface CancelJobResponse {
  cancellation: JobCancellationDTO;
  jobId: string;
  jobStatus: string;
  refundProcessed: boolean;
  refundAmountCents: number;
  cancellationFeeCents: number;
  outboxNotificationEnqueued: boolean;
}

export interface ReportNoShowRequest {
  notes?: string | undefined;
}

export interface ReportNoShowResponse {
  exception: DispatchExceptionDTO;
  creditAwardedCents: number;
  creditId?: string | undefined;
  recoveryOptions: Array<"ACCEPT_REASSIGNMENT" | "RESCHEDULE_NEW_SLOT" | "FULL_REFUND_CANCEL">;
  message: string;
}

export interface ReassignJobRequest {
  newTechnicianId?: string | undefined;
  newContractorId?: string | undefined;
  overrideReason?: string | undefined;
  notes?: string | undefined;
}

export interface ReassignJobResponse {
  jobId: string;
  status: string;
  technicianId: string;
  technicianName: string;
  contractorId: string;
  contractorName: string;
  scheduledStartsAt?: string | null | undefined;
  scheduledEndsAt?: string | null | undefined;
  exceptionResolved: boolean;
}

export type CustomerRecoveryChoiceType =
  | "ACCEPT_REASSIGNMENT"
  | "RESCHEDULE_NEW_SLOT"
  | "FULL_REFUND_CANCEL";

export interface CustomerRecoveryChoiceRequest {
  action: CustomerRecoveryChoiceType;
  preferredStartsAt?: string | undefined;
  preferredEndsAt?: string | undefined;
  notes?: string | undefined;
}

export interface CustomerRecoveryChoiceResponse {
  jobId: string;
  actionTaken: "ACCEPT_REASSIGNMENT" | "RESCHEDULE_NEW_SLOT" | "FULL_REFUND_CANCEL";
  newJobStatus: string;
  refundAmountCents?: number | undefined;
  message: string;
}

export interface ResolveExceptionRequest {
  resolutionType: DispatchResolutionType;
  resolutionNotes?: string | undefined;
  compensationAmountCents?: number | undefined;
}

export interface ResolveExceptionResponse {
  exception: DispatchExceptionDTO;
  resolved: boolean;
}
