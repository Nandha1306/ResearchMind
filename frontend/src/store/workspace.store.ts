import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { workspaceApi } from "../api/workspace.api";
import type { Workspace, WorkspaceCreationPayload } from "../types/workspace.types";

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  isLoading: boolean;
  error: string | null;
  createWorkspace: (payload: WorkspaceCreationPayload) => Promise<Workspace>;
  fetchWorkspaces: () => Promise<Workspace[]>;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  joinWorkspace: (inviteCode: string) => Promise<Workspace>;
  clearWorkspaceState: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspace: null,
      isLoading: false,
      error: null,

      createWorkspace: async (payload) => {
        set({ isLoading: true, error: null });
        try {
          const workspace = await workspaceApi.createWorkspace(payload);
          const currentWorkspaces = get().workspaces;
          set({
            workspaces: [...currentWorkspaces, workspace],
            currentWorkspace: workspace,
            isLoading: false,
          });
          return workspace;
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || "Failed to create workspace";
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      fetchWorkspaces: async () => {
        set({ isLoading: true, error: null });
        try {
          const list = await workspaceApi.getWorkspaces();
          const currentSelected = get().currentWorkspace;
          
          // Determine if we need to auto-select or restore currentWorkspace
          let updatedSelected = currentSelected;
          if (list.length > 0) {
            const stillExists = list.find((w) => w._id === currentSelected?._id);
            updatedSelected = stillExists || list[0];
          } else {
            updatedSelected = null;
          }

          set({
            workspaces: list,
            currentWorkspace: updatedSelected,
            isLoading: false,
          });
          return list;
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || "Failed to fetch workspaces";
          set({ isLoading: false, error: message });
          return [];
        }
      },

      setCurrentWorkspace: (workspace) => {
        set({ currentWorkspace: workspace });
      },

      joinWorkspace: async (inviteCode) => {
        set({ isLoading: true, error: null });
        try {
          const workspace = await workspaceApi.joinWorkspace({ inviteCode });
          const currentWorkspaces = get().workspaces;
          
          // Add if not already present
          const alreadyMember = currentWorkspaces.some((w) => w._id === workspace._id);
          const updatedList = alreadyMember
            ? currentWorkspaces.map((w) => (w._id === workspace._id ? workspace : w))
            : [...currentWorkspaces, workspace];

          set({
            workspaces: updatedList,
            currentWorkspace: workspace,
            isLoading: false,
          });
          return workspace;
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || "Failed to join workspace";
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      clearWorkspaceState: () => {
        set({ workspaces: [], currentWorkspace: null, error: null });
      },
    }),
    {
      name: "researchmind-workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentWorkspace: state.currentWorkspace,
      }),
    }
  )
);
