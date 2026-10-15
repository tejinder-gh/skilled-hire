import { describe, expect, it } from "vitest";
import { assertTransition, calculateFee, createPaymentMilestones, itemizedQuoteTotals, quoteTotals, rankCandidates } from "./index.js";
describe("state machine", () => { it("rejects shortcuts", () => expect(() => assertTransition("SUBMITTED", "COMPLETED")).toThrow()); });
describe("quotes", () => {
  it("calculates integer cents", () => expect(quoteTotals([{ type: "LABOUR", title: "Labour", quantity: 4, unitPriceCents: 14000 }], 500, 0, 7345).customerTotalCents).toBe(63845));

  it("calculates itemized quote with diagnostic fee, labour, customer-supplied materials, disposal, and permits", () => {
    const result = itemizedQuoteTotals(
      [
        { type: "DIAGNOSTIC", title: "Truck roll & triage", quantity: 1, unitPriceCents: 8900 },
        { type: "LABOUR", title: "Thermostat and dual-run capacitor replacement", quantity: 2, unitPriceCents: 12000 },
        {
          type: "MATERIAL",
          title: "Honeywell T6 Pro Thermostat (Customer-Supplied)",
          quantity: 1,
          unitPriceCents: 18000,
          isCustomerSupplied: true,
          warrantyCaveat: "Labour only - customer assumes part risk",
        },
        {
          type: "MATERIAL",
          title: "OEM 45+5 uF Dual Run Capacitor",
          quantity: 1,
          unitPriceCents: 4500,
          isCustomerSupplied: false,
        },
        { type: "DISPOSAL", title: "Eco refrigerant and capacitor recycling", quantity: 1, unitPriceCents: 2500 },
        { type: "PERMIT", title: "TSSA fuel safety inspection notification", quantity: 1, unitPriceCents: 3500 },
      ],
      1500, // platform fee
      1000, // discount
      5577, // tax (13% HST)
      0,
    );

    expect(result.diagnosticFeeCents).toBe(8900);
    expect(result.laborSubtotalCents).toBe(24000);
    // Customer supplied item priced at 0, only OEM capacitor at 4500
    expect(result.materialsSubtotalCents).toBe(4500);
    expect(result.customerSuppliedCount).toBe(1);
    expect(result.disposalSubtotalCents).toBe(2500);
    expect(result.permitsSubtotalCents).toBe(3500);
    // Contractor subtotal: 8900 + 24000 + 4500 + 2500 + 3500 = 43400
    expect(result.contractorSubtotalCents).toBe(43400);
    // Customer total: 43400 + 1500 (platform) + 5577 (tax) - 1000 (discount) = 49477
    expect(result.customerTotalCents).toBe(49477);
    expect(result.itemSubtotals[2]).toBe(0); // customer-supplied item subtotal is 0
  });

  it("throws on negative total", () => {
    expect(() =>
      itemizedQuoteTotals(
        [{ type: "LABOUR", title: "Diagnostic", quantity: 1, unitPriceCents: 1000 }],
        0,
        5000, // discount exceeds subtotal
        0,
      ),
    ).toThrow("Quote total cannot be negative");
  });
}); 
describe("payments", () => it("allocates rounding remainder to final milestone", () => expect(createPaymentMilestones([{ id: "r", verticalId: "v", minAmountCents: 0, maxAmountCents: null, milestones: [{ trigger: "A", percentageBps: 3333, evidenceRequired: false }, { trigger: "B", percentageBps: 6667, evidenceRequired: false }] }], "v", 100).map((x) => x.amountCents)).toEqual([33,67])));
describe("matching", () => it("excludes invalid credentials", () => expect(rankCandidates([{ technicianId: "t", contractorId: "c", distanceKm: 1, ratingBps: 490, completionRateBps: 9900, responseMinutes: 10, workload: 0, available: true, emergencyAvailable: true, credentials: [{ code: "LICENSE", status: "EXPIRED" }] }], ["LICENSE"], false)).toHaveLength(0)));
describe("fees", () => it("calculates basis-point fees with no float money", () => expect(calculateFee(12_345, 850)).toBe(1_049)));
