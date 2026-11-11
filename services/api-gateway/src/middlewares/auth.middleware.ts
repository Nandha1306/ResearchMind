import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireSecret } from "../../../../packages/shared/config/secrets";

/* Resolved at module load: the gateway must not verify tokens with a default. */
const ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET");

interface JwtPayload {
  userId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
  };
}

/** Verify access token before forwarding protected requests. */
export const authenticate = (
  req: AuthenticatedRequest,
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
    const secret = ACCESS_SECRET;

    const decoded = jwt.verify(
      token,
      secret,
      // Pinned: reject any token claiming a different algorithm.
      { algorithms: ["HS256"] }
    ) as JwtPayload;

    /*
     * Attach the caller so downstream gateway middleware can key on them.
     *
     * The payload was previously verified and then thrown away, which meant
     * `req.user` never existed at the gateway and the per-user rate limiters
     * silently degraded to per-IP -- everyone behind one NAT shared a single
     * AI budget. This does not weaken anything: each service still verifies
     * the token independently and derives its own identity from it.
     */
    req.user = { userId: decoded.userId };

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};