import crypto from "crypto";
import jwt from "jsonwebtoken";

/**
 * ACCESS_TOKEN_EXPIRES / REFRESH_TOKEN_EXPIRES (Wave 6, W6-SEC-05).
 *
 * Checked at startup with the SAME parser jwt.sign uses: a probe token is
 * signed with the value and its lifetime is read back as exp - iat. So a
 * value accepted here can never make jwt.sign fail at request time.
 *
 *   ACCESS_TOKEN_EXPIRES   default 5m (SEC-007); must be > 0 and <= 15m
 *   REFRESH_TOKEN_EXPIRES  default 7d; must be <= 30d and longer than the
 *                          access lifetime
 *
 * A value must carry a unit ("5m", "900s", "7d"): jsonwebtoken reads a
 * string of digits as MILLISECONDS, so "900" would be a 0-second token.
 * Errors name the variable and the rule, never the value.
 */
export const DEFAULT_ACCESS_TOKEN_EXPIRES = "5m";
export const DEFAULT_REFRESH_TOKEN_EXPIRES = "7d";
export const MAX_ACCESS_TOKEN_SECONDS = 15 * 60;
export const MAX_REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

export interface TokenLifetime {
  /** The value handed to jwt.sign as expiresIn. */
  expiresIn: string;
  /** exp - iat of a token signed with it. */
  seconds: number;
}

export type TokenLifetimesResult =
  | { ok: true; access: TokenLifetime; refresh: TokenLifetime }
  | { ok: false; variable: "ACCESS_TOKEN_EXPIRES" | "REFRESH_TOKEN_EXPIRES"; message: string };

const PROBE_KEY = crypto.randomBytes(32).toString("hex");

/** Lifetime in seconds as jwt.sign computes it, or null when jwt.sign refuses the value. */
const signedLifetime = (expiresIn: string): number | null => {
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(expiresIn)) return null; // no unit: milliseconds trap
  try {
    const token = jwt.sign({}, PROBE_KEY, { algorithm: "HS256", expiresIn: expiresIn as any });
    const payload = jwt.decode(token) as { iat?: number; exp?: number } | null;
    if (typeof payload?.iat !== "number" || typeof payload?.exp !== "number") return null;
    return payload.exp - payload.iat;
  } catch {
    return null;
  }
};

const FORMAT = 'must be a duration with a unit, such as "5m", "900s" or "7d"';

export const readTokenLifetimes = (env: NodeJS.ProcessEnv = process.env): TokenLifetimesResult => {
  const accessRaw = env.ACCESS_TOKEN_EXPIRES || DEFAULT_ACCESS_TOKEN_EXPIRES;
  const refreshRaw = env.REFRESH_TOKEN_EXPIRES || DEFAULT_REFRESH_TOKEN_EXPIRES;

  const access = signedLifetime(accessRaw);
  if (access === null) return { ok: false, variable: "ACCESS_TOKEN_EXPIRES", message: `ACCESS_TOKEN_EXPIRES ${FORMAT}` };
  if (access <= 0 || access > MAX_ACCESS_TOKEN_SECONDS) {
    return {
      ok: false,
      variable: "ACCESS_TOKEN_EXPIRES",
      message: "ACCESS_TOKEN_EXPIRES must be longer than 0 and at most 15 minutes (access tokens cannot be revoked; SEC-007)",
    };
  }

  const refresh = signedLifetime(refreshRaw);
  if (refresh === null) return { ok: false, variable: "REFRESH_TOKEN_EXPIRES", message: `REFRESH_TOKEN_EXPIRES ${FORMAT}` };
  if (refresh > MAX_REFRESH_TOKEN_SECONDS) {
    return { ok: false, variable: "REFRESH_TOKEN_EXPIRES", message: "REFRESH_TOKEN_EXPIRES must be at most 30 days" };
  }
  if (refresh <= access) {
    return {
      ok: false,
      variable: "REFRESH_TOKEN_EXPIRES",
      message: "REFRESH_TOKEN_EXPIRES must be longer than ACCESS_TOKEN_EXPIRES",
    };
  }

  return { ok: true, access: { expiresIn: accessRaw, seconds: access }, refresh: { expiresIn: refreshRaw, seconds: refresh } };
};

/** Startup check: one "refusing to start" line naming the variable, exit 1. */
export const assertTokenLifetimes = (serviceName: string, env: NodeJS.ProcessEnv = process.env): void => {
  const result = readTokenLifetimes(env);
  if (!result.ok) {
    console.error(`[${serviceName}] refusing to start: ${result.message}`);
    process.exit(1);
  }
};
