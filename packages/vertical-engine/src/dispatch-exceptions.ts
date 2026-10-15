import type {
  CancellationPolicyType,
  CancellationReason,
  DispatchExceptionSeverity,
  DispatchExceptionType,
} from "@marketplace/contracts";

export const FREE_CANCELLATION_WINDOW_MINUTES = 120; // 2 hours
export const LATE_CANCELLATION_FEE_CENTS = 5000; // $50.00 CAD
export const CONTRACTOR_NO_SHOW_PENALTY_CENTS = 5000; // $50.00 CAD
export const CONTRACTOR_NO_SHOW_STRIKE_POINTS = 1;
export const CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS = 2500; // $25.00 CAD
export const EMERGENCY_DISPATCH_SLA_MINUTES = 15;
export const STANDARD_DISPATCH_SLA_MINUTES = 30;
export const NO_SHOW_THRESHOLD_MINUTES = 30; // Minutes past start before no-show can be reported

export interface CancellationEvaluationInput {
  cancelledByRole: "CUSTOMER" | "CONTRACTOR" | "OPERATIONS" | "SYSTEM";
  scheduledStartsAt?: Date | string | null | undefined;
  technicianStatus?: string | null | undefined;
  amountPaidCents: number;
  reason?: CancellationReason | string | undefined;
  forceMajeure?: boolean | undefined;
  now?: Date | undefined;
}

export interface CancellationEvaluationResult {
  policyApplied: CancellationPolicyType;
  minutesUntilStart: number;
  originalAmountPaidCents: number;
  cancellationFeeCents: number;
  refundAmountCents: number;
  contractorPayoutCents: number;
  customerCreditCents: number;
  contractorPenaltyCents: number;
  canCancelFree: boolean;
  freeCancellationDeadline?: string | null | undefined;
  explanation: string;
}

/**
 * Pure business rule evaluator for Ontario marketplace cancellations.
 * Enforces consumer protection laws and fair contractor compensation.
 */
export function evaluateCancellationPolicy(
  input: CancellationEvaluationInput,
): CancellationEvaluationResult {
  const now = input.now ?? new Date();
  const scheduledTime = input.scheduledStartsAt
    ? new Date(input.scheduledStartsAt)
    : null;

  const minutesUntilStart = scheduledTime
    ? Math.round((scheduledTime.getTime() - now.getTime()) / (60 * 1000))
    : 9999;

  const originalAmountPaidCents = Math.max(0, input.amountPaidCents);

  // Calculate free cancellation deadline
  const freeCancellationDeadline = scheduledTime
    ? new Date(scheduledTime.getTime() - FREE_CANCELLATION_WINDOW_MINUTES * 60 * 1000).toISOString()
    : null;

  // 1. Force Majeure / Severe weather overrides
  if (input.forceMajeure) {
    return {
      policyApplied: "FORCE_MAJEURE_WAIVER",
      minutesUntilStart,
      originalAmountPaidCents,
      cancellationFeeCents: 0,
      refundAmountCents: originalAmountPaidCents,
      contractorPayoutCents: 0,
      customerCreditCents: 0,
      contractorPenaltyCents: 0,
      canCancelFree: true,
      freeCancellationDeadline,
      explanation:
        "Force Majeure / severe weather hazard active. 100% full refund with zero fees or contractor penalties.",
    };
  }

  // 2. Contractor / Technician fault cancellation
  if (input.cancelledByRole === "CONTRACTOR") {
    return {
      policyApplied: "CONTRACTOR_FAULT_FULL_REFUND_WITH_CREDIT",
      minutesUntilStart,
      originalAmountPaidCents,
      cancellationFeeCents: 0,
      refundAmountCents: originalAmountPaidCents,
      contractorPayoutCents: 0,
      customerCreditCents: CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
      contractorPenaltyCents: CONTRACTOR_NO_SHOW_PENALTY_CENTS,
      canCancelFree: true,
      freeCancellationDeadline,
      explanation:
        "Contractor cancelled appointment. Homeowner receives 100% refund plus $25.00 courtesy credit. Contractor receives strike.",
    };
  }

  // 3. System / Operations auto-cancel (e.g. unfulfilled dispatch timeout)
  if (input.cancelledByRole === "OPERATIONS" || input.cancelledByRole === "SYSTEM") {
    return {
      policyApplied: "DISPATCH_TIMEOUT_AUTO_CANCEL",
      minutesUntilStart,
      originalAmountPaidCents,
      cancellationFeeCents: 0,
      refundAmountCents: originalAmountPaidCents,
      contractorPayoutCents: 0,
      customerCreditCents: 0,
      contractorPenaltyCents: 0,
      canCancelFree: true,
      freeCancellationDeadline,
      explanation:
        "Cancelled by Operations/System due to unfulfilled dispatch. 100% full refund with zero customer charges.",
    };
  }

  // 4. Customer-initiated cancellation
  const isEnRoute =
    input.technicianStatus === "TECHNICIAN_EN_ROUTE" ||
    input.technicianStatus === "EN_ROUTE";

  const isWithinFreeWindow =
    minutesUntilStart >= FREE_CANCELLATION_WINDOW_MINUTES && !isEnRoute;

  if (isWithinFreeWindow) {
    return {
      policyApplied: "FREE_CANCELLATION_WINDOW",
      minutesUntilStart,
      originalAmountPaidCents,
      cancellationFeeCents: 0,
      refundAmountCents: originalAmountPaidCents,
      contractorPayoutCents: 0,
      customerCreditCents: 0,
      contractorPenaltyCents: 0,
      canCancelFree: true,
      freeCancellationDeadline,
      explanation:
        "Cancelled with more than 2 hours notice before scheduled appointment. 100% full refund.",
    };
  }

  // Late customer cancellation (< 2 hours or technician already en route)
  const cancellationFeeCents = Math.min(
    originalAmountPaidCents,
    LATE_CANCELLATION_FEE_CENTS,
  );
  const refundAmountCents = Math.max(0, originalAmountPaidCents - cancellationFeeCents);

  return {
    policyApplied: "LATE_CUSTOMER_CANCELLATION_FEE",
    minutesUntilStart,
    originalAmountPaidCents,
    cancellationFeeCents,
    refundAmountCents,
    contractorPayoutCents: cancellationFeeCents, // Compensate dispatched technician for lost slot/travel
    customerCreditCents: 0,
    contractorPenaltyCents: 0,
    canCancelFree: false,
    freeCancellationDeadline,
    explanation: isEnRoute
      ? "Technician is already en route. Standard $50.00 diagnostic call-out fee applies to compensate technician travel."
      : "Cancelled with less than 2 hours notice. $50.00 late cancellation fee applies; remaining balance refunded.",
  };
}

