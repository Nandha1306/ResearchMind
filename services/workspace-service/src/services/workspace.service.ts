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

  // A user the owner removed cannot rejoin (SEC-010) until re-admitted.
  const workspace = await Workspace.findOneAndUpdate(
    { inviteCode: code, members: { $ne: userId }, removedMembers: { $ne: userId } },
    { $addToSet: { members: userId } },
    { returnDocument: "after" }
  );

  if (workspace) {
    return workspace;
  }

  const existing = await Workspace.findOne({ inviteCode: code }).select("+removedMembers members");
  if (!existing) {
    throw new AppError("Invalid invite code", 404);
  }
  if ((existing.removedMembers ?? []).includes(userId)) {
    throw new AppError(
      "You were removed from this workspace. Ask the workspace owner to re-admit you.",
      403
    );
  }

  throw new AppError("You are already a member of this workspace", 409);
};

/** Check whether a user belongs to a workspace. */
export const isWorkspaceMember = async (
  workspaceId: string,
  userId: string
) => {
  return (await getWorkspaceAccess(workspaceId, userId)).isMember;
};

/**
 * The caller's access to a workspace: member, and owner (Workspace.ownerId).
 * Read live from the database on every call -- there is no cache, so a
 * removed member loses access on their very next request (SEC-010).
 */
export const getWorkspaceAccess = async (
  workspaceId: string,
  userId: string
): Promise<{ isMember: boolean; isOwner: boolean }> => {
  const workspace = await Workspace.findOne({ _id: workspaceId, members: userId }).select("ownerId");
  return { isMember: Boolean(workspace), isOwner: Boolean(workspace) && workspace.ownerId === userId };
};

export type MemberRemovalOutcome = {
  removedUserId: string;
  /** Tasks unassigned in task-service; null when that cleanup could not run. */
  tasksUnassigned: number | null;
};

/**
 * Remove a member (owner only; SEC-010).
 *  - caller not a member of the workspace          -> 404 (no existence leak)
 *  - caller is a member but not the owner          -> 403
 *  - target is the owner (including the caller)    -> 400 (the owner cannot be removed)
 *  - target is not a member                        -> 404
 * The removal is one conditional update. The removed user loses access at
 * once on every service (membership is checked live per request). Their open
 * tasks are then unassigned in task-service (best effort: a failure is logged
 * and reported as tasksUnassigned: null, the removal stands).
 */
export const removeWorkspaceMember = async (
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  { unassignTasks = unassignRemovedMemberTasks } = {}
): Promise<MemberRemovalOutcome> => {
  const workspace = await Workspace.findOne({ _id: workspaceId, members: actorId }).select("ownerId");
  if (!workspace) {
    throw new AppError("Workspace not found or access denied", 404);
  }
  if (workspace.ownerId !== actorId) {
    throw new AppError("Only the workspace owner can remove members", 403);
  }
  if (targetUserId === workspace.ownerId) {
    throw new AppError("The workspace owner cannot be removed", 400);
  }

  /*
   * One atomic update: remove the member, record them as removed (they
   * cannot rejoin until the owner re-admits them) and ROTATE the invite code,
   * which every member could see -- otherwise the removed user could simply
   * rejoin with it. Retried on the (unlikely) invite-code collision.
   */
  let updated = null;
  for (let attempt = 0; ; attempt++) {
    try {
      updated = await Workspace.findOneAndUpdate(
        { _id: workspaceId, ownerId: actorId, members: targetUserId },
        {
          $pull: { members: targetUserId },
          $addToSet: { removedMembers: targetUserId },
          $set: { inviteCode: generateInviteCode() },
        },
        { returnDocument: "after" }
      );
      break;
    } catch (err: any) {
      if (err?.code === 11000 && attempt < 4) continue;
      throw err;
    }
  }
  if (!updated) {
    throw new AppError("That user is not a member of this workspace", 404);
  }

  let tasksUnassigned: number | null = null;
  try {
    tasksUnassigned = await unassignTasks(workspaceId, targetUserId);
  } catch (error) {
    console.error(
      `[workspace-service] Member removed from ${workspaceId}, but their tasks could not be unassigned: ${(error as Error)?.message}`
    );
  }
  return { removedUserId: targetUserId, tasksUnassigned };
};

