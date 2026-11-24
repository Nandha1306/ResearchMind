import { Router, Request, Response } from "express";
import { requireInternalServiceToken } from "../../../../packages/shared/auth/internal-auth.middleware";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { Task } from "../models/Task";

/**
 * Service-to-service routes, mounted at /internal -- outside /api/tasks, so
 * the gateway never routes here. Shared-secret authentication
 * (INTERNAL_SERVICE_TOKEN, compared in constant time; refused when unset).
 */
const router = Router();

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * A member was removed from a workspace (called by workspace-service after
 * the removal, SEC-010): unassign their tasks in that workspace, so no task
 * stays assigned to someone who can no longer see it. The tasks themselves
 * (and their activity history) are kept.
 */
router.post(
  "/workspaces/:workspaceId/members/:userId/unassign",
  requireInternalServiceToken,
  asyncHandler(async (req: Request, res: Response) => {
    const workspaceId = String(req.params.workspaceId);
    const userId = String(req.params.userId);
    if (!OBJECT_ID.test(workspaceId) || !userId || userId.length > 64) {
      throw new AppError("Invalid workspace or user id", 400);
    }
    const result = await Task.updateMany(
      { workspaceId, assigneeId: userId },
      { $set: { assigneeId: null } }
    );
    res.status(200).json({ success: true, data: { unassigned: result.modifiedCount ?? 0 } });
  })
);

export default router;
