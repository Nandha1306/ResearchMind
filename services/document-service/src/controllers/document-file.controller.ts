import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { getDocumentById } from "../services/document.service";
import { checkWorkspaceMembership } from "../utils/workspace-checker";
import { resolveStorageUrl, storageHttp, StorageUnavailableError } from "../services/file-storage";

/**
 * GET /api/documents/:id/file -- deliver a document's file (SEC-005).
 *
 * The only way a client gets a document's bytes. Authentication, a LIVE
 * workspace membership check (a removed member loses access on the next
 * request) and "not deleted" come first; then document-service fetches the
 * file from storage itself and streams it. No storage URL ever leaves the
 * server.
 *
 * Bounded: the upstream request has a time limit, refuses redirects, is
 * cancelled when the client goes away, and is cut off past MAX_FILE_BYTES.
 * Storage failures map to 502 (bad answer) / 503 (unreachable or timed out)
 * with a generic message: the URL is never echoed.
 */

/** Whole-transfer limit for one download (uploads are capped at 10 MB). */
export const STORAGE_DOWNLOAD_TIMEOUT_MS = 60_000;
/** Refuse anything larger than this (uploads are at most 10 MB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const STORAGE_UNAVAILABLE = "File storage is temporarily unavailable. Please try again later.";
const STORAGE_BAD_ANSWER = "The stored file could not be retrieved.";

/**
 * A Content-Disposition value with a safe ASCII fallback name (quotes,
 * control characters, path separators and other specials replaced) and the
 * exact UTF-8 name in filename*.
 */
export const contentDisposition = (type: "inline" | "attachment", originalName: string, extension: string) => {
  const base = String(originalName || "document")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^.*[\\/]/, "")
    .trim();
  const withExtension = base.toLowerCase().endsWith(`.${extension}`) ? base : `${base || "document"}.${extension}`;
  const ascii = withExtension.replace(/[^A-Za-z0-9._ -]/g, "_").slice(-150) || `document.${extension}`;
  const encoded = encodeURIComponent(withExtension).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

/** Pass bytes through, failing once more than `limit` bytes have passed. */
const byteLimit = (limit: number) => {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > limit) {
        callback(new Error("stored file exceeds the download size limit"));
        return;
      }
      callback(null, chunk);
    },
  });
};

export const streamDocumentFile = asyncHandler(async (req: any, res: Response) => {
  const userId = req.user?.userId || req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const document = await getDocumentById(req.params.id);
  if (!document) {
    return res.status(404).json({ success: false, message: "Document not found" });
  }

  const isMember = await checkWorkspaceMembership(document.workspaceId, userId, req.headers.authorization);
  if (!isMember) {
    return res.status(403).json({
      success: false,
      message: "Access denied. You are not a member of this workspace.",
    });
  }

  let url: string | null;
  try {
    url = resolveStorageUrl(document);
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      console.error(`[document-service] Document ${document._id}: ${error.message}; not fetched`);
      throw new AppError(STORAGE_BAD_ANSWER, 502);
    }
    throw error;
  }
  if (!url) {
    return res.status(404).json({ success: false, message: "This document has no stored file" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_DOWNLOAD_TIMEOUT_MS);
  // The client went away before the transfer finished: stop the upstream one.
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on("close", onClose);

  try {
    let upstream: globalThis.Response;
    try {
      upstream = await storageHttp.fetch(url, { redirect: "error", signal: controller.signal });
    } catch (error) {
      console.error(
        `[document-service] Storage download for document ${document._id} failed: ${(error as Error)?.name ?? "Error"}`
      );
      throw new AppError(STORAGE_UNAVAILABLE, 503);
    }

    const body = upstream.body;
    if (!upstream.ok || !body) {
      console.error(`[document-service] Storage answered ${upstream.status} for document ${document._id}`);
      await body?.cancel().catch(() => {});
      throw new AppError(STORAGE_BAD_ANSWER, 502);
    }

    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      await body.cancel().catch(() => {});
      throw new AppError(STORAGE_BAD_ANSWER, 502);
    }

    const extension = document.fileType === "pdf" ? "pdf" : "docx";
    res.status(200);
    res.setHeader("Content-Type", CONTENT_TYPES[extension]);
    res.setHeader(
      "Content-Disposition",
      contentDisposition(extension === "pdf" ? "inline" : "attachment", document.originalName, extension)
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    if (Number.isFinite(declared) && declared > 0) res.setHeader("Content-Length", String(declared));

    try {
      await pipeline(
        Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>),
        byteLimit(MAX_FILE_BYTES),
        res
      );
    } catch (error) {
      // Headers are sent: the response is cut off (the client sees an
      // incomplete download). A client abort lands here too.
      if (!controller.signal.aborted) {
        console.error(
          `[document-service] Streaming document ${document._id} was interrupted: ${(error as Error)?.message}`
        );
      }
      controller.abort();
    }
  } finally {
    clearTimeout(timer);
    res.off("close", onClose);
  }
});
