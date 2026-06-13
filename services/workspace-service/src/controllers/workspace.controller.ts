import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { createWorkspace, getUserWorkspaces, joinWorkspace  } from "../services/workspace.service";

/** Handle workspace creation requests. */
export const create = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const workspace = await createWorkspace(
      req.user!.userId,
      req.body
    );

    return res.status(201).json({
      success: true,
      data: workspace,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Workspace creation failed",
    });
  }
};

/** Return all workspaces for the authenticated user. */
export const getAll = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const workspaces = await getUserWorkspaces(
      req.user!.userId
    );

    return res.status(200).json({
      success: true,
      data: workspaces,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to fetch workspaces",
    });
  }
};

/** Join a workspace using an invite code. */
export const join = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { inviteCode } = req.body;

    const workspace = await joinWorkspace(
      req.user!.userId,
      inviteCode
    );

    return res.status(200).json({
      success: true,
      data: workspace,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to join workspace",
    });
  }
};