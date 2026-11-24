import { Router } from "express";

import {
  updateEmbeddingStatus,
  claimEmbeddingHandler,
  getEmbeddingSourceHandler,
  liveDocumentsHandler,
} from "../controllers/document.controller";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { requireInternalServiceToken } from "../middlewares/internal-auth.middleware";

/**
 * Service-to-service routes.
 *
 * Mounted at /internal, deliberately OUTSIDE the /api/documents router that the
 * API gateway proxies, so nothing here is reachable through the public gateway
 * even with a valid user JWT.
 */
const router = Router();

/** Update a document's embedding status (called by the ai-service worker). */
router.patch(
  "/documents/:id/embedding-status",
  requireInternalServiceToken,
  updateEmbeddingStatus
);

/** Atomically claim a document before embedding it (called by the ai-service worker). */
router.post(
  "/documents/:id/embedding/claim",
  requireInternalServiceToken,
  claimEmbeddingHandler
);

/**
 * The text to embed, for the current claim holder only (SEC-006). Queue jobs
 * are pointers; the worker fetches the text here.
 */
router.get(
  "/documents/:id/embedding-source",
  requireInternalServiceToken,
  asyncHandler(getEmbeddingSourceHandler)
);

/**
 * Which of these documents are live in this workspace (ai-service drops
 * retrieval matches of deleted or foreign documents).
 */
router.post(
  "/documents/live",
  requireInternalServiceToken,
  asyncHandler(liveDocumentsHandler)
);

export default router;
