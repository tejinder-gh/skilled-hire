import type { Role } from "./index.js";

export type MessageStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";
export type MessageModerationStatus = "CLEAN" | "FLAGGED" | "BLOCKED";
export type ConversationStatus = "ACTIVE" | "READ_ONLY" | "CLOSED";

export interface MessageDTO {
  id: string;
  conversationId: string;
  jobId: string;
  senderUserId: string;
  senderRole: Role;
  senderDisplayName: string;
  senderAvatarUrl?: string | null;
  content: string;
  attachmentKeys: string[];
  status: MessageStatus;
  moderationStatus: MessageModerationStatus;
  moderationReason?: string | null;
  createdAt: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  readBy?: string | null;
}

export interface SendMessageRequest {
  content: string;
  attachmentKeys?: string[] | undefined;
  idempotencyKey?: string | undefined;
}

export interface MarkMessagesReadRequest {
  messageIds?: string[] | undefined;
  markAllUpTo?: string | undefined;
}

export interface MaskedCommunicationSessionDTO {
  id: string;
  jobId: string;
  virtualProxyNumber: string;
  sessionExtension: string;
  sessionPin: string;
  customerUserId: string;
  technicianUserId: string;
  isActive: boolean;
  expiresAt: string;
  emergencyDirectPhone: string;
  callRecordingConsentNotice: string;
}

export interface JobConversationDTO {
  id: string;
  jobId: string;
  serviceRequestId: string;
  status: ConversationStatus;
  customer: {
    id: string;
    displayName: string;
    maskedPhone: string;
  };
  technician: {
    id: string;
    displayName: string;
    tradeTitle: string;
    maskedPhone: string;
  };
  maskedSession: MaskedCommunicationSessionDTO;
  unreadCount: number;
  messages: MessageDTO[];
  createdAt: string;
  updatedAt: string;
}

export const EMERGENCY_SAFETY_DESK_PHONE = "+1-800-555-SAFE";
export const MASKED_COMMUNICATIONS_CONSENT =
  "Calls and messages through Skilled Hire masked relay are recorded and logged for quality assurance, safety, and dispute resolution in compliance with Ontario privacy and consumer safety regulations.";
