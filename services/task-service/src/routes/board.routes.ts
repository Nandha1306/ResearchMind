import { Router } from "express";

import { authenticate } from "../../../../packages/shared/auth/authenticate";

import {
  createBoardHandler,
  getWorkspaceBoardsHandler,
  getBoardHandler,
  updateBoardHandler,
  deleteBoardHandler,
} from "../controllers/board.controller";

import { requireWorkspaceMembership, requireWorkspaceOwner } from "../middlewares/workspace.middleware";

const router = Router();

router.post(
  "/workspaces/:workspaceId/boards",
  authenticate,
  requireWorkspaceMembership,
  createBoardHandler
);

router.get(
  "/workspaces/:workspaceId/boards",
  authenticate,
  requireWorkspaceMembership,
  getWorkspaceBoardsHandler
);

router.get(
  "/workspaces/:workspaceId/boards/:id",
  authenticate,
  requireWorkspaceMembership,
  getBoardHandler
);

router.patch(
  "/workspaces/:workspaceId/boards/:id",
  authenticate,
  requireWorkspaceMembership,
  updateBoardHandler
);

/** Delete a board (workspace owner only; SEC-010). */
router.delete(
  "/workspaces/:workspaceId/boards/:id",
  authenticate,
  requireWorkspaceOwner("Only the workspace owner can delete boards."),
  deleteBoardHandler
);

export default router;