export interface CookieOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  domain?: string;
}

export function formatCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts: string[] = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  const path = options.path ?? "/";
  parts.push(`Path=${path}`);

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  }

  if (options.httpOnly ?? true) {
    parts.push("HttpOnly");
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (options.secure ?? isProduction) {
    parts.push("Secure");
  }

  const sameSite = options.sameSite ?? "lax";
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase() + sameSite.slice(1).toLowerCase()}`);

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  return parts.join("; ");
}

export function formatClearCookie(
  name: string,
  options: Pick<CookieOptions, "path" | "domain"> = {},
): string {
  return formatCookie(name, "", {
    ...options,
    maxAgeSeconds: 0,
  });
}

export function parseCookies(header?: string | null): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};

  const pairs = header.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, idx).trim());
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    if (key) {
      cookies[key] = val;
    }
  }

  return cookies;
}
