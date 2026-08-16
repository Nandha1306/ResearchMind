import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../../../../packages/shared/errors/AppError";

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

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET!
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