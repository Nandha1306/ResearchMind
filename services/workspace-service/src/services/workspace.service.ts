import { Workspace } from "../models/Workspace";
import { CreateWorkspaceDto } from "../types/workspace.types";
import { generateInviteCode } from "../utils/invite-code";
import { AppError } from "../../../../packages/shared/errors/AppError";

/** Create a new workspace for the authenticated user. */
export const createWorkspace = async (
  ownerId: string,
  data: CreateWorkspaceDto
) => {
  const workspace = await Workspace.create({
    name: data.name,
    description: data.description,
    ownerId,
    inviteCode: generateInviteCode(),
    members: [ownerId],
  });

  return workspace;
};

/** Get all workspaces that the user belongs to. */
export const getUserWorkspaces = async (
  userId: string
) => {
  return Workspace.find({
    members: userId,
  }).sort({
    createdAt: -1,
  });
};

/** Join a workspace using an invite code. */
export const joinWorkspace = async (
  userId: string,
  inviteCode: string
) => {
  const workspace = await Workspace.findOne({
    inviteCode,
  });

  if (!workspace) {
    throw new AppError(
      "Invalid invite code",
      404
    );
  }

  if (workspace.members.includes(userId)) {
    throw new AppError(
      "Already a member",
      400
    );
  }

  workspace.members.push(userId);

  await workspace.save();

  return workspace;
};