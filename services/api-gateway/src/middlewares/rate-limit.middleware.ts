import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import Redis from "ioredis";
import { Request, Response } from "express";

/**
 * Redis-backed, per-route rate limiting.
 *
 * The previous configuration was a single in-memory limiter of 1000 requests
 * per 15 minutes per IP applied to everything, including `/api/auth/login`.
 * That is ~1000 password guesses per window per IP, it reset on every restart,
 * and it was per-process so it did not hold across more than one gateway
 * instance. AI routes had no per-user cap at all, so one account could exhaust
 * the whole Voyage/Groq budget.
 *
 * Availability policy (RT-001): the limiters FAIL OPEN while Redis is not
 * usable, and they fail open FAST. A rate limiter is an availability control,
 * not an authorization control -- the JWT and workspace checks protect the
 * data, and auth-service has its own per-account login throttle that does not
 * depend on Redis (SEC-025). There is deliberately no in-memory fallback
 * store: it would be per-process, reset on restart and unbounded.
 *
 * How "fast" is guaranteed:
 *  - `skip` lets a request through without touching Redis while the client is
 *    not `ready` (connecting, reconnecting, refused, blackholed) or while the
 *    short degraded latch is set;
 *  - every command has a short `commandTimeout`, so a Redis that accepts the
 *    connection but never answers (frozen) costs at most that long, and the
 *    first timeout sets the latch so the following requests skip at once;
 *  - one log line per outage instead of one stack trace per request.
 *
 * How limiting comes back (RT-001b): rate-limit-redis loads its Lua scripts
 * once, in `init`, and caches the promise. If that load failed (gateway
 * started while Redis was down) the cached rejection was re-thrown on every
 * request for the life of the process, so limits never resumed. The store
 * below reloads its scripts whenever the client becomes `ready` and whenever a
 * request finds them missing.
 */

const redisUrl =
  process.env.REDIS_URL || "redis://127.0.0.1:6379";

/** Upper bound for one limiter command; keeps two chained limiters < 1 s. */
export const LIMITER_COMMAND_TIMEOUT_MS = 300;
/** After a store error, skip Redis entirely for this long. */
export const LIMITER_DEGRADED_LATCH_MS = 5000;

/*
 * A dedicated connection for rate limiting.
 *
 * The offline queue stays ENABLED: the stores' script loads are issued at
 * module load, before the socket is writeable, and must be queued rather than
 * thrown. Request-time commands are never queued, because `skip` bypasses the
 * store whenever the client is not ready; `commandTimeout` also bounds any
 * command that is queued. Reconnects back off to at most 2 s, so limits
 * resume within a few seconds of Redis returning.
 */
const limiterRedis = new Redis(redisUrl, {
  enableOfflineQueue: true,
  maxRetriesPerRequest: 1,
  commandTimeout: LIMITER_COMMAND_TIMEOUT_MS,
  connectTimeout: 2000,
  retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
  lazyConnect: false,
});

let degradedUntil = 0;
let outageLogged = false;

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Record a Redis problem: set the latch and log once per outage. */
const markDegraded = (error: unknown) => {
  degradedUntil = Date.now() + LIMITER_DEGRADED_LATCH_MS;
  if (!outageLogged) {
    outageLogged = true;
    console.error(
      `[api-gateway] rate-limit Redis unavailable (${describeError(error)}); limiters fail open until it recovers`
    );
  }
};

/** Redis answered again: re-arm the outage log (a freeze ends without `ready`). */
const markRecovered = () => {
  if (outageLogged) {
    outageLogged = false;
    console.log("[api-gateway] rate-limit Redis available again; limiters active");
  }
};

/** True while the limiters must not touch Redis (fail open immediately). */
export const limiterRedisUnavailable = () =>
  limiterRedis.status !== "ready" || Date.now() < degradedUntil;

const stores: ResilientRedisStore[] = [];

limiterRedis.on("error", markDegraded);
limiterRedis.on("ready", () => {
  degradedUntil = 0;
  markRecovered();
  for (const store of stores) store.reloadScripts();
});

/**
 * RedisStore that survives Redis outages: script loading is retried instead of
 * cached as failed, and decrement/reset errors (which express-rate-limit
 * fires and forgets) are absorbed instead of becoming unhandled rejections.
 */
class ResilientRedisStore extends RedisStore {
  private initOptions: Parameters<RedisStore["init"]>[0] | undefined;
  private loading: Promise<void> | undefined;
  private scriptsLoaded = false;

