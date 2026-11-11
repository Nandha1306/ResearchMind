import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { createWorkspace, getUserWorkspaces, joinWorkspace, isWorkspaceMember, getWorkspaceById, getWorkspaceMembers } from "../services/workspace.service";
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

/** Check whether the authenticated user belongs to a workspace. */
export const checkMembership = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    const isMember = await isWorkspaceMember(
      workspaceId,
      req.user!.userId
    );

    res.status(200).json({
      success: true,
      data: {
        isMember,
      },
    });
  }
);

/** Get workspace details by workspaceId. */
export const getById = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    const workspace = await getWorkspaceById(
      workspaceId,
      req.user!.userId
    );

    res.status(200).json({
      success: true,
      data: workspace,
    });
  }
);

/** Get hydrated members list for workspace. */
export const getMembers = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    const members = await getWorkspaceMembers(
      workspaceId,
      req.user!.userId
    );

    res.status(200).json({
      success: true,
      data: members,
    });
  }
);