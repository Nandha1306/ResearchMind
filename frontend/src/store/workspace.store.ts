import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { workspaceApi } from "../api/workspace.api";
import type { Workspace, WorkspaceCreationPayload } from "../types/workspace.types";

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  isLoading: boolean;
  /**
   * True once fetchWorkspaces() has settled at least once (success OR failure).
   *
   * This is the flag consumers must use before concluding "this user has zero
   * workspaces". An empty `workspaces` array is only meaningful after the first
   * fetch has completed; before that it is simply "not resolved yet".
   *
   * Transient by design — never persisted (see `partialize` below).
   */
  hasFetchedWorkspaces: boolean;
  /**
   * True only while fetchWorkspaces() has a request in flight.
   *
   * Deliberately separate from `isLoading`, which is shared with
   * createWorkspace/joinWorkspace. Consumers that gate routing must use this
   * one, otherwise an unrelated mutation would look like an unresolved list.
   *
   * Transient by design — never persisted.
   */
  isFetchingWorkspaces: boolean;
  error: string | null;
  createWorkspace: (payload: WorkspaceCreationPayload) => Promise<Workspace>;
  fetchWorkspaces: () => Promise<Workspace[]>;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  joinWorkspace: (inviteCode: string) => Promise<Workspace>;
  clearWorkspaceState: () => void;
}

/**
 * Initial (unresolved) workspace state.
 *
 * `isLoading: true` / `hasFetchedWorkspaces: false` means "we have not asked the
 * server yet", which is deliberately distinct from "the server told us there are
 * no workspaces". clearWorkspaceState() restores exactly this shape so a
 * subsequent sign-in re-resolves from scratch.
 */
const UNRESOLVED_WORKSPACE_STATE = {
  workspaces: [] as Workspace[],
  currentWorkspace: null as Workspace | null,
  isLoading: true,
  hasFetchedWorkspaces: false,
  isFetchingWorkspaces: false,
  error: null as string | null,
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...UNRESOLVED_WORKSPACE_STATE,

      createWorkspace: async (payload) => {
        set({ isLoading: true, error: null });
        try {
          const workspace = await workspaceApi.createWorkspace(payload);
          const currentWorkspaces = get().workspaces;
          set({
            workspaces: [...currentWorkspaces, workspace],
            currentWorkspace: workspace,
            isLoading: false,
            // A successful create is itself proof the user has >= 1 workspace,
            // so the onboarding decision is resolved even if no list fetch ran.
            hasFetchedWorkspaces: true,
          });
          return workspace;
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || "Failed to create workspace";
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      fetchWorkspaces: async () => {
        // `error` is cleared here so a retry starts clean. That is exactly why
        // `isFetchingWorkspaces` must be raised in the same update: without it
        // the state would briefly read as "resolved, no error, zero
        // workspaces" and a routing guard would redirect mid-retry.
        set({ isLoading: true, isFetchingWorkspaces: true, error: null });
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
            isFetchingWorkspaces: false,
            hasFetchedWorkspaces: true,
          });
          return list;
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || "Failed to fetch workspaces";
          // hasFetchedWorkspaces is set on failure too, so the UI can never get
          // stuck on a loading screen when the workspace API is unavailable.
          // Consumers must pair it with `error` to distinguish "fetch failed"
          // from "this user genuinely has no workspaces".
          set({
            isLoading: false,
            isFetchingWorkspaces: false,
            hasFetchedWorkspaces: true,
            error: message,
          });
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
            // A successful join is itself proof the user has >= 1 workspace.
            hasFetchedWorkspaces: true,
          });
          return workspace;
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || "Failed to join workspace";
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      clearWorkspaceState: () => {
        // Restore the fully unresolved shape (including hasFetchedWorkspaces:
        // false) so the next authenticated session re-fetches instead of
        // reusing the previous user's list.
        set({ ...UNRESOLVED_WORKSPACE_STATE });
      },
    }),
    {
      name: "researchmind-workspace",
      storage: createJSONStorage(() => localStorage),
      // Only currentWorkspace is persisted. `isLoading`, `hasFetchedWorkspaces`
      // and `error` are transient request state and MUST NOT be persisted — a
      // rehydrated `hasFetchedWorkspaces: true` would let the onboarding guard
      // decide "zero workspaces" from stale storage before any fetch runs.
      partialize: (state) => ({
        currentWorkspace: state.currentWorkspace,
      }),
    }
  )
);
