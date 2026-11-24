import crypto from "crypto";
import { LoginThrottle } from "../models/LoginThrottle";
import { AppError } from "../../../../packages/shared/errors/AppError";

/**
 * Per-account sign-in throttle (SEC-025).
 *
 * The gateway limits sign-in attempts per IP (5 per 15 min), but that limit
 * fails open while Redis is unavailable and does nothing against guesses
 * spread over many addresses. This throttle counts failed attempts per
 * ACCOUNT in MongoDB (no Redis dependency):
 *
 *  - every failed attempt (wrong password OR unknown e-mail, so responses do
 *    not reveal whether an account exists) increments a counter for the
 *    normalised e-mail inside a window;
 *  - when the counter reaches the limit, the account is locked: further
 *    attempts get 429 WITHOUT a password check, whatever the password, until
 *    the lock ends;
 *  - a successful sign-in clears the counter.
 *
 * Defaults (documented in docs/reference/environment-variables.md):
 *   LOGIN_THROTTLE_MAX_FAILURES  10        failures that trigger a lock
 *   LOGIN_THROTTLE_WINDOW_MS     900000    window in which failures count (15 min)
 *   LOGIN_THROTTLE_LOCK_MS       900000    lock duration (15 min)
 *
 * Residual: anyone who knows an e-mail can lock that account for the lock
 * duration (bounded nuisance); concurrent guesses that arrive before the lock
 * is written may each be checked, so a burst can exceed the limit by the
 * number of requests in flight (the gateway's per-IP limit still applies).
 */

const LIMITS = {
  LOGIN_THROTTLE_MAX_FAILURES: { fallback: 10, min: 1, max: 1000 },
  LOGIN_THROTTLE_WINDOW_MS: { fallback: 15 * 60 * 1000, min: 1000, max: 24 * 60 * 60 * 1000 },
  LOGIN_THROTTLE_LOCK_MS: { fallback: 15 * 60 * 1000, min: 1000, max: 24 * 60 * 60 * 1000 },
} as const;

const warned = new Set<string>();

const readSetting = (name: keyof typeof LIMITS): number => {
  const { fallback, min, max } = LIMITS[name];
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[auth-service] ${name} must be an integer from ${min} to ${max}; using ${fallback}`);
    }
    return fallback;
  }
  return value;
};

/** Current settings (read per call, so they can be changed without a restart in tests). */
export const loginThrottleSettings = () => ({
  maxFailures: readSetting("LOGIN_THROTTLE_MAX_FAILURES"),
  windowMs: readSetting("LOGIN_THROTTLE_WINDOW_MS"),
  lockMs: readSetting("LOGIN_THROTTLE_LOCK_MS"),
});

export const ACCOUNT_LOCKED_MESSAGE =
  "Too many failed sign-in attempts for this account. Please try again later.";

/** Hash of the normalised e-mail: the collection never stores the address. */
export const loginThrottleKey = (email: string) =>
  crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");

/** Throw 429 while the account is locked. Call BEFORE any password check. */
export const assertLoginAllowed = async (key: string) => {
  const locked = await LoginThrottle.exists({ key, lockedUntil: { $gt: new Date() } });
  if (locked) {
    throw new AppError(ACCOUNT_LOCKED_MESSAGE, 429);
  }
};

/**
 * Count one failed attempt atomically (single-document pipeline upsert):
 * starts a new window when there is none or it has passed, and sets the lock
 * when the count reaches the limit.
 */
export const recordLoginFailure = async (key: string) => {
  const { maxFailures, windowMs, lockMs } = loginThrottleSettings();
  const now = Date.now();
  const pipeline = [
    {
      $set: {
        _newWindow: {
          $or: [
            { $eq: [{ $type: "$windowStart" }, "missing"] },
            { $lte: ["$windowStart", new Date(now - windowMs)] },
          ],
        },
      },
    },
    {
      $set: {
        failures: { $cond: ["$_newWindow", 1, { $add: ["$failures", 1] }] },
        windowStart: { $cond: ["$_newWindow", new Date(now), "$windowStart"] },
      },
    },
    {
      $set: {
        lockedUntil: {
          $cond: [{ $gte: ["$failures", maxFailures] }, new Date(now + lockMs), { $ifNull: ["$lockedUntil", null] }],
        },
        expiresAt: new Date(now + Math.max(windowMs, lockMs)),
      },
    },
    { $unset: "_newWindow" },
  ];

  for (let attempt = 0; ; attempt++) {
    try {
      await LoginThrottle.collection.updateOne({ key }, pipeline, { upsert: true });
      return;
    } catch (error) {
      // Two first failures racing on the unique key: the loser retries as an update.
      if ((error as { code?: number })?.code === 11000 && attempt === 0) continue;
      throw error;
    }
  }
};

/** A successful sign-in clears the account's failure count. */
export const clearLoginFailures = async (key: string) => {
  await LoginThrottle.deleteOne({ key });
};
