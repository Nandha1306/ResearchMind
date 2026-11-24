import { Request, Response, NextFunction } from "express";
import { checkWorkspaceMembership, assertWorkspaceOwner } from "../utils/workspace-checker";

/**
 * Owner-only actions (SEC-010): the workspace owner may delete boards and
 * tasks; other members get 403 with `message`, non-members 403 as before.
 * The check is live (workspace-service) on every request.
 */
export const requireWorkspaceOwner = (message: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      if (!(user?.userId || user?.id)) {
        return res.status(401).json({ success: false, message: "Authenticated user not found" });
      }
      const workspaceId = req.params.workspaceId;
      if (!workspaceId) {
        return res.status(400).json({ success: false, message: "Workspace ID is required" });
      }
      await assertWorkspaceOwner(workspaceId as string, req.headers.authorization, message);
      next();
    } catch (error) {
      next(error);
    }
  };

export const requireWorkspaceMembership = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = (req as any).user;

    const userId = user?.userId || user?.id;

    const workspaceId =
      req.params.workspaceId ||
      // Express 5 leaves req.body undefined when no body/parser matched.
      req.body?.workspaceId;

    const authHeader = req.headers.authorization;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found",
      });
    }

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID is required",
      });
    }

    const isMember =
      await checkWorkspaceMembership(
        workspaceId,
        userId,
        authHeader
      );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message:
          "You are not a member of this workspace",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};