import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Request IDs (ISS-044). Every request gets an `X-Request-ID`: a valid
 * incoming one (1-128 of `A-Z a-z 0-9 . _ : -`) is kept, anything else is
 * replaced by a random UUID. The id is forwarded to the upstream service
 * (the proxy passes request headers through), echoed in the response, and
 * written in the access logs (morgan `:req[x-request-id]`).
 */
export const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const assignRequestId = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  req.headers[REQUEST_ID_HEADER] = id;
  res.setHeader("X-Request-ID", id);
  next();
};
