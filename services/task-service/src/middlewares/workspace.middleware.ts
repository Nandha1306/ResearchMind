import { Request, Response, NextFunction } from "express";
import { checkWorkspaceMembership } from "../utils/workspace-checker";

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
      req.body.workspaceId;

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