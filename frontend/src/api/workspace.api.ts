import axiosInstance from "./axios";
import type {
  Workspace,
  WorkspaceCreationPayload,
  WorkspaceJoinPayload,
  WorkspaceMember,
} from "../types/workspace.types";

export type { WorkspaceMember };

export const workspaceApi = {
  createWorkspace: async (payload: WorkspaceCreationPayload): Promise<Workspace> => {
    const response = await axiosInstance.post<{ success: boolean; data: Workspace }>(
      "/workspaces",
      payload
    );
    return response.data.data;
  },

  getWorkspaces: async (): Promise<Workspace[]> => {
    const response = await axiosInstance.get<{ success: boolean; data: Workspace[] }>(
      "/workspaces"
    );
    return response.data.data || [];
  },

  joinWorkspace: async (payload: WorkspaceJoinPayload): Promise<Workspace> => {
    const response = await axiosInstance.post<{ success: boolean; data: Workspace }>(
      "/workspaces/join",
      payload
    );
    return response.data.data;
  },

  /** Remove a member (workspace owner only; the server answers 403 otherwise). */
  removeMember: async (
    workspaceId: string,
    userId: string
  ): Promise<{ removedUserId: string; tasksUnassigned: number | null }> => {
    const response = await axiosInstance.delete<{
      success: boolean;
      data: { removedUserId: string; tasksUnassigned: number | null };
    }>(`/workspaces/${workspaceId}/members/${userId}`);
    return response.data.data;
  },

  getWorkspaceMembers: async (workspaceId: string): Promise<WorkspaceMember[]> => {
    const response = await axiosInstance.get<{ success: boolean; data: WorkspaceMember[] }>(
      `/workspaces/${workspaceId}/members`
    );
    return response.data.data || [];
  },
};

