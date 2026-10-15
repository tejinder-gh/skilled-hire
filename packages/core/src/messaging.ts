export interface ModerationResult {
  status: "CLEAN" | "FLAGGED" | "BLOCKED";
  reasons: string[];
}

const CIRCUMVENTION_REGEXES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(e-?transfer|etransfer|interac\s*(direct|transfer)?)\b/i,
    reason: "OFF_PLATFORM_ETRANSFER_DETECTED",
  },
  {
    pattern: /\b(cash\s*(discount|deal|only|direct)|pay\s*(cash|in\s*cash|outside|direct)|under\s*the\s*table|off\s*the\s*books)\b/i,
    reason: "OFF_PLATFORM_CASH_SOLICITATION",
  },
  {
    pattern: /\b(venmo|zelle|cash\s*app|paypal)\b/i,
    reason: "UNAUTHORIZED_PAYMENT_METHOD",
  },
  {
    pattern: /(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    reason: "DIRECT_PHONE_NUMBER_SHARED",
  },
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    reason: "DIRECT_EMAIL_SHARED",
  },
];

export function screenMessageContent(content: string): ModerationResult {
  const reasons: string[] = [];
  const normalized = content.trim();

  for (const rule of CIRCUMVENTION_REGEXES) {
    if (rule.pattern.test(normalized)) {
      reasons.push(rule.reason);
    }
  }

  if (reasons.length > 0) {
    return {
      status: "FLAGGED",
      reasons,
    };
  }

  return {
    status: "CLEAN",
    reasons: [],
  };
}

export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return "+1 (***) ***-****";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return "+1 (***) ***-****";
  const area = digits.slice(-10, -7);
  const last4 = digits.slice(-4);
  return `+1 (${area}) ***-${last4}`;
}

export function generateMaskedSessionIdentifiers(jobId: string): {
  sessionExtension: string;
  sessionPin: string;
  virtualProxyNumber: string;
} {
  let hash = 0;
  for (let i = 0; i < jobId.length; i++) {
    hash = (hash << 5) - hash + jobId.charCodeAt(i);
    hash |= 0;
  }
  const posHash = Math.abs(hash);
  const sessionExtension = String(1000 + (posHash % 9000));
  const sessionPin = String(1000 + ((posHash * 13) % 9000));
  return {
    virtualProxyNumber: "+16475550199",
    sessionExtension,
    sessionPin,
  };
}
