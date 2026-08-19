import { Request, Response, NextFunction } from "express";
import { AppError } from "./AppError";

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // Centralized handling for Mongoose CastError (e.g. invalid ObjectId)
  if (err.name === "CastError" || err.kind === "ObjectId") {
    return res.status(400).json({
      success: false,
      message: "Invalid resource ID",
    });
  }

  // Centralized handling for Mongoose ValidationError
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: err.message || "Validation Error",
    });
  }

  console.error(err);

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
};