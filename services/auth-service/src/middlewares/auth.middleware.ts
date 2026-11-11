import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { requireSecret } from "../../../../packages/shared/config/secrets";

/*
 * Resolved once at module load so a service that imports this middleware
 * refuses to boot without a valid signing key, rather than accepting tokens
 * signed with a hardcoded default. This module is shared by ai-service,
 * document-service and task-service as well as auth-service.
 */
const ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET");

export interface AuthRequest extends Request {
  user?: {
    userId: string;
  };
}

/** Verify the access token and attach the user to the request. */
export const authenticate = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(
      new AppError(
        "Authentication required",
        401
      )
    );
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = ACCESS_SECRET;

  try {
    const decoded = jwt.verify(
      token,
      jwtSecret,
      // Pinned: without this, jsonwebtoken honours the token's own `alg` header.
      { algorithms: ["HS256"] }
    ) as {
      userId: string;
    };

    req.user = {
      userId: decoded.userId,
    };

    next();
  } catch {
    next(
      new AppError(
        "Invalid or expired access token",
        401
      )
    );
  }
};

export default authenticate;