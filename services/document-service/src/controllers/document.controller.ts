import { Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { getWorkspaceDocuments, getDocumentById, createDocument, deleteDocument, reindexDocument, claimDocumentForEmbedding } from "../services/document.service";
import { checkWorkspaceMembership } from "../utils/workspace-checker";
import { Document } from "../models/Document";
import { AppError } from "../../../../packages/shared/errors/AppError";

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

    const documents =
      await getWorkspaceDocuments(
        workspaceId
      );

    res.status(200).json({
      success: true,
      data: documents,
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
      data: document,
    });
  }
);

/** Create document metadata and store in MongoDB. */
export const createDocumentHandler = asyncHandler(
  async (req: any, res: Response) => {
    const userId = req.user?.userId || req.user?.id;
    const { workspaceId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    /*
     * Same rule as getDocument: the membership check must not sit behind a
     * truthiness test. `createDocumentSchema` already requires workspaceId, so
     * the old `if (workspaceId)` branch was unreachable -- but an authorization
     * check that silently no-ops when a field is absent is one schema edit away
     * from being a hole. Reject explicitly instead.
     */
    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID is required",
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

    // Built field by field: storage location, extracted text and status are
    // server-owned and never copied from the request body.
    const { originalName, fileType, fileSize } = req.body;
    const document = await createDocument({
      workspaceId,
      originalName,
      fileType,
      fileSize,
      uploadedBy: userId,
      cloudinaryUrl: null,
      cloudinaryPublicId: null,
      extractedText: "",
    });
    res.status(201).json({
      success: true,
      data: document,
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
      data: deleted,
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
      data: updated,
    });
  }
);