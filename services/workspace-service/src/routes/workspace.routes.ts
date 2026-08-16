import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { create, getAll, join, checkMembership} from "../controllers/workspace.controller";

import { validate } from "../../../../packages/validation/validation";
import { createWorkspaceSchema , joinWorkspaceSchema } from "../../../../packages/validation/schemas/workspace.schema";

const router = Router();

/** Create a workspace. */
router.post(
  "/",
  authenticate,
  validate(createWorkspaceSchema),
  create
);

/** Get all workspaces for current user. */
router.get("/", authenticate, getAll);

/**** Join a workspace using invite code. */
router.post(
  "/join",
  authenticate,
  validate(joinWorkspaceSchema),
  join
);

/** Check whether the authenticated user belongs to a workspace. */
router.get(
  "/:workspaceId/membership",
  authenticate,
  checkMembership
);

export default router;