export const recommendationUrgencies = [
  "IMMEDIATE_SAFETY_HAZARD",
  "URGENT_REPAIR",
  "RECOMMENDED_MAINTENANCE",
  "UPGRADE_OPPORTUNITY",
] as const;
export type RecommendationUrgency = (typeof recommendationUrgencies)[number];

export const recommendationStatuses = [
  "PROPOSED",
  "ACCEPTED",
  "DECLINED",
  "DEFERRED",
  "CONVERTED",
  "CANCELLED",
] as const;
export type RecommendationStatus = (typeof recommendationStatuses)[number];

export const recommendationDeclineReasons = [
  "TOO_EXPENSIVE",
  "WILL_DO_LATER",
  "DIY_OR_OWN_CONTRACTOR",
  "NOT_NEEDED",
  "SELLING_HOME",
  "OTHER",
] as const;
export type RecommendationDeclineReason =
  (typeof recommendationDeclineReasons)[number];

export const recommendationResponseActions = [
  "PROPOSED",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "DEFERRED",
  "CONVERTED",
  "CANCELLED",
] as const;
export type RecommendationResponseAction =
  (typeof recommendationResponseActions)[number];

export interface RecommendationResponseEventDTO {
  id: string;
  recommendationId: string;
  action: RecommendationResponseAction;
  actorId: string;
  actorRole: string;
  notes?: string | null | undefined;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ServiceRecommendationDTO {
  id: string;
  jobId: string;
  serviceRequestId: string;
  propertyId: string;
  customerId: string;
  contractorId: string;
  technicianId: string;
  title: string;
  description: string;
  verticalId?: string | null | undefined;
  categoryId?: string | null | undefined;
  urgency: RecommendationUrgency;
  status: RecommendationStatus;
  estimatedCostCents: number;
  currency: string;
  evidencePhotos: string[];
  homeownerResponseNotes?: string | null | undefined;
  declineReason?: RecommendationDeclineReason | null | undefined;
  respondedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
  convertedServiceRequestId?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
  technicianName?: string | undefined;
  contractorName?: string | undefined;
  propertyAddress?: string | undefined;
  responses?: RecommendationResponseEventDTO[] | undefined;
}

export interface CreateRecommendationInput {
  title: string;
  description: string;
  verticalId?: string | undefined;
  categoryId?: string | undefined;
  urgency: RecommendationUrgency;
  estimatedCostCents: number;
  evidencePhotos?: string[] | undefined;
  expiresAt?: string | undefined;
}

export interface RespondRecommendationInput {
  decision: "ACCEPTED" | "DECLINED" | "DEFERRED";
  declineReason?: RecommendationDeclineReason | undefined;
  notes?: string | undefined;
  convertImmediately?: boolean | undefined;
  preferredStartsAt?: string | undefined;
  preferredEndsAt?: string | undefined;
}

export interface ConvertRecommendationInput {
  preferredStartsAt?: string | undefined;
  preferredEndsAt?: string | undefined;
  notes?: string | undefined;
}

export interface RecommendationAnalyticsDTO {
  contractorId: string;
  totalProposed: number;
  totalAccepted: number;
  totalDeclined: number;
  totalDeferred: number;
  totalConverted: number;
  conversionRatePct: number;
  totalProposedRevenueCents: number;
  totalAcceptedRevenueCents: number;
}
