import { Router } from "express";

import { authenticate } from "../../../auth-service/src/middlewares/auth.middleware";

import {
  createBoardHandler,
  getWorkspaceBoardsHandler,
  getBoardHandler,
  updateBoardHandler,
  deleteBoardHandler,
} from "../controllers/board.controller";

import { requireWorkspaceMembership } from "../middlewares/workspace.middleware";

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

router.delete(
  "/workspaces/:workspaceId/boards/:id",
  authenticate,
  requireWorkspaceMembership,
  deleteBoardHandler
);

export default router;