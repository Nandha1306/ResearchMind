import { Router } from "express";
import { authenticate } from "../../../auth-service/src/middlewares/auth.middleware";
import { validate } from "../../../../packages/validation/validation";
import {
  semanticSearchSchema,
  ragQuerySchema,
} from "../../../../packages/validation/schemas/ai.schema";
import {
  searchHandler,
  queryStreamHandler,
  getSessionsHandler,
} from "../controllers/query.controller";

import { summarizeMeeting } from "../controllers/meeting.controller";
import { summarizeMeetingSchema } from "../../../../packages/validation/schemas/ai.schema";
import { requireWorkspaceMembership } from "../middlewares/workspace.middleware";

const router = Router();

/** POST /api/ai/search - Pure vector retrieval debugging endpoint */
router.post(
  "/search",
  authenticate,
  validate(semanticSearchSchema),
  searchHandler
);

/** POST /api/ai/query - Full SSE streaming RAG generation & citation endpoint */
router.post(
  "/query",
  authenticate,
  validate(ragQuerySchema),
  queryStreamHandler
);

/** GET /api/ai/sessions/workspace/:workspaceId - Recent Q&A sessions for workspace */
router.get(
  "/sessions/workspace/:workspaceId",
  authenticate,
  getSessionsHandler
);

router.post(
  "/summarize-meeting",
  authenticate,
  requireWorkspaceMembership,
  validate(summarizeMeetingSchema),
  summarizeMeeting
);

export default router;
