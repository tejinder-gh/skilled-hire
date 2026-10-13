// packages/vertical-engine/src/surveys-rewards.test.ts

import { describe, expect, it } from "vitest";
import {
  calculateNextServiceCredit,
  computeSurveyConversionAnalytics,
  generateSurveyToken,
  isNegativeReviewDissatisfied,
  validateFairReviewCompliance,
} from "./surveys-rewards.js";

describe("Surveys and Rewards Engine", () => {
  it("generates structured, unique survey tokens", () => {
    const token = generateSurveyToken(2026);
    expect(token).toMatch(/^SRV-2026-[0-9A-F]{8}$/);
  });

  it("calculates 10% next-service credit with cap and minimum guarantee", () => {
    // 1. $150.00 job -> 10% is $15.00 (1500 cents)
    const resA = calculateNextServiceCredit(15000);
    expect(resA.creditAmountCents).toBe(1500);
    expect(resA.capCents).toBe(3000);
    expect(resA.percentageBps).toBe(1000);

    // 2. $500.00 job -> 10% is $50.00, capped at $30.00 (3000 cents)
    const resB = calculateNextServiceCredit(50000);
    expect(resB.creditAmountCents).toBe(3000);

    // 3. $20.00 job -> 10% is $2.00, bounded by minimum $5.00 guarantee (500 cents)
    const resC = calculateNextServiceCredit(2000);
    expect(resC.creditAmountCents).toBe(500);

    // 4. $0 or boundary job -> minimum $5.00 guarantee
    const resD = calculateNextServiceCredit(0);
    expect(resD.creditAmountCents).toBe(500);
  });

  it("detects customer dissatisfaction for automated support triage", () => {
    // 1-star rating
    const check1 = isNegativeReviewDissatisfied({ overallRating: 1 });
    expect(check1.isNegative).toBe(true);
    expect(check1.reason).toContain("<= 2 stars");

    // 2-star rating
    const check2 = isNegativeReviewDissatisfied({ overallRating: 2 });
    expect(check2.isNegative).toBe(true);

    // 4-star rating with detractor NPS score (4)
    const check3 = isNegativeReviewDissatisfied({ overallRating: 4, npsScore: 4 });
    expect(check3.isNegative).toBe(true);
    expect(check3.reason).toContain("NPS score");

    // 5-star rating with escalation keyword
    const check4 = isNegativeReviewDissatisfied({
      overallRating: 5,
      feedbackComment: "The technician damaged my baseboard while carrying the ladder.",
    });
    expect(check4.isNegative).toBe(true);
    expect(check4.reason).toContain("damaged");

    // Genuine positive review
    const check5 = isNegativeReviewDissatisfied({
      overallRating: 5,
      npsScore: 10,
      feedbackComment: "Excellent and timely workmanship. Very pleased!",
    });
    expect(check5.isNegative).toBe(false);
  });

  it("enforces fair reviews compliance without sentiment gating", () => {
    // Both 1-star and 5-star reviews MUST earn the reward
    const compliantPass = validateFairReviewCompliance({
      overallRating: 1,
      rewardEarned: true,
    });
    expect(compliantPass.compliant).toBe(true);

    const nonCompliantFail = validateFairReviewCompliance({
      overallRating: 1,
      rewardEarned: false,
    });
    expect(nonCompliantFail.compliant).toBe(false);
    expect(nonCompliantFail.error).toContain("review gating");
  });

  it("computes conversion and reward analytics accurately", () => {
    const surveys = [
      { status: "COMPLETED", overallRating: 5, routedToSupport: false },
      { status: "COMPLETED", overallRating: 1, routedToSupport: true },
      { status: "COMPLETED", overallRating: 4, routedToSupport: false },
      { status: "PENDING", overallRating: null, routedToSupport: false },
      { status: "OPTED_OUT", overallRating: null, routedToSupport: false },
    ];

    const credits = [
      { amountCents: 1500, balanceCents: 0, status: "REDEEMED" },
      { amountCents: 3000, balanceCents: 1500, status: "ACTIVE" },
      { amountCents: 500, balanceCents: 500, status: "ACTIVE" },
    ];

    const analytics = computeSurveyConversionAnalytics(surveys, credits);
    expect(analytics.totalSent).toBe(5);
    expect(analytics.totalCompleted).toBe(3);
    expect(analytics.totalOptedOut).toBe(1);
    expect(analytics.conversionRatePercentage).toBe(60);
    // (5 + 1 + 4) / 3 = 3.33
    expect(analytics.averageOverallRating).toBe(3.33);
    expect(analytics.negativeReviewsRoutedToSupport).toBe(1);
    expect(analytics.totalCreditsIssuedCents).toBe(5000);
    expect(analytics.totalCreditsRedeemedCents).toBe(3000);
  });
});
