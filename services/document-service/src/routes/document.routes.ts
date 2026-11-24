import { Router } from "express";
import { getDocuments, getDocument, deleteDocumentHandler, reindexDocumentHandler } from "../controllers/document.controller";
import { upload } from "../middlewares/upload.middleware";
import { uploadDocument } from "../controllers/upload.controller";
import { streamDocumentFile } from "../controllers/document-file.controller";
import { authenticate } from "../../../../packages/shared/auth/authenticate";

const router = Router();

/*
 * ARC-001: the metadata-only `POST /api/documents` was removed. No client
 * used it; it created records with no file and no text that the recovery
 * sweep kept re-queuing. Documents are created only by POST /upload.
 */

/** Get workspace documents. */
router.get(
  "/workspace/:workspaceId",
  authenticate,
  getDocuments
);

/** Get single document. */
router.get(
  "/:id",
  authenticate,
  getDocument
);

/**
 * Stream the document's file (members only; SEC-005). The only way a client
 * gets a document's bytes: no storage URL is ever returned.
 */
router.get(
  "/:id/file",
  authenticate,
  streamDocumentFile
);

/** Delete document. */
router.delete(
  "/:id",
  authenticate,
  deleteDocumentHandler
);

/** Re-index document. */
router.post(
  "/:id/reindex",
  authenticate,
  reindexDocumentHandler
);

/** Upload a PDF or DOCX document. */
router.post(
  "/upload",
  authenticate,
  upload.single("file"),
  uploadDocument
);

/*
 * NOTE: PATCH /:id/embedding-status used to live here with no authentication at
 * all, so any caller -- and any authenticated user from any workspace via the
 * gateway -- could rewrite another workspace's document status. Embedding
 * status is written by the ai-service worker, which has no user JWT, so it now
 * lives on the shared-secret internal router instead of being JWT-gated here.
 * See routes/internal.routes.ts.
 */

export default router;