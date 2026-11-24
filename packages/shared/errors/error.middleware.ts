import { Request, Response, NextFunction } from "express";
import { AppError } from "./AppError";
import { describeErrorForLog, redactSecrets } from "./safe-error";

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

/**
 * ISS-041: unmatched routes get the documented JSON envelope instead of
 * Express's default HTML page. Mount it after every route (and, in the
 * services, just before errorMiddleware). The path is not echoed.
 */
export const notFoundHandler = (_req: Request, res: Response) => sendError(res, 404, "Route not found");

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

  // RT-007 / Wave 6 (W5-L3): every server-side log line below is a redacted,
  // bounded description, never the raw error object (which can carry a
  // wrapped provider error, a `cause`, request config or headers).
  const logPath = `${req.method} ${req.originalUrl.split("?")[0]}`;
  // Only real frames ("    at …"), at most 8, each at most 300 characters: the
  // lines after the first message line of a multi-line message are message
  // text, not frames (W6-R5-02), and must never bypass the redaction.
  const framesOf = (error: any): string =>
    typeof error?.stack === "string"
      ? error.stack
          .split("\n")
          .filter((line: string) => /^\s+at /.test(line))
          .slice(0, 8)
          // Stage E round 2 (W6-R5-10): a message line can look like a frame
          // ("    at … (redis://:pw@host)"), so every kept line is redacted too.
          .map((line: string) => redactSecrets(line).slice(0, 300))
          .join("\n")
      : "";

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      const frames = framesOf(err);
      console.error(`[${logPath}] ${describeErrorForLog(err)}${frames ? `\n${frames}` : ""}`);
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
    console.error(`[${logPath}] Database unavailable: ${describeErrorForLog(err)}`);
    return sendError(res, 503, "Service temporarily unavailable. Please try again later.");
  }

  // RT-007: an unexpected error can be a provider SDK error carrying key
  // identifiers, headers or URLs. Log a redacted description plus the stack
  // frames (without the message line), never the raw object.
  const frames = framesOf(err);
  console.error(`[${logPath}] Unhandled error: ${describeErrorForLog(err)}${frames ? `\n${frames}` : ""}`);

  return sendError(res, 500, "Internal Server Error");
};
