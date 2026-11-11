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
 */

const redisUrl =
  process.env.REDIS_URL || "redis://127.0.0.1:6379";

/*
 * A dedicated connection for rate limiting.
 *
 * The offline queue must stay ENABLED. rate-limit-redis loads its increment
 * script the moment each limiter is constructed -- which is at module load,
 * before the socket is writeable. With the queue disabled that first command
 * throws, every store fails to initialise, and (because `passOnStoreError` is
 * on) all limiting silently degrades to no limiting at all.
 *
 * `maxRetriesPerRequest` is finite rather than null so that if Redis is
 * genuinely down, commands fail fast and fail open instead of queueing
 * forever and hanging the request.
 */
const limiterRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  connectTimeout: 5000,
  lazyConnect: false,
});

let redisWarned = false;
limiterRedis.on("error", (error: Error) => {
  // Log once rather than on every reconnect attempt.
  if (!redisWarned) {
    redisWarned = true;
    console.error(
      `[api-gateway] rate-limit Redis unavailable (${error.message}); limiters will fail open until it recovers`
    );
  }
});
limiterRedis.on("ready", () => {
  redisWarned = false;
});

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

const baseOptions: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  /*
   * Fail OPEN if Redis errors.
   *
   * A rate limiter is a availability control, not an authorization control --
   * the JWT and workspace checks are what actually protect data. Taking the
   * whole API down because Redis blipped would be a worse outcome than briefly
   * unthrottled traffic. The error is logged above so it cannot pass silently.
   */
  passOnStoreError: true,
};

/** Each limiter needs its own store prefix or they share a counter. */
const store = (prefix: string) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) =>
      (limiterRedis as any).call(...args),
  });

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
