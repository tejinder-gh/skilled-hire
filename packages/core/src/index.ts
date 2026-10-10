import type { CredentialStatus, PaymentRule, QuoteItemInput, RankedCandidate, ServiceRequestStatus } from "@marketplace/contracts";
import { selectPaymentRule } from "@marketplace/vertical-engine";

const transitions: Readonly<Record<ServiceRequestStatus, readonly ServiceRequestStatus[]>> = {
  DRAFT: ["SUBMITTED"], SUBMITTED: ["QUALIFICATION_PENDING", "CANCELLED", "DISPUTED"], QUALIFICATION_PENDING: ["QUALIFIED", "CANCELLED", "DISPUTED"], QUALIFIED: ["SCHEDULING", "CANCELLED", "DISPUTED"], SCHEDULING: ["SCHEDULED", "CANCELLED", "DISPUTED"], SCHEDULED: ["CONTRACTOR_SEARCH", "CANCELLED", "DISPUTED"], CONTRACTOR_SEARCH: ["ASSIGNED", "CANCELLED", "DISPUTED"], ASSIGNED: ["TECHNICIAN_EN_ROUTE", "CANCELLED", "DISPUTED"], TECHNICIAN_EN_ROUTE: ["TECHNICIAN_ARRIVED", "CANCELLED", "DISPUTED"], TECHNICIAN_ARRIVED: ["ASSESSMENT_IN_PROGRESS", "DISPUTED"], ASSESSMENT_IN_PROGRESS: ["QUOTE_PENDING", "DISPUTED"], QUOTE_PENDING: ["QUOTE_SUBMITTED", "DISPUTED"], QUOTE_SUBMITTED: ["QUOTE_APPROVED", "QUOTE_REJECTED", "CANCELLED", "DISPUTED"], QUOTE_APPROVED: ["MATERIALS_PENDING", "WORK_SCHEDULED", "DISPUTED"], QUOTE_REJECTED: ["QUOTE_PENDING", "CANCELLED", "DISPUTED"], MATERIALS_PENDING: ["WORK_SCHEDULED", "DISPUTED"], WORK_SCHEDULED: ["WORK_IN_PROGRESS", "CANCELLED", "DISPUTED"], WORK_IN_PROGRESS: ["ON_HOLD", "CHANGE_ORDER_PENDING", "COMPLETION_PENDING", "DISPUTED"], ON_HOLD: ["WORK_IN_PROGRESS", "CANCELLED", "DISPUTED"], CHANGE_ORDER_PENDING: ["WORK_IN_PROGRESS", "ON_HOLD", "DISPUTED"], COMPLETION_PENDING: ["COMPLETED", "WORK_IN_PROGRESS", "DISPUTED"], COMPLETED: ["CLOSED", "DISPUTED"], CANCELLED: [], DISPUTED: ["CLOSED"], CLOSED: []
};
export function assertTransition(from: ServiceRequestStatus, to: ServiceRequestStatus): void { if (!transitions[from].includes(to)) throw new Error(`Invalid transition from ${from} to ${to}`); }
export function quoteTotals(items: readonly QuoteItemInput[], platformFeeCents: number, discountCents: number, taxCents: number): { contractorSubtotalCents: number; customerTotalCents: number; itemSubtotals: number[] } {
  const itemSubtotals = items.map((item) => checkedMultiply(item.quantity, item.unitPriceCents));
  const contractorSubtotalCents = itemSubtotals.reduce((sum, amount) => checkedAdd(sum, amount), 0);
  const customerTotalCents = checkedAdd(checkedAdd(checkedAdd(contractorSubtotalCents, platformFeeCents), taxCents), -discountCents);
  if (customerTotalCents < 0) throw new Error("Quote total cannot be negative");
  return { contractorSubtotalCents, customerTotalCents, itemSubtotals };
}
function checkedMultiply(a: number, b: number): number { const result = a * b; if (!Number.isSafeInteger(result)) throw new Error("Money calculation overflow"); return result; }
function checkedAdd(a: number, b: number): number { const result = a + b; if (!Number.isSafeInteger(result)) throw new Error("Money calculation overflow"); return result; }
export function createPaymentMilestones(rules: readonly PaymentRule[], verticalId: string, totalCents: number): Array<{ sequence: number; trigger: string; amountCents: number; evidenceRequired: boolean }> {
  const rule = selectPaymentRule(rules, verticalId, totalCents); let allocated = 0;
  return rule.milestones.map((milestone, index) => { const isLast = index === rule.milestones.length - 1; const amountCents = isLast ? totalCents - allocated : Math.floor(totalCents * milestone.percentageBps / 10_000); allocated += amountCents; return { sequence: index + 1, trigger: milestone.trigger, amountCents, evidenceRequired: milestone.evidenceRequired }; });
}
export function calculateFee(totalCents: number, takeRateBps: number): number { if (!Number.isInteger(totalCents) || totalCents < 0 || !Number.isInteger(takeRateBps) || takeRateBps < 0 || takeRateBps > 10_000) throw new Error("Invalid fee inputs"); return Math.floor(totalCents * takeRateBps / 10_000); }
export interface CandidateInput { technicianId: string; contractorId: string; distanceKm: number; ratingBps: number; completionRateBps: number; responseMinutes: number; workload: number; credentials: Array<{ code: string; status: CredentialStatus; expiryDate?: string | null }>; available: boolean; emergencyAvailable: boolean; }
export function rankCandidates(candidates: readonly CandidateInput[], requiredCredentialCodes: readonly string[], emergency: boolean, now = new Date()): RankedCandidate[] {
  return candidates.filter((candidate) => candidate.available && (!emergency || candidate.emergencyAvailable) && requiredCredentialCodes.every((code) => candidate.credentials.some((credential) => credential.code === code && credential.status === "VERIFIED" && (!credential.expiryDate || new Date(credential.expiryDate) >= now)))).map((candidate) => {
    const score = Math.round(candidate.ratingBps * 5 + candidate.completionRateBps * 0.02 - candidate.distanceKm * 20 - candidate.responseMinutes * 0.4 - candidate.workload * 50);
    return { technicianId: candidate.technicianId, contractorId: candidate.contractorId, score, reasons: [`${candidate.distanceKm.toFixed(1)} km away`, `rating ${(candidate.ratingBps / 100).toFixed(1)}`, `completion ${(candidate.completionRateBps / 100).toFixed(0)}%`] };
  }).sort((a, b) => b.score - a.score);
}
