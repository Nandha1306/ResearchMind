/**
 * Workspace roles in the UI (SEC-010). Only the workspace owner may delete
 * documents, boards and tasks, and remove members; the server enforces this
 * (403 for anyone else), the UI only hides controls that would be refused.
 */

export const isWorkspaceOwner = (
  workspace: { ownerId?: string | null } | null | undefined,
  user: { id?: string | null } | null | undefined
): boolean => Boolean(workspace?.ownerId && user?.id && workspace.ownerId === user.id);

/** May `user` (the owner) remove `memberId`? Never the owner themself. */
export const canRemoveMember = (
  workspace: { ownerId?: string | null } | null | undefined,
  user: { id?: string | null } | null | undefined,
  memberId: string
): boolean => isWorkspaceOwner(workspace, user) && memberId !== workspace?.ownerId;
