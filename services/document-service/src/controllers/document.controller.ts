import { Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { getWorkspaceDocuments, getDocumentById, deleteDocument, reindexDocument, claimDocumentForEmbedding } from "../services/document.service";
import { checkWorkspaceMembership, assertWorkspaceOwner } from "../utils/workspace-checker";
import { Document } from "../models/Document";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { toClientDocument, toClientDocuments } from "../utils/document-serializer";
import { parseListPage } from "../../../../packages/shared/http/list-page";
import { DOCUMENT_LIST_MAX } from "../services/document.service";

/** Return all documents for a workspace. */
export const getDocuments = asyncHandler(
  async (req: any, res: Response) => {
    const { workspaceId } = req.params;
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const isMember = await checkWorkspaceMembership(
      workspaceId,
      userId,
      req.headers.authorization
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    const page = parseListPage(req.query, { defaultLimit: DOCUMENT_LIST_MAX, maxLimit: DOCUMENT_LIST_MAX });
    const { data, meta } = await getWorkspaceDocuments(workspaceId, page);

    res.status(200).json({
      success: true,
      data: toClientDocuments(data as any),
      meta,
    });
  }
);

/** Return a single document. */
export const getDocument = asyncHandler(
  async (req: any, res: Response) => {
    /*
     * Authenticate BEFORE the lookup.
     *
     * This was previously `if (userId) { ...membership check... }`, so a
     * request that reached the handler without `req.user` skipped the check
     * entirely and got the document back. The route does carry `authenticate`,
     * which made it unreachable in practice -- but an authorization check must
     * not depend on another layer having run. Fail closed instead, and do it
     * before the fetch so an unauthenticated caller cannot use the 404/200
     * difference to probe which document ids exist.
     */
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const document =
      await getDocumentById(
        req.params.id
      );

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const isMember = await checkWorkspaceMembership(
      document.workspaceId,
      userId,
      req.headers.authorization
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    res.status(200).json({
      success: true,
      data: toClientDocument(document as any),
    });
  }
);

/** Maximum length of a worker-reported failure reason stored on a document. */
const MAX_EMBEDDING_ERROR_LENGTH = 500;

/**
 * Update the embedding processing status for a document (ai-service worker).
 *
 * A document that is being deleted (or is gone) is never updated: the worker
 * gets 410/404 and removes any vectors it wrote, so deleted content cannot be
 * resurrected by in-flight embedding work.
 */
export const updateEmbeddingStatus = async (
  req: any,
  res: Response
) => {
  const { id } = req.params;
  const { status, error, claimToken } = req.body ?? {};

  const allowedStatuses = [
    "pending",
    "indexing",
    "indexed",
    "failed",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new AppError(
      "Invalid embedding status",
      400
    );
  }

  const update: Record<string, unknown> = { embeddingStatus: status };
  if (status === "indexed") {
    update.embeddingError = null;
  }
  if (status === "failed") {
    update.embeddingError =
      typeof error === "string" && error.trim()
        ? error.trim().slice(0, MAX_EMBEDDING_ERROR_LENGTH)
        : "Indexing failed";
  }
  if (status === "indexing") {
    update.indexingStartedAt = new Date();
  }

  /*
   * Claim fencing: a worker reports the token of the claim it holds. The
   * update only applies while that claim is still the current one, so a stale
   * worker (whose claim expired and was taken over, possibly across a manual
   * re-index) cannot overwrite the newer holder's result. Callers that send
   * no token keep the previous unconditional behaviour.
   */
  const fenced = Number.isInteger(claimToken);
  const filter: Record<string, unknown> = { _id: id, deletedAt: null };
  if (fenced) {
    filter.embeddingStatus = "indexing";
    filter.claimSequence = claimToken;
  }

  const document =
    await Document.findOneAndUpdate(
      filter,
      { $set: update },
      {
        returnDocument: "after",
      }
    );

  if (!document) {
    const current = await Document.findById(id).select("deletedAt");
    if (!current) {
      throw new AppError("Document not found", 404);
    }
    if (current.deletedAt) {
      throw new AppError("Document has been deleted", 410);
    }
    throw new AppError("Embedding claim is no longer current", 409);
  }

  return res.status(200).json({
    success: true,
    data: {
      documentId: document._id,
      embeddingStatus:
        document.embeddingStatus,
    },
  });
};

/**
 * Atomically claim a document for embedding (ai-service worker), before any
 * processing. 200 = claimed; 409 = already indexed / in progress / retry limit
 * reached; 410 = deleted; 404 = unknown. Only a 200 may be processed.
 */
export const claimEmbeddingHandler = async (
  req: any,
  res: Response
) => {
  const result = await claimDocumentForEmbedding(req.params.id);

  if (result.claimed) {
    return res.status(200).json({
      success: true,
      data: {
        documentId: result.document._id,
        workspaceId: result.document.workspaceId,
        embeddingAttempts: result.document.embeddingAttempts,
        // Fencing token: send back as `claimToken` on status updates.
        claimToken: result.document.claimSequence,
      },
    });
  }

  const statusCode =
    result.reason === "not-found" ? 404 : result.reason === "deleted" ? 410 : 409;

  return res.status(statusCode).json({
    success: false,
    message: `Document not claimable: ${result.reason}`,
    reason: result.reason,
  });
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * GET /internal/documents/:id/embedding-source?workspaceId=&claimToken=
 * (ai-service worker; shared-secret internal route, never proxied by the
 * gateway). Returns the text to embed for the CURRENT claim only (SEC-006):
 * queue entries are pointers, and the worker takes the text -- and the
 * uploader/file type written into vector metadata -- from here, never from
 * Redis.
 *
 *   400 malformed parameters
 *   404 unknown document           410 deleted
 *   403 the document belongs to another workspace than the job names
 *   409 the claim is not (or no longer) current (fencing)
 */
export const getEmbeddingSourceHandler = async (req: any, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const { id } = req.params;
  const workspaceId = req.query?.workspaceId;
  const claimToken = Number(req.query?.claimToken);

  if (!OBJECT_ID.test(String(id)) || typeof workspaceId !== "string" || !OBJECT_ID.test(workspaceId) || !Number.isInteger(claimToken)) {
    throw new AppError("Invalid embedding source request", 400);
  }

  const document = await Document.findById(id).select(
    "workspaceId uploadedBy fileType extractedText deletedAt embeddingStatus claimSequence"
  );
  const refuse = (status: number, reason: string) =>
    res.status(status).json({ success: false, message: `Embedding source unavailable: ${reason}`, reason });

  if (!document) return refuse(404, "not-found");
  if (document.deletedAt) return refuse(410, "deleted");
  if (document.workspaceId !== workspaceId) return refuse(403, "workspace-mismatch");
  if (document.embeddingStatus !== "indexing" || document.claimSequence !== claimToken) {
    return refuse(409, "claim-not-current");
  }

  return res.status(200).json({
    success: true,
    data: {
      documentId: document._id,
      workspaceId: document.workspaceId,
      uploadedBy: document.uploadedBy,
      fileType: document.fileType,
      extractedText: document.extractedText ?? "",
    },
  });
};

/** Most document ids accepted in one live-documents check (topK is at most 20). */
const MAX_LIVE_CHECK_IDS = 200;

/**
 * POST /internal/documents/live { workspaceId, documentIds } (ai-service).
 * Which of these documents still exist, are not (being) deleted, and belong
 * to `workspaceId` -- one batched query. ai-service drops every retrieval
 * match that is not in the answer, so text of a deleted document (for
 * example a vector written late by a timed-out upsert) is never returned or
 * cited (SEC-012 retrieval side).
 */
export const liveDocumentsHandler = async (req: any, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const workspaceId = req.body?.workspaceId;
  const documentIds = req.body?.documentIds;
  if (
    typeof workspaceId !== "string" ||
    !OBJECT_ID.test(workspaceId) ||
    !Array.isArray(documentIds) ||
    documentIds.length > MAX_LIVE_CHECK_IDS ||
    !documentIds.every((id: unknown) => typeof id === "string")
  ) {
    throw new AppError("Invalid live-documents request", 400);
  }
  // Ids that are not ObjectIds cannot be documents: they are simply not live.
  const candidates = [...new Set(documentIds as string[])].filter((id) => OBJECT_ID.test(id));
  const live = candidates.length
    ? await Document.find({ _id: { $in: candidates }, workspaceId, deletedAt: null }).select("_id originalName").lean()
    : [];
  return res.status(200).json({
    success: true,
    data: {
      // Unchanged field: older ai-service versions read only this one.
      liveDocumentIds: live.map((doc: any) => String(doc._id)),
      // Additive (ISS-029): titles, so answers can name their sources.
      liveDocuments: live.map((doc: any) => ({ id: String(doc._id), name: String(doc.originalName ?? "") })),
    },
  });
};

/** Delete a document and clean up associated resources. */
export const deleteDocumentHandler = asyncHandler(
  async (req: any, res: Response) => {
    const userId = req.user?.userId || req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const document = await getDocumentById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    // Owner only (SEC-010): a member who is not the owner gets 403.
    await assertWorkspaceOwner(
      document.workspaceId,
      req.headers.authorization,
      "Only the workspace owner can delete documents."
    );

    const deleted = await deleteDocument(id, document.workspaceId);

    // A concurrent request already claimed this deletion (or it vanished
    // between the lookup and the atomic mark).
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      data: toClientDocument(deleted as any),
    });
  }
);

/** Re-index a document by re-enqueuing its embedding job. */
export const reindexDocumentHandler = asyncHandler(
  async (req: any, res: Response) => {
    const userId = req.user?.userId || req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const document = await getDocumentById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const isMember = await checkWorkspaceMembership(
      document.workspaceId,
      userId,
      req.headers.authorization
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    const updated = await reindexDocument(id, document.workspaceId);

    // Deleted between the lookup and the update.
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Re-indexing initiated successfully",
      data: toClientDocument(updated as any),
    });
  }
);