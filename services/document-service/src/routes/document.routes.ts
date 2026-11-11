import { Router } from "express";
import { getDocuments, getDocument, createDocumentHandler, deleteDocumentHandler, reindexDocumentHandler } from "../controllers/document.controller";
import { validate } from "../../../../packages/validation/validation";
import { createDocumentSchema } from "../../../../packages/validation/schemas/document.schema";
import { upload } from "../middlewares/upload.middleware";
import { uploadDocument } from "../controllers/upload.controller";
import { authenticate } from "../../../../packages/shared/auth/authenticate";

const router = Router();

/** Create workspace document metadata. */
router.post(
  "/",
  authenticate,
  validate(createDocumentSchema),
  createDocumentHandler
);

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