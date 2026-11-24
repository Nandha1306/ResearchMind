import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
import { requireSecret } from "../config/secrets";
import { verifyAccessToken } from "./access-token";

const ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET");

export interface AuthRequest extends Request {
  user?: {
    userId: string;
  };
}

/**
 * Verify the access token and attach the user to the request. Verification
 * (HS256, 24-hex userId) is the shared verifyAccessToken (SEC-019, ISS-047).
 */
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

  try {
    req.user = verifyAccessToken(token, ACCESS_SECRET);
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