/**
 * Computes SLA deadline and severity for a newly recorded dispatch exception.
 */
export function evaluateDispatchExceptionSla(input: {
  urgency?: string | null | undefined;
  exceptionType: DispatchExceptionType;
  now?: Date | undefined;
}): {
  slaMinutes: number;
  slaDeadlineAt: Date;
  severity: DispatchExceptionSeverity;
  autoEscalate: boolean;
} {
  const now = input.now ?? new Date();
  const isEmergency =
    input.urgency === "EMERGENCY" ||
    input.exceptionType === "TECHNICIAN_NO_SHOW";

  const slaMinutes = isEmergency
    ? EMERGENCY_DISPATCH_SLA_MINUTES
    : STANDARD_DISPATCH_SLA_MINUTES;

  const slaDeadlineAt = new Date(now.getTime() + slaMinutes * 60 * 1000);

  let severity: DispatchExceptionSeverity = "MEDIUM";
  if (input.exceptionType === "TECHNICIAN_NO_SHOW") {
    severity = "HIGH";
  } else if (input.urgency === "EMERGENCY") {
    severity = "CRITICAL";
  } else if (input.exceptionType === "DISPATCH_OFFER_TIMEOUT") {
    severity = "LOW";
  }

  return {
    slaMinutes,
    slaDeadlineAt,
    severity,
    autoEscalate: isEmergency,
  };
}

/**
 * Validates whether a customer can legally claim technician no-show.
 */
export function evaluateNoShowEligibility(input: {
  scheduledStartsAt?: Date | string | null | undefined;
  technicianArrivedAt?: Date | string | null | undefined;
  now?: Date | undefined;
}): {
  eligible: boolean;
  minutesLate: number;
  reason?: string | undefined;
} {
  const now = input.now ?? new Date();

  if (input.technicianArrivedAt) {
    return {
      eligible: false,
      minutesLate: 0,
      reason: "Technician has already arrived and checked in on-site.",
    };
  }

  if (!input.scheduledStartsAt) {
    return {
      eligible: false,
      minutesLate: 0,
      reason: "No scheduled start time has been established for this job.",
    };
  }

  const startTime = new Date(input.scheduledStartsAt);
  const minutesPastStart = Math.round((now.getTime() - startTime.getTime()) / (60 * 1000));

  if (minutesPastStart < 0) {
    return {
      eligible: false,
      minutesLate: 0,
      reason: "Scheduled service appointment window has not started yet.",
    };
  }

  if (minutesPastStart < NO_SHOW_THRESHOLD_MINUTES) {
    return {
      eligible: false,
      minutesLate: minutesPastStart,
      reason: `Technician is within the ${NO_SHOW_THRESHOLD_MINUTES}-minute grace window for traffic delays. Please wait until ${NO_SHOW_THRESHOLD_MINUTES} minutes past window before reporting.`,
    };
  }

  return {
    eligible: true,
    minutesLate: minutesPastStart,
  };
}
