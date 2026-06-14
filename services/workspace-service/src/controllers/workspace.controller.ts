import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { createWorkspace, getUserWorkspaces, joinWorkspace } from "../services/workspace.service";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";

export const create = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspace = await createWorkspace(
      req.user!.userId,
      req.body
    );

    res.status(201).json({
      success: true,
      data: workspace,
    });
  }
);

export const getAll = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspaces = await getUserWorkspaces(
      req.user!.userId
    );

    res.status(200).json({
      success: true,
      data: workspaces,
    });
  }
);

export const join = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { inviteCode } = req.body;

    const workspace = await joinWorkspace(
      req.user!.userId,
      inviteCode
    );

    res.status(200).json({
      success: true,
      data: workspace,
    });
  }
);