import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { AppError } from "../errors/AppError";

export const INTERNAL_TOKEN_HEADER = "x-internal-token";

const secretsMatch = (provided: string, expected: string): boolean => {
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
};

export const requireInternalServiceToken = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

  if (!expectedToken) {
    console.error(
      "[shared-auth] INTERNAL_SERVICE_TOKEN is not configured; rejecting internal request"
    );
    return next(new AppError("Unauthorized", 401));
  }

  const providedToken = req.headers[INTERNAL_TOKEN_HEADER];

  if (typeof providedToken !== "string" || providedToken.length === 0) {
    return next(new AppError("Unauthorized", 401));
  }

  if (!secretsMatch(providedToken, expectedToken)) {
    return next(new AppError("Unauthorized", 401));
  }

  next();
};

export default requireInternalServiceToken;
