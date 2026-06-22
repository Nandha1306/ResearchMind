import { Router } from "express";
import {
  getDocuments,
  getDocument,
  createDocumentHandler,
} from "../controllers/document.controller";
import { validate } from "../../../../packages/validation/validation";
import { createDocumentSchema } from "../../../../packages/validation/schemas/document.schema";

const router = Router();

/** Create workspace document metadata. */
router.post(
  "/",
  validate(createDocumentSchema),
  createDocumentHandler
);

/** Get workspace documents. */
router.get(
  "/workspace/:workspaceId",
  getDocuments
);

/** Get single document. */
router.get(
  "/:id",
  getDocument
);

export default router;