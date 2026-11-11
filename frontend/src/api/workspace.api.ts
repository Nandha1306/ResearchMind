import axiosInstance from "./axios";
import type { Workspace, WorkspaceCreationPayload, WorkspaceJoinPayload } from "../types/workspace.types";

export interface WorkspaceMember {
  id: string;
  name?: string;
  email?: string;
}

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

  getWorkspaceMembers: async (workspaceId: string): Promise<WorkspaceMember[]> => {
    const response = await axiosInstance.get<{ success: boolean; data: WorkspaceMember[] }>(
      `/workspaces/${workspaceId}/members`
    );
    return response.data.data || [];
  },
};

