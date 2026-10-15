import type {
  NotificationChannel,
  NotificationPreferenceCategory,
  OutboxStatus,
  TransactionalOutboxItemDTO,
  NotificationDeliveryLogDTO,
  UserNotificationPreferenceDTO,
  NotificationTemplateDTO,
} from "@marketplace/contracts";

export type {
  NotificationChannel,
  NotificationPreferenceCategory,
  OutboxStatus,
  TransactionalOutboxItemDTO,
  NotificationDeliveryLogDTO,
  UserNotificationPreferenceDTO,
  NotificationTemplateDTO,
};

// 1. Canonical Notification Templates
export interface CanonicalTemplateDefinition {
  slug: string;
  version: number;
  channel: NotificationChannel;
  subjectTemplate?: string;
  bodyTemplate: string;
  description: string;
}

export const CANONICAL_TEMPLATES: Record<string, CanonicalTemplateDefinition> = {
  "ontario_hvac_emergency_dispatch_v1:SMS": {
    slug: "ontario_hvac_emergency_dispatch_v1",
    version: 1,
    channel: "SMS",
    bodyTemplate:
      "[Skilled Hire URGENT] Emergency HVAC dispatch request #{{serviceRequestId}} in {{neighbourhood}}. Priority: {{urgency}}. Open app to accept.",
    description: "Urgent SMS dispatch notification for certified HVAC technicians",
  },
  "ontario_hvac_emergency_dispatch_v1:PUSH": {
    slug: "ontario_hvac_emergency_dispatch_v1",
    version: 1,
    channel: "PUSH",
    subjectTemplate: "Emergency HVAC Request Nearby",
    bodyTemplate:
      "New {{urgency}} job #{{serviceRequestId}} in {{neighbourhood}}. Tap to review work scope.",
    description: "Push notification alert for emergency HVAC dispatch",
  },
  "ontario_hvac_technician_assigned_v1:EMAIL": {
    slug: "ontario_hvac_technician_assigned_v1",
    version: 1,
    channel: "EMAIL",
    subjectTemplate: "Your Certified HVAC Technician Has Been Assigned - Job #{{serviceRequestId}}",
    bodyTemplate:
      "Hello {{customerName}}, your service request #{{serviceRequestId}} has been assigned to certified technician {{technicianName}} with {{contractorName}}. Scheduled time: {{scheduledTime}}.",
    description: "Transactional confirmation email to customer upon technician assignment",
  },
  "ontario_hvac_quote_ready_v1:EMAIL": {
    slug: "ontario_hvac_quote_ready_v1",
    version: 1,
    channel: "EMAIL",
    subjectTemplate: "Detailed Quote Ready for Review - {{serviceName}}",
    bodyTemplate:
      "Hello {{customerName}}, your quote for {{serviceName}} is ready for review. Total: ${{totalDollars}} CAD (including HST). Review & approve online.",
    description: "Quote ready notice to customer with truth-in-pricing details",
  },
  "ontario_hvac_payment_confirmed_v1:EMAIL": {
    slug: "ontario_hvac_payment_confirmed_v1",
    version: 1,
    channel: "EMAIL",
    subjectTemplate: "Payment Confirmed - Milestone '{{milestoneName}}' (${{amountDollars}} CAD)",
    bodyTemplate:
      "Hello {{customerName}}, thank you! Your payment of ${{amountDollars}} CAD for milestone '{{milestoneName}}' on job #{{jobId}} has been successfully processed. Stripe Reference: {{stripeReference}}.",
    description: "Statutory payment receipt email to customer",
  },
  "ontario_hvac_payout_hold_placed_v1:EMAIL": {
    slug: "ontario_hvac_payout_hold_placed_v1",
    version: 1,
    channel: "EMAIL",
    subjectTemplate: "Payout Hold Notice - Compliance Verification Required (Milestone '{{milestoneName}}')",
    bodyTemplate:
      "Hello {{contractorName}}, a payout hold of ${{amountDollars}} CAD has been placed for milestone '{{milestoneName}}'. Reason: {{holdReason}}. Please upload mandatory evidence: {{requiredEvidenceType}} to release funds.",
    description: "Notification to contractor when payout is gated pending regulatory certificates",
  },
  "ontario_hvac_payout_hold_released_v1:EMAIL": {
    slug: "ontario_hvac_payout_hold_released_v1",
    version: 1,
    channel: "EMAIL",
    subjectTemplate: "Compliance Verified - Funds Released (${{amountDollars}} CAD)",
    bodyTemplate:
      "Hello {{contractorName}}, your compliance evidence for milestone '{{milestoneName}}' has been verified! ${{amountDollars}} CAD is now unlocked and available for disbursal.",
    description: "Notification to contractor upon ESA / evidence approval",
  },
  "ontario_hvac_warranty_claim_triaged_v1:EMAIL": {
    slug: "ontario_hvac_warranty_claim_triaged_v1",
    version: 1,
    channel: "EMAIL",
    subjectTemplate: "Warranty Claim Triaged - Claim #{{claimId}}",
    bodyTemplate:
      "Hello {{customerName}}, your workmanship warranty claim for job #{{jobId}} has been triaged. Current status: {{claimStatus}}. Priority: {{priority}}.",
    description: "Warranty status update notification",
  },
};