/**
 * Lift a removal (owner only; SEC-010): the user may join again, with the
 * CURRENT invite code (rotated at removal; the owner shares it). This does not
 * add them back by itself.
 *  - caller not a member -> 404; not the owner -> 403
 *  - the user is not on the removed list -> 404
 */
export const readmitRemovedMember = async (
  workspaceId: string,
  actorId: string,
  targetUserId: string
): Promise<{ readmittedUserId: string }> => {
  const workspace = await Workspace.findOne({ _id: workspaceId, members: actorId }).select("ownerId");
  if (!workspace) {
    throw new AppError("Workspace not found or access denied", 404);
  }
  if (workspace.ownerId !== actorId) {
    throw new AppError("Only the workspace owner can re-admit members", 403);
  }
  const updated = await Workspace.findOneAndUpdate(
    { _id: workspaceId, ownerId: actorId, removedMembers: targetUserId },
    { $pull: { removedMembers: targetUserId } }
  );
  if (!updated) {
    throw new AppError("That user was not removed from this workspace", 404);
  }
  return { readmittedUserId: targetUserId };
};

/**
 * Ask task-service to unassign the removed member's tasks in this workspace
 * (internal, shared-secret route). Bounded by a 5 s timeout.
 */
export const unassignRemovedMemberTasks = async (
  workspaceId: string,
  userId: string
): Promise<number> => {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new Error("INTERNAL_SERVICE_TOKEN is not configured");
  }
  const taskServiceUrl = (process.env.TASK_SERVICE_URL || "http://127.0.0.1:5004").replace(/\/+$/, "");
  const response = await fetch(
    `${taskServiceUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}/unassign`,
    {
      method: "POST",
      headers: { "x-internal-token": internalToken },
      signal: AbortSignal.timeout(5000),
    }
  );
  if (!response.ok) {
    throw new Error(`task-service answered ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as { data?: { unassigned?: unknown } } | null;
  const unassigned = body?.data?.unassigned;
  if (typeof unassigned !== "number") {
    throw new Error("task-service returned an unexpected response");
  }
  return unassigned;
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

/** Limit for the member-name lookup in auth-service (ARC-004). */
export const MEMBER_HYDRATION_TIMEOUT_MS = 3000;
let memberHydrationTokenWarned = false;

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

  /*
   * ARC-004: bounded and no longer silent. The lookup times out after
   * MEMBER_HYDRATION_TIMEOUT_MS; a missing token (warned once per process), a
   * non-OK answer (status only) or an error (message only) is logged, and the
   * members are still returned with placeholder names.
   */
  if (!internalToken) {
    if (!memberHydrationTokenWarned) {
      memberHydrationTokenWarned = true;
      console.warn(
        "[workspace-service] INTERNAL_SERVICE_TOKEN is not set: member names cannot be loaded from auth-service and are shown as placeholders"
      );
    }
  } else {
    try {
      const res = await fetch(`${authServiceUrl}/internal/users/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": internalToken,
        },
        body: JSON.stringify({ userIds: workspace.members }),
        signal: AbortSignal.timeout(MEMBER_HYDRATION_TIMEOUT_MS),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          hydratedUsers = json.data;
        }
      } else {
        console.warn(`[workspace-service] Member name lookup failed: auth-service answered ${res.status}`);
      }
    } catch (err) {
      console.warn(`[workspace-service] Member name lookup failed: ${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message}`);
    }
  }

  const userMap = new Map(hydratedUsers.map((u) => [u.userId, u]));

  /*
   * SEC-018 (user decision): e-mail addresses are shown only to the workspace
   * owner and to the member themself; other members get "" (the field stays
   * a string, and names are always shown).
   */
  const viewerIsOwner = workspace.ownerId === userId;

  return workspace.members.map((mId: string) => {
    const found = userMap.get(mId);
    return {
      userId: mId,
      name: found?.name || "Researcher",
      email: viewerIsOwner || mId === userId ? found?.email || "" : "",
      avatar: found?.avatar,
    };
  });
};