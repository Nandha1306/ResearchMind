import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireSecret } from "../../../../packages/shared/config/secrets";

/*
 * Previously `process.env.JWT_ACCESS_SECRET!` -- the non-null assertion is a
 * compile-time lie, and an unset value made jwt.verify throw inside the catch,
 * turning a misconfiguration into an indistinguishable 401. Validate at load.
 */
const ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET");

interface JwtPayload {
  userId: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/** Verify access token and attach user info to the request. */
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

    const decoded = jwt.verify(
      token,
      ACCESS_SECRET,
      // Pinned: reject any token claiming a different algorithm.
      { algorithms: ["HS256"] }
    ) as JwtPayload;

    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};