// 2. Template Renderer
export function renderTemplate(
  templateString: string,
  variables: Record<string, unknown>,
): string {
  return templateString.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const val = variables[key];
    if (val === undefined || val === null) {
      return "";
    }
    return String(val);
  });
}

// 3. User Preference Evaluator
// Statutory receipts and safety/emergency notifications are mandatory and cannot be opted out under Ontario regulations.
export function evaluateNotificationPreference(
  category: NotificationPreferenceCategory,
  isOptedIn: boolean,
): { allowed: boolean; reason: string } {
  if (category === "SAFETY_EMERGENCY") {
    return {
      allowed: true,
      reason: "MANDATORY_SAFETY_COMMUNICATION_CANNOT_BE_OPTED_OUT",
    };
  }
  if (category === "TRANSACTIONAL_RECEIPTS") {
    return {
      allowed: true,
      reason: "MANDATORY_TRANSACTIONAL_RECEIPT_CANNOT_BE_OPTED_OUT",
    };
  }
  if (!isOptedIn) {
    return {
      allowed: false,
      reason: "USER_OPTED_OUT_OF_CATEGORY",
    };
  }
  return {
    allowed: true,
    reason: "USER_OPTED_IN",
  };
}

// 4. Exponential Backoff Calculator with Jitter
export function computeExponentialBackoff(
  attempt: number,
  options?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    fixedJitterValue?: number; // Optional deterministic value [0, 1] for unit testing
  },
): number {
  const base = options?.baseDelayMs ?? 1000;
  const max = options?.maxDelayMs ?? 3600000; // 1 hour
  const jitterRatio = options?.jitterRatio ?? 0.2;
  const jitter = options?.fixedJitterValue ?? Math.random();

  const exponential = Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)));
  // Jitter factor between (1 - jitterRatio/2) and (1 + jitterRatio/2)
  const jitterFactor = 1 + (jitter - 0.5) * jitterRatio;
  return Math.round(Math.min(max, exponential * jitterFactor));
}

// 5. Deterministic Idempotency Key Generator
export function generateOutboxIdempotencyKey(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  channel: string,
  recipientUserId: string,
): string {
  return `${aggregateType.toUpperCase()}:${aggregateId}:${eventType.toUpperCase()}:${channel.toUpperCase()}:${recipientUserId}`;
}

// 6. Messaging Provider Adapters & Sandbox
export interface SendMessageInput {
  channel: NotificationChannel;
  destination: string;
  subject?: string | undefined;
  body: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface SendMessageResult {
  success: boolean;
  providerName: string;
  providerMessageId?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  durationMs: number;
  responsePayload?: Record<string, unknown> | undefined;
}

export interface MessagingProviderAdapter {
  name: string;
  supportedChannels: readonly NotificationChannel[];
  send(input: SendMessageInput): Promise<SendMessageResult>;
}

export class SandboxMessagingProvider implements MessagingProviderAdapter {
  public readonly name = "SANDBOX_MOCK_PROVIDER";
  public readonly supportedChannels: readonly NotificationChannel[] = [
    "IN_APP",
    "EMAIL",
    "SMS",
    "PUSH",
    "PHONE",
  ];

