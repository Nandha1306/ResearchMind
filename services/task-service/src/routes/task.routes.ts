import { Router } from "express";

import { authenticate } from "../../../auth-service/src/middlewares/auth.middleware";
import { validate } from "../../../../packages/validation/validation";
import {
  createTaskSchema,
  updateTaskSchema,
  bulkCreateTasksSchema,
} from "../../../../packages/validation/schemas/task.schema";

import {
  createTaskHandler,
  bulkCreateTasksHandler,
  getWorkspaceTasksHandler,
  getTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
  getTaskActivitiesHandler,
} from "../controllers/task.controller";

import { requireWorkspaceMembership } from "../middlewares/workspace.middleware";

const router = Router();

router.post(
  "/workspaces/:workspaceId/tasks",
  authenticate,
  requireWorkspaceMembership,
  validate(createTaskSchema),
  createTaskHandler
);

router.post(
  "/workspaces/:workspaceId/tasks/bulk",
  authenticate,
  requireWorkspaceMembership,
  validate(bulkCreateTasksSchema),
  bulkCreateTasksHandler
);

router.get(
  "/workspaces/:workspaceId/tasks",
  authenticate,
  requireWorkspaceMembership,
  getWorkspaceTasksHandler
);

router.get(
  "/workspaces/:workspaceId/tasks/:id",
  authenticate,
  requireWorkspaceMembership,
  getTaskHandler
);

router.get(
  "/workspaces/:workspaceId/tasks/:id/activities",
  authenticate,
  requireWorkspaceMembership,
  getTaskActivitiesHandler
);

router.patch(
  "/workspaces/:workspaceId/tasks/:id",
  authenticate,
  requireWorkspaceMembership,
  validate(updateTaskSchema),
  updateTaskHandler
);

router.delete(
  "/workspaces/:workspaceId/tasks/:id",
  authenticate,
  requireWorkspaceMembership,
  deleteTaskHandler
);

export default router;