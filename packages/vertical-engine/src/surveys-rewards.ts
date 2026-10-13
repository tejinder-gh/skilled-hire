// packages/vertical-engine/src/surveys-rewards.ts

import type { SurveyConversionAnalytics } from "@marketplace/contracts";

export interface CalculateCreditOptions {
  percentageBps?: number | undefined;
  capCents?: number | undefined;
  minCents?: number | undefined;
}

export interface CreditCalculationResult {
  creditAmountCents: number;
  percentageBps: number;
  capCents: number;
}

/**
 * Generates human-readable, unique survey invitation token.
 * Example: SRV-2026-9E8D7C6B
 */
export function generateSurveyToken(year?: number): string {
  const y = year ?? new Date().getUTCFullYear();
  const rand = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  return `SRV-${y}-${rand}`;
}

/**
 * Calculates 10% next-service booking credit with configurable cap and minimum reward.
 * Proposed: 10% next-service credit with $30 (3000 cents) cap.
 */
export function calculateNextServiceCredit(
  jobTotalCents: number,
  options?: CalculateCreditOptions,
): CreditCalculationResult {
  const percentageBps = options?.percentageBps ?? 1000; // 10.00%
  const capCents = options?.capCents ?? 3000; // $30.00
  const minCents = options?.minCents ?? 500; // $5.00 minimum guarantee

  if (jobTotalCents <= 0) {
    return {
      creditAmountCents: minCents,
      percentageBps,
      capCents,
    };
  }

  const rawAmount = Math.round((jobTotalCents * percentageBps) / 10000);
  const creditAmountCents = Math.min(capCents, Math.max(minCents, rawAmount));

  return {
    creditAmountCents,
    percentageBps,
    capCents,
  };
}

export interface NegativeReviewCheckInput {
  overallRating: number;
  npsScore?: number | null | undefined;
  feedbackComment?: string | null | undefined;
}

export interface NegativeReviewCheckResult {
  isNegative: boolean;
  reason?: string | undefined;
}

const NEGATIVE_TRIGGER_KEYWORDS = [
  "unacceptable",
  "terrible",
  "horrible",
  "damaged",
  "scam",
  "broken",
  "danger",
  "hazard",
  "threatened",
  "rude",
  "awful",
  "refund",
  "disaster",
];

/**
 * Detects negative customer sentiment and dissatisfaction to route immediately to operations/support.
 */
export function isNegativeReviewDissatisfied(
  input: NegativeReviewCheckInput,
): NegativeReviewCheckResult {
  if (input.overallRating <= 2) {
    return {
      isNegative: true,
      reason: `Overall rating ${input.overallRating} stars is <= 2 stars`,
    };
  }

  if (input.npsScore !== undefined && input.npsScore !== null && input.npsScore <= 6) {
    return {
      isNegative: true,
      reason: `NPS score of ${input.npsScore} indicates a brand detractor (<= 6)`,
    };
  }

  if (input.feedbackComment) {
    const text = input.feedbackComment.toLowerCase();
    const matched = NEGATIVE_TRIGGER_KEYWORDS.find((keyword) => text.includes(keyword));
    if (matched) {
      return {
        isNegative: true,
        reason: `Feedback comment contains critical escalation keyword: "${matched}"`,
      };
    }
  }

  return { isNegative: false };
}

/**
 * Validates FTC / Competition Bureau compliance against deceptive review manipulation or review gating.
 * The 10% credit reward must be awarded unconditionally upon survey completion, regardless of positive or negative rating.
 */
export function validateFairReviewCompliance(input: {
  overallRating: number;
  rewardEarned: boolean;
}): { compliant: boolean; error?: string | undefined } {
  if (!input.rewardEarned) {
    return {
      compliant: false,
      error:
        "Non-compliant review gating: Reward credit cannot be denied or conditioned on rating sentiment.",
    };
  }
  return { compliant: true };
}

export interface SurveySummaryItem {
  status: string;
  overallRating: number | null;
  routedToSupport: boolean;
}

export interface CreditSummaryItem {
  amountCents: number;
  balanceCents: number;
  status: string;
}

/**
 * Computes survey conversion and reward analytics.
 */
export function computeSurveyConversionAnalytics(
  surveys: SurveySummaryItem[],
  credits: CreditSummaryItem[],
): SurveyConversionAnalytics {
  const totalSent = surveys.length;
  const completed = surveys.filter((s) => s.status === "COMPLETED");
  const totalCompleted = completed.length;
  const totalOptedOut = surveys.filter((s) => s.status === "OPTED_OUT").length;
  const totalExpired = surveys.filter((s) => s.status === "EXPIRED").length;

  const conversionRatePercentage =
    totalSent > 0 ? Math.round((totalCompleted / totalSent) * 10000) / 100 : 0;

  const ratedSurveys = completed.filter((s) => s.overallRating !== null);
  const ratingSum = ratedSurveys.reduce((sum, s) => sum + (s.overallRating ?? 0), 0);
  const averageOverallRating =
    ratedSurveys.length > 0 ? Math.round((ratingSum / ratedSurveys.length) * 100) / 100 : 0;

  const negativeReviewsRoutedToSupport = completed.filter((s) => s.routedToSupport).length;

  const totalCreditsIssuedCents = credits.reduce((sum, c) => sum + c.amountCents, 0);
  const totalCreditsRedeemedCents = credits.reduce(
    (sum, c) => sum + (c.amountCents - c.balanceCents),
    0,
  );

  return {
    totalSent,
    totalCompleted,
    totalOptedOut,
    totalExpired,
    conversionRatePercentage,
    averageOverallRating,
    negativeReviewsRoutedToSupport,
    totalCreditsIssuedCents,
    totalCreditsRedeemedCents,
  };
}
