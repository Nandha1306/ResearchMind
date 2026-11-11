import { Workspace } from "../models/Workspace";
import { CreateWorkspaceDto } from "../types/workspace.types";
import { generateInviteCode } from "../utils/invite-code";
import { AppError } from "../../../../packages/shared/errors/AppError";

/** Create a new workspace for the authenticated user. */
export const createWorkspace = async (
  ownerId: string,
  data: CreateWorkspaceDto
) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const workspace = await Workspace.create({
        name: data.name,
        description: data.description,
        ownerId,
        inviteCode: generateInviteCode(),
        members: [ownerId],
      });

      return workspace;
    } catch (err: any) {
      if (err.code === 11000 && attempt < 4) {
        continue;
      }
      throw err;
    }
  }

  throw new AppError("Failed to generate a unique workspace invite code", 500);
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

/**
 * Invite codes are generated in upper case (utils/invite-code.ts); users type
 * them in any case and with stray spaces.
 */
export const normalizeInviteCode = (inviteCode: string) =>
  inviteCode.trim().toUpperCase();

/**
 * Join a workspace using an invite code.
 *
 * Atomic: the membership is added by a single conditional update, so two
 * concurrent joins (double submit, two tabs) cannot add the user twice.
 *  - unknown code          -> 404
 *  - already a member      -> 409 (the membership exists; nothing changes)
 */
export const joinWorkspace = async (
  userId: string,
  inviteCode: string
) => {
  const code = normalizeInviteCode(inviteCode);

  const workspace = await Workspace.findOneAndUpdate(
    { inviteCode: code, members: { $ne: userId } },
    { $addToSet: { members: userId } },
    { returnDocument: "after" }
  );

  if (workspace) {
    return workspace;
  }

  const existing = await Workspace.exists({ inviteCode: code });
  if (!existing) {
    throw new AppError("Invalid invite code", 404);
  }

  throw new AppError("You are already a member of this workspace", 409);
};

/** Check whether a user belongs to a workspace. */
export const isWorkspaceMember = async (
  workspaceId: string,
  userId: string
) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    members: userId,
  });

  return Boolean(workspace);
};

/** Get a single workspace by ID if the user is a member. */
export const getWorkspaceById = async (
  workspaceId: string,
  userId: string
) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    members: userId,
  });

  if (!workspace) {
    throw new AppError("Workspace not found or access denied", 404);
  }

  return workspace;
};

/** Get hydrated member profiles for a workspace. */
export const getWorkspaceMembers = async (
  workspaceId: string,
  userId: string
) => {
  const workspace = await getWorkspaceById(workspaceId, userId);

  const authServiceUrl =
    process.env.AUTH_SERVICE_URL || "http://127.0.0.1:5001";
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;

  let hydratedUsers: Array<{
    userId: string;
    name?: string;
    email?: string;
    avatar?: string;
  }> = [];

  if (internalToken) {
    try {
      const res = await fetch(`${authServiceUrl}/internal/users/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": internalToken,
        },
        body: JSON.stringify({ userIds: workspace.members }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          hydratedUsers = json.data;
        }
      }
    } catch (err) {
      console.error("[workspace-service] Failed to hydrate user details:", err);
    }
  }

  const userMap = new Map(hydratedUsers.map((u) => [u.userId, u]));

  return workspace.members.map((mId: string) => {
    const found = userMap.get(mId);
    return {
      userId: mId,
      name: found?.name || "Researcher",
      email: found?.email || "",
      avatar: found?.avatar,
    };
  });
};