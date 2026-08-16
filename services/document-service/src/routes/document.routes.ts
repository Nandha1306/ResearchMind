import { Router } from "express";
import {
  getDocuments,
  getDocument,
  createDocumentHandler,
} from "../controllers/document.controller";
import { validate } from "../../../../packages/validation/validation";
import { createDocumentSchema } from "../../../../packages/validation/schemas/document.schema";
import { upload } from "../middlewares/upload.middleware";
import { uploadDocument } from "../controllers/upload.controller";
import { authenticate } from "../../../auth-service/src/middlewares/auth.middleware";

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

/** Upload a PDF or DOCX document. */
router.post(
  "/upload",
  authenticate,
  upload.single("file"),
  uploadDocument
);

export default router;