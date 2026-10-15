import { describe, expect, it } from "vitest";
import {
  evaluateCancellationPolicy,
  evaluateDispatchExceptionSla,
  evaluateNoShowEligibility,
  FREE_CANCELLATION_WINDOW_MINUTES,
  LATE_CANCELLATION_FEE_CENTS,
  CONTRACTOR_NO_SHOW_PENALTY_CENTS,
  CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
} from "./dispatch-exceptions.js";

describe("Dispatch Exceptions, Cancellation Policies, and Recovery (#11, SH-10)", () => {
  const baseTime = new Date("2026-10-15T12:00:00Z");

  describe("evaluateCancellationPolicy", () => {
    it("allows free cancellation when notice is >= 2 hours before scheduled slot", () => {
      const scheduledTime = new Date("2026-10-15T15:00:00Z"); // 3 hours (180 mins) in future
      const result = evaluateCancellationPolicy({
        cancelledByRole: "CUSTOMER",
        scheduledStartsAt: scheduledTime,
        amountPaidCents: 12900,
        now: baseTime,
      });

      expect(result.policyApplied).toBe("FREE_CANCELLATION_WINDOW");
      expect(result.canCancelFree).toBe(true);
      expect(result.cancellationFeeCents).toBe(0);
      expect(result.refundAmountCents).toBe(12900);
      expect(result.contractorPayoutCents).toBe(0);
      expect(result.customerCreditCents).toBe(0);
      expect(result.minutesUntilStart).toBe(180);
      expect(result.freeCancellationDeadline).toBe(
        new Date("2026-10-15T13:00:00Z").toISOString(),
      );
    });

    it("applies $50.00 late cancellation fee when cancelled with < 2 hours notice", () => {
      const scheduledTime = new Date("2026-10-15T13:00:00Z"); // 60 mins in future
      const result = evaluateCancellationPolicy({
        cancelledByRole: "CUSTOMER",
        scheduledStartsAt: scheduledTime,
        amountPaidCents: 12900,
        now: baseTime,
      });

      expect(result.policyApplied).toBe("LATE_CUSTOMER_CANCELLATION_FEE");
      expect(result.canCancelFree).toBe(false);
      expect(result.cancellationFeeCents).toBe(LATE_CANCELLATION_FEE_CENTS); // 5000
      expect(result.refundAmountCents).toBe(12900 - 5000); // 7900
      expect(result.contractorPayoutCents).toBe(5000); // Dispatched contractor travel compensation
      expect(result.contractorPenaltyCents).toBe(0);
    });

    it("applies late cancellation fee if technician is already EN_ROUTE even if > 2 hours", () => {
      const scheduledTime = new Date("2026-10-15T16:00:00Z"); // 4 hours in future
      const result = evaluateCancellationPolicy({
        cancelledByRole: "CUSTOMER",
        scheduledStartsAt: scheduledTime,
        technicianStatus: "TECHNICIAN_EN_ROUTE",
        amountPaidCents: 15000,
        now: baseTime,
      });

      expect(result.policyApplied).toBe("LATE_CUSTOMER_CANCELLATION_FEE");
      expect(result.canCancelFree).toBe(false);
      expect(result.cancellationFeeCents).toBe(5000);
      expect(result.contractorPayoutCents).toBe(5000);
    });

    it("caps late cancellation fee to total amount paid if paid amount is less than standard fee", () => {
      const scheduledTime = new Date("2026-10-15T12:30:00Z"); // 30 mins in future
      const result = evaluateCancellationPolicy({
        cancelledByRole: "CUSTOMER",
        scheduledStartsAt: scheduledTime,
        amountPaidCents: 3500, // Less than 5000 cents
        now: baseTime,
      });

      expect(result.cancellationFeeCents).toBe(3500);
      expect(result.refundAmountCents).toBe(0);
      expect(result.contractorPayoutCents).toBe(3500);
    });

    it("awards 100% refund and $25 courtesy credit to customer when contractor cancels", () => {
      const scheduledTime = new Date("2026-10-15T13:00:00Z");
      const result = evaluateCancellationPolicy({
        cancelledByRole: "CONTRACTOR",
        scheduledStartsAt: scheduledTime,
        amountPaidCents: 12900,
        now: baseTime,
      });

      expect(result.policyApplied).toBe("CONTRACTOR_FAULT_FULL_REFUND_WITH_CREDIT");
      expect(result.refundAmountCents).toBe(12900);
      expect(result.cancellationFeeCents).toBe(0);
      expect(result.customerCreditCents).toBe(CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS); // 2500
      expect(result.contractorPenaltyCents).toBe(CONTRACTOR_NO_SHOW_PENALTY_CENTS); // 5000
    });

    it("waives all fees and contractor penalties under force majeure / severe weather conditions", () => {
      const scheduledTime = new Date("2026-10-15T12:15:00Z");
      const result = evaluateCancellationPolicy({
        cancelledByRole: "CUSTOMER",
        scheduledStartsAt: scheduledTime,
        amountPaidCents: 12900,
        forceMajeure: true,
        now: baseTime,
      });

      expect(result.policyApplied).toBe("FORCE_MAJEURE_WAIVER");
      expect(result.refundAmountCents).toBe(12900);
      expect(result.cancellationFeeCents).toBe(0);
      expect(result.contractorPenaltyCents).toBe(0);
      expect(result.canCancelFree).toBe(true);
    });

    it("handles operations / system timeout cancellation with 100% full refund", () => {
      const result = evaluateCancellationPolicy({
        cancelledByRole: "SYSTEM",
        amountPaidCents: 8900,
        now: baseTime,
      });

      expect(result.policyApplied).toBe("DISPATCH_TIMEOUT_AUTO_CANCEL");
      expect(result.refundAmountCents).toBe(8900);
      expect(result.cancellationFeeCents).toBe(0);
    });
  });

  describe("evaluateDispatchExceptionSla", () => {
    it("sets 15-minute SLA with CRITICAL severity for EMERGENCY urgency jobs", () => {
      const sla = evaluateDispatchExceptionSla({
        urgency: "EMERGENCY",
        exceptionType: "FAILED_DISPATCH",
        now: baseTime,
      });

      expect(sla.slaMinutes).toBe(15);
      expect(sla.severity).toBe("CRITICAL");
      expect(sla.autoEscalate).toBe(true);
      expect(sla.slaDeadlineAt.toISOString()).toBe("2026-10-15T12:15:00.000Z");
    });

    it("sets 15-minute SLA with HIGH severity for TECHNICIAN_NO_SHOW exceptions", () => {
      const sla = evaluateDispatchExceptionSla({
        urgency: "STANDARD",
        exceptionType: "TECHNICIAN_NO_SHOW",
        now: baseTime,
      });

      expect(sla.slaMinutes).toBe(15);
      expect(sla.severity).toBe("HIGH");
      expect(sla.autoEscalate).toBe(true);
    });

    it("sets 30-minute SLA with MEDIUM severity for standard exceptions", () => {
      const sla = evaluateDispatchExceptionSla({
        urgency: "STANDARD",
        exceptionType: "TECHNICIAN_DECLINE",
        now: baseTime,
      });

      expect(sla.slaMinutes).toBe(30);
      expect(sla.severity).toBe("MEDIUM");
      expect(sla.autoEscalate).toBe(false);
      expect(sla.slaDeadlineAt.toISOString()).toBe("2026-10-15T12:30:00.000Z");
    });
  });

  describe("evaluateNoShowEligibility", () => {
    it("rejects no-show claim if technician has already arrived", () => {
      const check = evaluateNoShowEligibility({
        scheduledStartsAt: "2026-10-15T11:00:00Z",
        technicianArrivedAt: "2026-10-15T11:10:00Z",
        now: baseTime,
      });

      expect(check.eligible).toBe(false);
      expect(check.reason).toContain("already arrived");
    });

    it("rejects no-show claim if appointment start is still in the future", () => {
      const check = evaluateNoShowEligibility({
        scheduledStartsAt: "2026-10-15T13:00:00Z", // 1 hour in future
        now: baseTime,
      });

      expect(check.eligible).toBe(false);
      expect(check.reason).toContain("has not started yet");
    });

    it("rejects no-show claim if within the 30-minute grace window for traffic delays", () => {
      const check = evaluateNoShowEligibility({
        scheduledStartsAt: "2026-10-15T11:45:00Z", // 15 mins ago
        now: baseTime, // 12:00:00Z
      });

      expect(check.eligible).toBe(false);
      expect(check.minutesLate).toBe(15);
      expect(check.reason).toContain("grace window");
    });

    it("approves no-show claim if more than 30 minutes past start and technician not arrived", () => {
      const check = evaluateNoShowEligibility({
        scheduledStartsAt: "2026-10-15T11:15:00Z", // 45 mins ago
        now: baseTime, // 12:00:00Z
      });

      expect(check.eligible).toBe(true);
      expect(check.minutesLate).toBe(45);
    });
  });
});
