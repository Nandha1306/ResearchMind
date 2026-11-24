import { NextFunction, Request, Response } from "express";
import { requireSecret } from "../../../../packages/shared/config/secrets";
import { verifyAccessToken } from "../../../../packages/shared/auth/access-token";

/*
 * Previously `process.env.JWT_ACCESS_SECRET!` -- the non-null assertion is a
 * compile-time lie, and an unset value made jwt.verify throw inside the catch,
 * turning a misconfiguration into an indistinguishable 401. Validate at load.
 */
const ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET");

export interface AuthRequest extends Request {
  user?: { userId: string };
}

/**
 * Verify access token and attach `{ userId }` to the request. The shared
 * verifier pins HS256 and requires a 24-hex userId (SEC-019): the whole
 * decoded payload used to be copied here, and an object userId acted as a
 * Mongo operator on `members`.
 */
export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const token = authHeader.split(" ")[1];

    req.user = verifyAccessToken(token, ACCESS_SECRET);

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};
