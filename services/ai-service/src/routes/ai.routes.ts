import { Router } from "express";
import { authenticate } from "../../../auth-service/src/middlewares/auth.middleware";
import { validate } from "../../../../packages/validation/validation";
import { semanticSearchSchema } from "../../../../packages/validation/schemas/ai.schema";
import { searchHandler } from "../controllers/query.controller";

const router = Router();

/** POST /api/ai/search - Perform semantic search over workspace documents */
router.post(
  "/search",
  authenticate,
  validate(semanticSearchSchema),
  searchHandler
);

export default router;
