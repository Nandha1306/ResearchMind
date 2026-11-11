import { Request, Response, NextFunction } from "express";
import { AppError } from "./AppError";

/**
 * Mongo driver errors that mean "the database is unreachable", as opposed to
 * a problem with the request. These are reported as 503 so clients (and the
 * gateway) can tell an outage from a bug.
 */
const MONGO_UNAVAILABLE_ERROR_NAMES = new Set([
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoNotConnectedError",
  "MongoTopologyClosedError",
  "MongoPoolClearedError",
  "MongoServerClosedError",
]);

const isMongoUnavailable = (err: any): boolean =>
  MONGO_UNAVAILABLE_ERROR_NAMES.has(err?.name) ||
  // Mongoose command buffering gave up because no connection was available.
  (typeof err?.message === "string" && /buffering timed out/i.test(err.message));

const sendError = (res: Response, statusCode: number, message: string) =>
  res.status(statusCode).json({
    success: false,
    message,
  });

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // A streaming response (e.g. SSE) has already started; it cannot be turned
  // into a JSON error. Let Express close the connection.
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      console.error(err);
    }
    return sendError(res, err.statusCode, err.message);
  }

  // Centralized handling for Mongoose CastError (e.g. invalid ObjectId)
  if (err?.name === "CastError" || err?.kind === "ObjectId") {
    return sendError(res, 400, "Invalid resource ID");
  }

  // Centralized handling for Mongoose ValidationError
  if (err?.name === "ValidationError") {
    return sendError(res, 400, err.message || "Validation Error");
  }

  // body-parser (express.json) errors carry their own client status.
  if (err?.type === "entity.parse.failed") {
    return sendError(res, 400, "Malformed JSON in request body");
  }
  if (err?.type === "entity.too.large") {
    return sendError(res, 413, "Request body is too large");
  }
  if (
    typeof err?.type === "string" &&
    err.expose === true &&
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status < 500
  ) {
    return sendError(res, err.status, err.message || "Bad request");
  }

  // Multer upload errors (size/field limits) are client errors.
  if (err?.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "File is too large");
    }
    return sendError(res, 400, err.message || "Invalid file upload");
  }

  // Unique-index violation. The key/value is deliberately not echoed back.
  if (err?.code === 11000) {
    return sendError(res, 409, "A resource with the same unique value already exists");
  }

  if (isMongoUnavailable(err)) {
    console.error(`[${req.method} ${req.originalUrl}] Database unavailable:`, err?.message);
    return sendError(res, 503, "Service temporarily unavailable. Please try again later.");
  }

  console.error(err);

  return sendError(res, 500, "Internal Server Error");
};
