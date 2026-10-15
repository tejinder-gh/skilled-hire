import { describe, expect, it } from "vitest";
import {
  createRecommendationSchema,
  respondRecommendationSchema,
  convertRecommendationSchema,
} from "./index.js";

describe("Technician Service Recommendations Validation", () => {
  describe("createRecommendationSchema", () => {
    it("validates a valid technician recommendation proposal", () => {
      const input = {
        title: "Dual-Run Capacitor Replacement",
        description: "Degraded 45uF capacitor measuring 28uF under diagnostic multimeter check.",
        urgency: "URGENT_REPAIR",
        estimatedCostCents: 18500,
        evidencePhotos: ["https://cdn.skilledhire.ca/evidence/photo1.jpg"],
      };

      const result = createRecommendationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe(input.title);
        expect(result.data.urgency).toBe("URGENT_REPAIR");
        expect(result.data.estimatedCostCents).toBe(18500);
        expect(result.data.evidencePhotos).toHaveLength(1);
      }
    });

    it("rejects proposal with negative estimated cost", () => {
      const input = {
        title: "Drain Line Cleanout",
        description: "Biofilm buildup in condensate drain line causing slow drainage.",
        urgency: "RECOMMENDED_MAINTENANCE",
        estimatedCostCents: -500,
      };

      const result = createRecommendationSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects proposal with title that is too short or description that is too short", () => {
      const shortTitle = {
        title: "Ab",
        description: "Properly detailed description of the on-site discovery.",
        urgency: "RECOMMENDED_MAINTENANCE",
        estimatedCostCents: 5000,
      };
      expect(createRecommendationSchema.safeParse(shortTitle).success).toBe(false);

      const shortDesc = {
        title: "Valid Service Title",
        description: "Too short",
        urgency: "RECOMMENDED_MAINTENANCE",
        estimatedCostCents: 5000,
      };
      expect(createRecommendationSchema.safeParse(shortDesc).success).toBe(false);
    });

    it("supports all urgency tiers and defaults evidencePhotos to empty array", () => {
      const tiers = [
        "IMMEDIATE_SAFETY_HAZARD",
        "URGENT_REPAIR",
        "RECOMMENDED_MAINTENANCE",
        "UPGRADE_OPPORTUNITY",
      ] as const;

      for (const urgency of tiers) {
        const result = createRecommendationSchema.safeParse({
          title: `Service for ${urgency}`,
          description: "Adequately detailed explanation of inspection findings.",
          urgency,
          estimatedCostCents: 12000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.evidencePhotos).toEqual([]);
        }
      }
    });
  });

  describe("respondRecommendationSchema", () => {
    it("validates acceptance with immediate conversion authorized", () => {
      const input = {
        decision: "ACCEPTED",
        convertImmediately: true,
        notes: "Proceed during today's visit",
      };

      const result = respondRecommendationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.decision).toBe("ACCEPTED");
        expect(result.data.convertImmediately).toBe(true);
        expect(result.data.notes).toBe("Proceed during today's visit");
      }
    });

    it("validates decline with structured decline reason and notes", () => {
      const input = {
        decision: "DECLINED",
        declineReason: "TOO_EXPENSIVE",
        notes: "Currently exceeds homeowner repair budget for this month",
      };

      const result = respondRecommendationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.decision).toBe("DECLINED");
        expect(result.data.declineReason).toBe("TOO_EXPENSIVE");
      }
    });

    it("validates defer decision for seasonal reminder", () => {
      const input = {
        decision: "DEFERRED",
        notes: "Remind homeowner in 60 days ahead of summer heatwave",
      };

      const result = respondRecommendationSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.decision).toBe("DEFERRED");
        expect(result.data.convertImmediately).toBe(false);
      }
    });

    it("rejects invalid decision or invalid decline reason", () => {
      expect(
        respondRecommendationSchema.safeParse({
          decision: "INVALID_DECISION",
        }).success,
      ).toBe(false);

      expect(
        respondRecommendationSchema.safeParse({
          decision: "DECLINED",
          declineReason: "NOT_A_VALID_REASON",
        }).success,
      ).toBe(false);
    });
  });

  describe("convertRecommendationSchema", () => {
    it("validates optional preferred start/end scheduling and notes", () => {
      const valid = {
        preferredStartsAt: "2026-10-20T14:00:00.000Z",
        preferredEndsAt: "2026-10-20T16:00:00.000Z",
        notes: "Homeowner requested afternoon arrival window",
      };

      const result = convertRecommendationSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("allows empty object as all conversion parameters are optional", () => {
      const result = convertRecommendationSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
