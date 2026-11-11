import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

import { AppError } from "../../../../packages/shared/errors/AppError";

export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so `timingSafeEqual` always receives equal-length
 * buffers -- it throws on a length mismatch, and that throw would itself be a
 * length oracle.
 */
const secretsMatch = (
  provided: string,
  expected: string
): boolean => {
  const providedHash = crypto
    .createHash("sha256")
    .update(provided)
    .digest();

  const expectedHash = crypto
    .createHash("sha256")
    .update(expected)
    .digest();

  return crypto.timingSafeEqual(
    providedHash,
    expectedHash
  );
};

/**
 * Gate for service-to-service routes under /internal.
 *
 * These endpoints are called by background workers that have no end user and
 * therefore no JWT, so they authenticate with a shared secret instead. A user's
 * access token is deliberately NOT accepted here: holding one must never be
 * enough to reach an internal mutation.
 *
 * Every rejection returns the same opaque 401. The expected token is never
 * logged, echoed, or otherwise described in the response.
 */
export const requireInternalServiceToken = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const expectedToken =
    process.env.INTERNAL_SERVICE_TOKEN;

  /*
   * Fail closed. A missing secret means the endpoint cannot be authenticated,
   * so it must reject rather than fall open. This is checked per request rather
   * than at boot so that a service which never handles internal traffic is not
   * prevented from starting.
   */
  if (!expectedToken) {
    console.error(
      "[document-service] INTERNAL_SERVICE_TOKEN is not configured; rejecting all internal requests"
    );

    return next(
      new AppError(
        "Unauthorized",
        401
      )
    );
  }

  const providedToken =
    req.headers[INTERNAL_TOKEN_HEADER];

  if (
    typeof providedToken !== "string" ||
    providedToken.length === 0
  ) {
    return next(
      new AppError(
        "Unauthorized",
        401
      )
    );
  }

  if (
    !secretsMatch(
      providedToken,
      expectedToken
    )
  ) {
    return next(
      new AppError(
        "Unauthorized",
        401
      )
    );
  }

  next();
};

export default requireInternalServiceToken;
