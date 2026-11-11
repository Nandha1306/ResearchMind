import { Router } from "express";

import { updateEmbeddingStatus } from "../controllers/document.controller";
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

export default router;
