/**
 * Browser origins allowed to call the API gateway (SEC-015, scope-review R1).
 *
 * CORS_ORIGIN (gateway only) is a comma-separated list of exact origins,
 * e.g. "https://app.example.com, http://localhost:5173".
 *  - Unset or empty: the local development default -- any LOOPBACK origin
 *    over http (http://localhost:<any port> or http://127.0.0.1:<any port>).
 *    Vite may start on another port when 5173 is taken, so the port is not
 *    fixed. Tokens are sent as bearer headers, not cookies, so this exposes
 *    no credentials. Production must set CORS_ORIGIN.
 *  - Set: ONLY those origins (loopback is not added implicitly).
 *  - "*" and malformed entries (paths, other schemes, "null") are refused:
 *    the gateway does not start.
 * Requests without an Origin header (curl, service-to-service) are unaffected.
 */

export interface CorsOriginSetting {
  origins: string[];
  loopbackDefault: boolean;
  error?: string;
}

const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const normaliseOrigin = (entry: string): string | null => {
  const trimmed = entry.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  // An origin as browsers send it: scheme://host[:port], no trailing slash.
  if (url.origin.toLowerCase() !== trimmed.toLowerCase()) return null;
  return url.origin;
};

export const parseCorsOrigins = (raw: string | undefined): CorsOriginSetting => {
  const text = (raw ?? "").trim();
  if (text === "") return { origins: [], loopbackDefault: true };
  const entries = text.split(",").map((e) => e.trim()).filter(Boolean);
  const origins: string[] = [];
  for (const entry of entries) {
    const origin = entry === "*" || entry.toLowerCase() === "null" ? null : normaliseOrigin(entry);
    if (!origin) {
      return {
        origins: [],
        loopbackDefault: false,
        error: "CORS_ORIGIN must be a comma-separated list of exact origins such as https://app.example.com (no \"*\", no paths)",
      };
    }
    origins.push(origin);
  }
  return { origins, loopbackDefault: false };
};

/** A predicate for the `cors` middleware's origin option. */
export const corsOriginAllowed = (setting: CorsOriginSetting) => (origin: string | undefined): boolean => {
  if (!origin) return false;
  if (setting.loopbackDefault) return LOOPBACK_ORIGIN.test(origin);
  return setting.origins.includes(origin);
};
