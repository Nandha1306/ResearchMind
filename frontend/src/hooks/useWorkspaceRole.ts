import { useWorkspaceStore } from "../store/workspace.store";
import { useAuthStore } from "../store/auth.store";
import { isWorkspaceOwner } from "../utils/workspace-roles";

/** Is the signed-in user the owner of the current workspace? (SEC-010) */
export function useIsWorkspaceOwner(): boolean {
  const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  return isWorkspaceOwner(currentWorkspace, user);
}
