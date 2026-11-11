import { Router, Request, Response } from "express";
import { requireInternalServiceToken } from "../../../../packages/shared/auth/internal-auth.middleware";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { deleteDocumentEmbeddings } from "../services/vector-service";

/**
 * Service-to-service routes.
 *
 * Mounted at /internal, outside the /api/ai router that the API gateway
 * proxies, so nothing here is reachable through the public gateway. Callers
 * authenticate with the shared INTERNAL_SERVICE_TOKEN header.
 */
const router = Router();

router.use(requireInternalServiceToken);

/** Workspace and document ids are MongoDB ObjectIds. */
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * DELETE /internal/vectors/workspaces/:workspaceId/documents/:documentId
 *
 * Remove every vector of one document from its workspace namespace (called by
 * document-service when a document is deleted). Scoped twice: the namespace
 * is the workspace, and the metadata filter is the document id, so it cannot
 * touch another workspace's or another document's vectors. Idempotent.
 */
router.delete(
  "/vectors/workspaces/:workspaceId/documents/:documentId",
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = String(req.params.workspaceId);
    const documentId = String(req.params.documentId);

    if (!OBJECT_ID.test(workspaceId) || !OBJECT_ID.test(documentId)) {
      throw new AppError("Invalid workspace or document id", 400);
    }

    await deleteDocumentEmbeddings(workspaceId, documentId);

    res.status(200).json({
      success: true,
      data: { workspaceId, documentId, vectorsDeleted: true },
    });
  })
);

export default router;
