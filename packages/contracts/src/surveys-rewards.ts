// packages/contracts/src/surveys-rewards.ts

export type PostJobSurveyStatus = "PENDING" | "COMPLETED" | "OPTED_OUT" | "EXPIRED";

export type SurveyDeliveryChannel = "EMAIL" | "SMS" | "IN_APP";

export type CustomerRewardCreditStatus =
  | "ACTIVE"
  | "REDEEMED"
  | "EXPIRED"
  | "VOIDED_FRAUD";

export interface CustomerFeedbackPreferences {
  id: string;
  customerId: string;
  feedbackOptIn: boolean;
  smsOptIn: boolean;
  emailOptIn: boolean;
  updatedAt: string;
}

export interface PostJobSurvey {
  id: string;
  jobId: string;
  customerId: string;
  contractorId: string;
  surveyToken: string;
  status: PostJobSurveyStatus;
  channel: SurveyDeliveryChannel;
  overallRating?: number | null | undefined;
  qualityRating?: number | null | undefined;
  professionalismRating?: number | null | undefined;
  timelinessRating?: number | null | undefined;
  communicationRating?: number | null | undefined;
  npsScore?: number | null | undefined;
  feedbackComment?: string | null | undefined;
  reviewId?: string | null | undefined;
  routedToSupport: boolean;
  supportTicketId?: string | null | undefined;
  sentAt: string;
  completedAt?: string | null | undefined;
  expiresAt: string;
  createdAt: string;
}

export interface CustomerRewardCredit {
  id: string;
  customerId: string;
  originJobId: string;
  surveyId: string;
  rewardType: string;
  amountCents: number;
  balanceCents: number;
  capCents: number;
  percentageBps: number;
  status: CustomerRewardCreditStatus;
  expiresAt: string;
  redeemedAt?: string | null | undefined;
  redeemedJobId?: string | null | undefined;
  createdAt: string;
}

export interface SurveyConversionAnalytics {
  totalSent: number;
  totalCompleted: number;
  totalOptedOut: number;
  totalExpired: number;
  conversionRatePercentage: number;
  averageOverallRating: number;
  negativeReviewsRoutedToSupport: number;
  totalCreditsIssuedCents: number;
  totalCreditsRedeemedCents: number;
}
