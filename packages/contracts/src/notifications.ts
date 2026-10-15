export type NotificationChannel =
  | "IN_APP"
  | "EMAIL"
  | "SMS"
  | "PUSH"
  | "PHONE";

export type OutboxStatus =
  | "PENDING"
  | "PROCESSING"
  | "DELIVERED"
  | "RETRYING"
  | "DEAD_LETTER"
  | "CANCELLED_PREFERENCE";

export type NotificationPreferenceCategory =
  | "DISPATCH_ALERTS"
  | "TRANSACTIONAL_RECEIPTS"
  | "JOB_MILESTONES"
  | "MARKETING_PROMOTIONS"
  | "SAFETY_EMERGENCY";

export interface TransactionalOutboxItemDTO {
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
  lockedAt?: string | null;
  lockedBy?: string | null;
  deliveredAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryLogDTO {
  id: string;
  outboxId: string;
  channel: NotificationChannel;
  recipient: string;
  providerName: string;
  providerMessageId?: string | null;
  attemptNumber: number;
  durationMs: number;
  status: string;
  responsePayload?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface UserNotificationPreferenceDTO {
  id: string;
  userId: string;
  channel: NotificationChannel;
  category: NotificationPreferenceCategory;
  enabled: boolean;
  optedOutAt?: string | null;
  optInSource: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplateDTO {
  id: string;
  templateSlug: string;
  version: number;
  channel: NotificationChannel;
  subjectTemplate?: string | null;
  bodyTemplate: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueOutboxNotificationRequest {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  idempotencyKey: string;
  recipientUserId: string;
  channel: NotificationChannel;
  destination: string;
  templateSlug: string;
  templateVersion?: number;
  payload: Record<string, unknown>;
}

export interface UpdateNotificationPreferenceRequest {
  channel: NotificationChannel;
  category: NotificationPreferenceCategory;
  enabled: boolean;
}

export interface WorkerPollRequest {
  batchSize?: number;
  workerId?: string;
}

export interface WorkerPollResponse {
  claimedCount: number;
  deliveredCount: number;
  retriedCount: number;
  deadLetterCount: number;
  cancelledCount: number;
  durationMs: number;
  processedIds: string[];
}