  private sentMessages: SendMessageInput[] = [];
  private failureRules: Map<string, { errorCode: string; errorMessage: string }> = new Map();
  private transientFailuresRemaining = 0;
  private transientFailureError = {
    errorCode: "PROVIDER_RATE_LIMIT",
    errorMessage: "Simulated upstream rate limit exceeded. Retry requested.",
  };

  public async send(input: SendMessageInput): Promise<SendMessageResult> {
    const startTime = Date.now();

    // Check transient failure injection
    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining--;
      return {
        success: false,
        providerName: this.name,
        errorCode: this.transientFailureError.errorCode,
        errorMessage: this.transientFailureError.errorMessage,
        durationMs: Date.now() - startTime,
        responsePayload: { status: "TRANSIENT_FAILURE_INJECTED" },
      };
    }

    // Check destination-based failure rule
    const destinationRule = this.failureRules.get(input.destination);
    if (destinationRule) {
      return {
        success: false,
        providerName: this.name,
        errorCode: destinationRule.errorCode,
        errorMessage: destinationRule.errorMessage,
        durationMs: Date.now() - startTime,
        responsePayload: { status: "DESTINATION_FAILURE_INJECTED" },
      };
    }

    // Successful mock delivery
    this.sentMessages.push(input);
    const mockMessageId = `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      success: true,
      providerName: this.name,
      providerMessageId: mockMessageId,
      durationMs: Date.now() - startTime,
      responsePayload: {
        channel: input.channel,
        destination: input.destination,
        acceptedAt: new Date().toISOString(),
      },
    };
  }

  public simulateTransientErrors(count: number, errorCode = "PROVIDER_RATE_LIMIT", errorMessage = "Simulated rate limit"): void {
    this.transientFailuresRemaining = count;
    this.transientFailureError = { errorCode, errorMessage };
  }

  public simulateDestinationFailure(destination: string, errorCode: string, errorMessage: string): void {
    this.failureRules.set(destination, { errorCode, errorMessage });
  }

  public clearRules(): void {
    this.failureRules.clear();
    this.transientFailuresRemaining = 0;
  }

  public getSentMessages(): readonly SendMessageInput[] {
    return this.sentMessages;
  }

  public clearSentMessages(): void {
    this.sentMessages = [];
  }
}

// 7. Outbox Item Evaluation Logic (Pure Domain State Transition)
export interface OutboxEvaluationInput {
  item: {
    id: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    idempotencyKey: string;
    recipientUserId: string;
    channel: NotificationChannel;
    destination: string;
    templateSlug: string;
    templateVersion: number;
    payload: Record<string, unknown>;
    status: OutboxStatus;
    attempts: number;
    maxAttempts: number;
    nextAttemptAt: string;
  };
  userPreference?: {
    category: NotificationPreferenceCategory;
    enabled: boolean;
  } | undefined;
  customTemplate?: {
    subjectTemplate?: string | null | undefined;
    bodyTemplate: string;
  } | undefined;
  now?: Date | undefined;
}

export interface OutboxEvaluationOutput {
  newStatus: OutboxStatus;
  newAttempts: number;
  nextAttemptAt: string;
  deliveredAt?: string | undefined;
  lastError?: string | undefined;
  deliveryLog?: {
    channel: NotificationChannel;
    recipient: string;
    providerName: string;
    providerMessageId?: string | undefined;
    attemptNumber: number;
    durationMs: number;
    status: "SUCCESS" | "TRANSIENT_ERROR" | "FATAL_ERROR" | "SUPPRESSED";
    responsePayload?: Record<string, unknown> | undefined;
    errorCode?: string | undefined;
    errorMessage?: string | undefined;
  } | undefined;
}

export async function evaluateAndDispatchOutboxItem(
  input: OutboxEvaluationInput,
  provider: MessagingProviderAdapter,
): Promise<OutboxEvaluationOutput> {
  const now = input.now ?? new Date();
  const item = input.item;

  // 1. Check user notification preference
  if (input.userPreference) {
    const prefCheck = evaluateNotificationPreference(
      input.userPreference.category,
      input.userPreference.enabled,
    );
    if (!prefCheck.allowed) {
      return {
        newStatus: "CANCELLED_PREFERENCE",
        newAttempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt,
        lastError: prefCheck.reason,
        deliveryLog: {
          channel: item.channel,
          recipient: item.destination,
          providerName: provider.name,
          attemptNumber: item.attempts,
          durationMs: 0,
          status: "SUPPRESSED",
          errorCode: "PREFERENCE_SUPPRESSED",
          errorMessage: `Notification suppressed by user preference for category ${input.userPreference.category}`,
        },
      };
    }
  }

  // 2. Resolve template
  const canonicalKey = `${item.templateSlug}:${item.channel}`;
  const canonicalDef = CANONICAL_TEMPLATES[canonicalKey];

  const bodyTemplate =
    input.customTemplate?.bodyTemplate ||
    canonicalDef?.bodyTemplate ||
    `[Skilled Hire Notification] Event: {{eventType}} on {{aggregateType}} #{{aggregateId}}.`;

