import jwt from "jsonwebtoken";

/*
 * The ONE access-token verifier (SEC-019 c, ISS-047). The gateway, the shared
 * `authenticate` (ai, document, task), auth-service and workspace-service all
 * call it and only differ in the error response they send.
 *
 * - The algorithm is pinned to HS256 (no `alg` header is honoured).
 * - `userId` must be a 24-hex ObjectId string. A validly signed token whose
 *   userId was an object (`{"$gt":""}`) used to reach Mongo filters as a
 *   query operator and list every workspace; a missing or malformed userId
 *   is refused the same way as a bad signature.
 * - Only `{ userId }` is returned: no other claim reaches `req.user`.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/;

/** True when `value` is a 24-hex ObjectId string (as issued by auth-service). */
export const isTokenUserId = (value: unknown): value is string =>
  typeof value === "string" && OBJECT_ID.test(value);

export class InvalidAccessTokenError extends Error {
  constructor(message = "Invalid access token") {
    super(message);
    this.name = "InvalidAccessTokenError";
  }
}

/**
 * Check a decoded payload's `userId` and return `{ userId }` only. Throws
 * InvalidAccessTokenError when it is missing or not an ObjectId string.
 * Exported for auth-service's own verify functions (refresh tokens).
 */
export const requireTokenUserId = (payload: unknown): { userId: string } => {
  const userId = (payload as { userId?: unknown } | null)?.userId;
  if (!isTokenUserId(userId)) {
    throw new InvalidAccessTokenError("Token userId is missing or malformed");
  }
  return { userId };
};

/** Verify an access token signed with `secret`; returns `{ userId }` or throws. */
export const verifyAccessToken = (token: string, secret: string): { userId: string } =>
  requireTokenUserId(jwt.verify(token, secret, { algorithms: ["HS256"] }));
