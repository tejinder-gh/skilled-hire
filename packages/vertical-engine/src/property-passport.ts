// packages/vertical-engine/src/property-passport.ts

import type {
  AccessGrantScope,
  PassportServiceHistoryItem,
} from "@marketplace/contracts";

export interface FilterHistoryOptions {
  history: PassportServiceHistoryItem[];
  scope: AccessGrantScope;
  isOwner: boolean;
  requestingContractorId?: string | undefined;
  serviceVerticalId?: string | null | undefined;
}

export function filterPassportServiceHistory(
  options: FilterHistoryOptions,
): PassportServiceHistoryItem[] {
  const { history, scope, isOwner, serviceVerticalId } = options;

  if (isOwner) {
    return history.map((item) => ({ ...item, costRedacted: false }));
  }

  return history
    .filter((item) => {
      if (scope === "SERVICE_SPECIFIC" && serviceVerticalId) {
        // If vertical specific, filter by vertical
        return item.vertical.toLowerCase() === serviceVerticalId.toLowerCase();
      }
      return true;
    })
    .map((item) => {
      // For third party contractors, commercial cost is redacted
      const costRedacted = scope === "REDACTED_COMMERCIAL" || scope === "SERVICE_SPECIFIC" || scope === "FULL_HISTORY";
      return {
        ...item,
        costRedacted,
      };
    });
}

export function generateOwnershipTransferToken(): string {
  const rand = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
  return `TRF-${rand.toUpperCase()}`;
}