  const subjectTemplate =
    input.customTemplate?.subjectTemplate ||
    canonicalDef?.subjectTemplate ||
    `Skilled Hire: Update on your service`;

  // Merge aggregate info into payload for interpolation
  const mergedVars: Record<string, unknown> = {
    ...item.payload,
    aggregateType: item.aggregateType,
    aggregateId: item.aggregateId,
    eventType: item.eventType,
  };

  const renderedBody = renderTemplate(bodyTemplate, mergedVars);
  const renderedSubject = renderTemplate(subjectTemplate, mergedVars);

  // 3. Dispatch to Provider
  const attemptNumber = item.attempts + 1;
  const sendResult = await provider.send({
    channel: item.channel,
    destination: item.destination,
    subject: renderedSubject,
    body: renderedBody,
    idempotencyKey: `${item.idempotencyKey}:attempt-${attemptNumber}`,
    metadata: {
      outboxId: item.id,
      aggregateType: item.aggregateType,
      aggregateId: item.aggregateId,
      eventType: item.eventType,
    },
  });

  // 4. Handle Result
  if (sendResult.success) {
    return {
      newStatus: "DELIVERED",
      newAttempts: attemptNumber,
      nextAttemptAt: item.nextAttemptAt,
      deliveredAt: now.toISOString(),
      deliveryLog: {
        channel: item.channel,
        recipient: item.destination,
        providerName: sendResult.providerName,
        providerMessageId: sendResult.providerMessageId,
        attemptNumber,
        durationMs: sendResult.durationMs,
        status: "SUCCESS",
        responsePayload: sendResult.responsePayload,
      },
    };
  }

  // Delivery failed - check if max attempts reached
  const isDeadLetter = attemptNumber >= item.maxAttempts;
  const backoffMs = computeExponentialBackoff(attemptNumber);
  const nextAttempt = new Date(now.getTime() + backoffMs).toISOString();

  return {
    newStatus: isDeadLetter ? "DEAD_LETTER" : "RETRYING",
    newAttempts: attemptNumber,
    nextAttemptAt: nextAttempt,
    lastError: `${sendResult.errorCode ?? "ERROR"}: ${sendResult.errorMessage ?? "Unknown error"}`,
    deliveryLog: {
      channel: item.channel,
      recipient: item.destination,
      providerName: sendResult.providerName,
      attemptNumber,
      durationMs: sendResult.durationMs,
      status: isDeadLetter ? "FATAL_ERROR" : "TRANSIENT_ERROR",
      errorCode: sendResult.errorCode,
      errorMessage: sendResult.errorMessage,
      responsePayload: sendResult.responsePayload,
    },
  };
}
