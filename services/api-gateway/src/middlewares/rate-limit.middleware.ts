import rateLimit from "express-rate-limit";

/** Limit excessive API requests from a single client. */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});