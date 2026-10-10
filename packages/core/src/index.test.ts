import { describe, expect, it } from "vitest";
import { assertTransition, calculateFee, createPaymentMilestones, quoteTotals, rankCandidates } from "./index.js";
describe("state machine", () => { it("rejects shortcuts", () => expect(() => assertTransition("SUBMITTED", "COMPLETED")).toThrow()); });
describe("quotes", () => it("calculates integer cents", () => expect(quoteTotals([{ type: "LABOUR", title: "Labour", quantity: 4, unitPriceCents: 14000 }], 500, 0, 7345).customerTotalCents).toBe(63845))); 
describe("payments", () => it("allocates rounding remainder to final milestone", () => expect(createPaymentMilestones([{ id: "r", verticalId: "v", minAmountCents: 0, maxAmountCents: null, milestones: [{ trigger: "A", percentageBps: 3333, evidenceRequired: false }, { trigger: "B", percentageBps: 6667, evidenceRequired: false }] }], "v", 100).map((x) => x.amountCents)).toEqual([33,67])));
describe("matching", () => it("excludes invalid credentials", () => expect(rankCandidates([{ technicianId: "t", contractorId: "c", distanceKm: 1, ratingBps: 490, completionRateBps: 9900, responseMinutes: 10, workload: 0, available: true, emergencyAvailable: true, credentials: [{ code: "LICENSE", status: "EXPIRED" }] }], ["LICENSE"], false)).toHaveLength(0)));
describe("fees", () => it("calculates basis-point fees with no float money", () => expect(calculateFee(12_345, 850)).toBe(1_049)));
