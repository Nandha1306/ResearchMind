import { useQuery } from "@tanstack/react-query";
import { workspaceApi } from "../api/workspace.api";
import type { WorkspaceMember } from "../types/workspace.types";

/**
 * Members of a workspace (ids + display names), cached and shared by the task
 * board, the task modals and the cards (P1-A16).
 */
export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery<WorkspaceMember[], Error>({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => workspaceApi.getWorkspaceMembers(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 1000 * 60 * 5,
  });
}
