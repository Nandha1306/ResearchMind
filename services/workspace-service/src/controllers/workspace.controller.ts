import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { createWorkspace, getUserWorkspaces, joinWorkspace, getWorkspaceAccess, getWorkspaceById, getWorkspaceMembers, removeWorkspaceMember, readmitRemovedMember } from "../services/workspace.service";
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

/**
 * Check whether the authenticated user belongs to a workspace, and whether
 * they own it (other services use `isOwner` for owner-only actions, SEC-010).
 */
export const checkMembership = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspaceId = req.params.workspaceId as string;

    const { isMember, isOwner } = await getWorkspaceAccess(
      workspaceId,
      req.user!.userId
    );

    res.status(200).json({
      success: true,
      data: {
        isMember,
        isOwner,
      },
    });
  }
);

/** Lift a member's removal so they may join again (owner only; SEC-010). */
export const readmitMember = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const outcome = await readmitRemovedMember(
      req.params.workspaceId as string,
      req.user!.userId,
      req.params.userId as string
    );

    res.status(200).json({
      success: true,
      message: "The user may join again with the current invite code",
      data: outcome,
    });
  }
);

/** Remove a member from a workspace (owner only; SEC-010). */
export const removeMember = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const outcome = await removeWorkspaceMember(
      req.params.workspaceId as string,
      req.user!.userId,
      req.params.userId as string
    );

    res.status(200).json({
      success: true,
      message: "Member removed",
      data: outcome,
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