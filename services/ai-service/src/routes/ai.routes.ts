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
} from "../controllers/query.controller";

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

export default router;