  async init(options: Parameters<RedisStore["init"]>[0]): Promise<void> {
    this.initOptions = options;
    await this.loadScripts().catch(markDegraded);
  }

  /** Load (or reload) the Lua scripts; concurrent callers share one attempt. */
  private loadScripts(): Promise<void> {
    if (!this.initOptions) return Promise.resolve();
    this.loading ??= super
      .init(this.initOptions)
      .then(() => {
        this.scriptsLoaded = true;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  reloadScripts(): void {
    this.scriptsLoaded = false;
    this.loadScripts().catch(markDegraded);
  }

  async increment(key: string) {
    if (!this.scriptsLoaded) await this.loadScripts();
    const result = await super.increment(key);
    markRecovered();
    return result;
  }

  async decrement(key: string) {
    await super.decrement(key).catch(markDegraded);
  }

  async resetKey(key: string) {
    await super.resetKey(key).catch(markDegraded);
  }
}

/** Standard error envelope, matching the rest of the API. */
const tooManyRequests = (message: string) =>
  (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message,
    });
  };

/** Identify the caller by authenticated user when possible, else by IP. */
const userOrIpKey = (req: Request): string => {
  const userId = (req as any).user?.userId || (req as any).user?.id;
  if (userId) {
    return `user:${userId}`;
  }
  // ipKeyGenerator normalises IPv6 into a /64 subnet so a single client cannot
  // trivially rotate through addresses in its own prefix.
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
};

/** Identify strictly by IP -- used for unauthenticated auth routes. */
const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? "");

/**
 * Store errors reach express-rate-limit's logger (passOnStoreError). Turn them
 * into the latch + one line per outage; anything else (validation warnings)
 * goes to the console as before.
 */
const limiterLogger: Options["logger"] = {
  warn: (error, message) => console.warn(message ?? "", error),
  error: (error, message) => {
    if (typeof message === "string" && /store/i.test(message)) {
      markDegraded(error);
      return;
    }
    console.error(message ?? "", error);
  },
};

const baseOptions: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Fail open at once while Redis is not usable (see the header comment).
  skip: limiterRedisUnavailable,
  // ...and fail open if a command still fails (e.g. Redis froze mid-request).
  passOnStoreError: true,
  logger: limiterLogger,
};

/** Each limiter needs its own store prefix or they share a counter. */
const store = (prefix: string) => {
  const created = new ResilientRedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) =>
      (limiterRedis as any).call(...args),
  });
  stores.push(created);
  return created;
};

/** POST /api/auth/login — 5 per 15 minutes per IP. */
export const loginRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: ipKey,
  store: store("login"),
  // A failed login must count; a successful one should not punish a user who
  // simply signs in from several devices.
  skipSuccessfulRequests: true,
  handler: tooManyRequests(
    "Too many sign-in attempts. Please wait 15 minutes and try again."
  ),
});

/** POST /api/auth/register — 3 per hour per IP. */
export const registerRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: ipKey,
  store: store("register"),
  handler: tooManyRequests(
    "Too many accounts created from this network. Please try again later."
  ),
});

/** POST /api/ai/query and /api/ai/search — 30 per hour per user. */
export const aiQueryRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: userOrIpKey,
  store: store("ai-query"),
  handler: tooManyRequests(
    "You've reached the hourly limit for AI research requests. Please try again later."
  ),
});

/** POST /api/ai/summarize-meeting — 20 per hour per user. */
export const aiSummarizeRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: userOrIpKey,
  store: store("ai-summarize"),
  handler: tooManyRequests(
    "You've reached the hourly limit for meeting summaries. Please try again later."
  ),
});

/**
 * Every /api/auth route — 60 per minute per IP (SEC-021). Covers refresh,
 * /me and /logout, which had no limit; login and register also count here
 * but their own limits are stricter. A 429 on refresh does not sign the
 * client out (the SPA keeps the session and retries later).
 */
export const authApiRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: ipKey,
  store: store("auth-api"),
  handler: tooManyRequests(
    "Too many requests. Please slow down and try again shortly."
  ),
});

/** Everything else — 100 per minute per user. */
export const apiRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: userOrIpKey,
  store: store("api"),
  handler: tooManyRequests(
    "Too many requests. Please slow down and try again shortly."
  ),
});

/** Exposed so the gateway can report Redis health. */
export const rateLimitRedis = limiterRedis;
