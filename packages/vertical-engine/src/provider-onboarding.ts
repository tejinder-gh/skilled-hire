import type {
  ProviderApplicationDTO,
  ProviderRateProposal,
  ProviderSubmitApplicationInput,
  ServiceGeographyDecision,
} from "@marketplace/contracts";
import { CANONICAL_TRADE_CATALOG } from "./catalog.js";

export const ONTARIO_FSA_REGEX = /^[A-Z][0-9][A-Z]$/i;

export interface PostalValidationResult {
  valid: boolean;
  normalizedFsaList: string[];
  invalidCodes: string[];
}

export function validateAndNormalizePostalTerritories(
  postalCodes: string[],
): PostalValidationResult {
  const normalizedSet = new Set<string>();
  const invalidCodes: string[] = [];

  for (const raw of postalCodes) {
    const cleaned = raw.trim().replace(/\s+/g, "").toUpperCase();
    const fsa = cleaned.slice(0, 3);
    if (ONTARIO_FSA_REGEX.test(fsa)) {
      normalizedSet.add(fsa);
    } else {
      invalidCodes.push(raw);
    }
  }

  return {
    valid: invalidCodes.length === 0 && normalizedSet.size > 0,
    normalizedFsaList: Array.from(normalizedSet),
    invalidCodes,
  };
}

export interface TradeValidationResult {
  valid: boolean;
  validSlugs: string[];
  invalidSlugs: string[];
}

export function validateTradeVerticals(
  verticalSlugs: string[],
): TradeValidationResult {
  const canonicalSlugs = new Set(CANONICAL_TRADE_CATALOG.map((v) => v.slug));
  const validSlugs: string[] = [];
  const invalidSlugs: string[] = [];

  for (const slug of verticalSlugs) {
    if (canonicalSlugs.has(slug)) {
      validSlugs.push(slug);
    } else {
      invalidSlugs.push(slug);
    }
  }

  return {
    valid: invalidSlugs.length === 0 && validSlugs.length > 0,
    validSlugs,
    invalidSlugs,
  };
}

export interface RateSanityResult {
  valid: boolean;
  anomalies: string[];
}

export function checkRateProposalSanity(
  proposals: ProviderRateProposal[],
): RateSanityResult {
  const anomalies: string[] = [];

  for (const p of proposals) {
    // Hourly rate sanity: min $45/hr (4500 cents), max $450/hr (45000 cents)
    if (p.hourlyRateCents < 4500) {
      anomalies.push(
        `Vertical '${p.verticalSlug}' proposed hourly rate ($${(p.hourlyRateCents / 100).toFixed(2)}) is below provincial minimum benchmark ($45.00/hr).`,
      );
    }
    if (p.hourlyRateCents > 45000) {
      anomalies.push(
        `Vertical '${p.verticalSlug}' proposed hourly rate ($${(p.hourlyRateCents / 100).toFixed(2)}) exceeds standard market threshold ($450.00/hr).`,
      );
    }
    // Diagnostic fee sanity: max $350 (35000 cents)
    if (p.diagnosticFeeCents > 35000) {
      anomalies.push(
        `Vertical '${p.verticalSlug}' diagnostic call-out fee ($${(p.diagnosticFeeCents / 100).toFixed(2)}) exceeds standard allowable limit ($350.00).`,
      );
    }
  }

  return {
    valid: anomalies.length === 0,
    anomalies,
  };
}

export interface ApplicationReadiness {
  readinessScoreBps: number;
  isReadyForReview: boolean;
  missingItems: string[];
}

export function assessOnboardingReadiness(
  app: ProviderApplicationDTO,
): ApplicationReadiness {
  const missing: string[] = [];
  let score = 0;

  if (app.businessNumber && app.businessNumber.trim().length >= 9) {
    score += 2000;
  } else {
    missing.push("Verified Ontario Business Number (BN) / Corporate Registry #");
  }

  if (app.postalCodes.length > 0) {
    score += 2000;
  } else {
    missing.push("Primary postal code territory coverage (FSA zones)");
  }

  if (app.selectedVerticals.length > 0) {
    score += 2000;
  } else {
    missing.push("Trade vertical service selections");
  }

  if (app.serviceRatesProposal.length > 0) {
    score += 1500;
  } else {
    missing.push("Itemized service rate schedule and call-out fees");
  }

  if (app.technicians && app.technicians.length > 0) {
    score += 1500;
    const hasUnlicensed = app.technicians.some((t) => !t.licenseNumber);
    if (hasUnlicensed) {
      missing.push("All technicians must have valid trade license credentials");
    }
  } else {
    missing.push("At least one registered licensed technician");
  }

  if (app.consentAccepted) {
    score += 1000;
  } else {
    missing.push("Signed marketplace compliance covenants and consent");
  }

  return {
    readinessScoreBps: Math.min(10000, score),
    isReadyForReview: score >= 8500 && missing.length === 0,
    missingItems: missing,
  };
}

export function evaluateServiceGeographyApprovals(
  selectedVerticals: string[],
  territoryCodes: string[],
  decisions: ServiceGeographyDecision[],
): {
  approvedPairs: Array<{ verticalSlug: string; territoryCode: string }>;
  pendingPairs: Array<{ verticalSlug: string; territoryCode: string }>;
  rejectedPairs: Array<{ verticalSlug: string; territoryCode: string }>;
} {
  const approvedPairs: Array<{ verticalSlug: string; territoryCode: string }> = [];
  const pendingPairs: Array<{ verticalSlug: string; territoryCode: string }> = [];
  const rejectedPairs: Array<{ verticalSlug: string; territoryCode: string }> = [];

  for (const vertical of selectedVerticals) {
    for (const territory of territoryCodes) {
      const decision = decisions.find(
        (d) => d.verticalSlug === vertical && d.territoryCode === territory,
      );

      if (!decision || decision.status === "CONDITIONALLY_APPROVED") {
        pendingPairs.push({ verticalSlug: vertical, territoryCode: territory });
      } else if (decision.status === "APPROVED") {
        approvedPairs.push({ verticalSlug: vertical, territoryCode: territory });
      } else {
        rejectedPairs.push({ verticalSlug: vertical, territoryCode: territory });
      }
    }
  }

  return { approvedPairs, pendingPairs, rejectedPairs };
}
