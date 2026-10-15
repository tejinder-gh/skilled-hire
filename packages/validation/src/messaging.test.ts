import { describe, expect, it } from "vitest";
import {
  sendMessageSchema,
  markMessagesReadSchema,
  createMaskedSessionSchema,
} from "./index.js";

describe("Customer–Technician Messaging Validation Schemas (#15, SH-14)", () => {
  describe("sendMessageSchema", () => {
    it("validates a standard text message with attachments", () => {
      const parsed = sendMessageSchema.parse({
        content: "Please ring the bell upon arrival. Side gate is unlocked.",
        attachmentKeys: ["uploads/job-819/gate-photo.jpg"],
        idempotencyKey: "idem-msg-test-8819",
      });
      expect(parsed.content).toBe("Please ring the bell upon arrival. Side gate is unlocked.");
      expect(parsed.attachmentKeys).toEqual(["uploads/job-819/gate-photo.jpg"]);
      expect(parsed.idempotencyKey).toBe("idem-msg-test-8819");
    });

    it("defaults attachmentKeys to empty array when omitted", () => {
      const parsed = sendMessageSchema.parse({
        content: "On my way, ETA 15 minutes.",
      });
      expect(parsed.attachmentKeys).toEqual([]);
      expect(parsed.idempotencyKey).toBeUndefined();
    });

    it("rejects empty or whitespace-only message content", () => {
      expect(() =>
        sendMessageSchema.parse({
          content: "   ",
        }),
      ).toThrow();
    });

    it("rejects content exceeding 4000 characters limit", () => {
      expect(() =>
        sendMessageSchema.parse({
          content: "a".repeat(4001),
        }),
      ).toThrow();
    });

    it("rejects more than 5 attachments per message", () => {
      expect(() =>
        sendMessageSchema.parse({
          content: "Photos attached",
          attachmentKeys: ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg"],
        }),
      ).toThrow();
    });
  });

  describe("markMessagesReadSchema", () => {
    it("validates empty object for marking all unread messages as read", () => {
      const parsed = markMessagesReadSchema.parse({});
      expect(parsed.messageIds).toBeUndefined();
      expect(parsed.markAllUpTo).toBeUndefined();
    });

    it("validates specific message UUIDs", () => {
      const id1 = "11111111-1111-4111-8111-111111111111";
      const id2 = "22222222-2222-4222-8222-222222222222";
      const parsed = markMessagesReadSchema.parse({
        messageIds: [id1, id2],
      });
      expect(parsed.messageIds).toEqual([id1, id2]);
    });
  });

  describe("createMaskedSessionSchema", () => {
    it("validates optional ISO expiration timestamp", () => {
      const date = new Date(Date.now() + 86400000).toISOString();
      const parsed = createMaskedSessionSchema.parse({ expiresAt: date });
      expect(parsed.expiresAt).toBe(date);
    });
  });
});
