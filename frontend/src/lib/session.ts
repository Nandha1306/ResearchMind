import { useAuthStore } from "../store/auth.store";
import { useWorkspaceStore } from "../store/workspace.store";
import { queryClient } from "./queryClient";
import { authApi } from "../api/auth.api";

/**
 * Tears down every piece of client state that belongs to the signed-in user.
 *
 * This is the single canonical place that ends a session. It is deliberately
 * hook-free so the axios interceptor can call it from a 401 handler, and it
 * never navigates -- routing is the caller's job (`useSignOut`), because
 * `ProtectedRoute` already redirects once `isAuthenticated` flips to false.
 *
 * Order matters: workspace state and the query cache are cleared BEFORE auth,
 * so no component can observe "authenticated with the previous user's data".
 */
export const clearClientSession = (): void => {
  // Workspace list, current workspace, and the WS-001 resolution flags. Returns
  // the store to its unresolved shape so the next sign-in re-fetches instead of
  // reusing the previous user's list.
  useWorkspaceStore.getState().clearWorkspaceState();

  // Documents and anything else cached per user. removeQueries() drops the
  // entries outright rather than marking them stale, so a remount cannot paint
  // the previous user's data for a frame before refetching.
  queryClient.cancelQueries();
  queryClient.removeQueries();

  // Auth last: this is what flips `isAuthenticated` and triggers the redirect.
  useAuthStore.getState().logout();

  // Zustand's persist middleware writes the cleared state back to localStorage
  // synchronously, but drop the keys outright so nothing survives a partialize
  // change or a half-written entry.
  try {
    localStorage.removeItem("researchmind-auth");
    localStorage.removeItem("researchmind-workspace");
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The in-memory
    // stores are already cleared, which is what actually gates access.
  }
};

/** Guards against a second sign-out while the first is still running. */
let signOutInFlight = false;

/**
 * Full application sign-out.
 *
 * Revokes the refresh token server-side on a best-effort basis, then clears
 * client state unconditionally. A failed revocation must never leave the user
 * stranded inside the authenticated app, so the local teardown happens either
 * way; the caller is told whether the server call succeeded so it can surface
 * a warning if it wants to.
 */
export const signOutClientSession = async (): Promise<{ revoked: boolean }> => {
  if (signOutInFlight) {
    return { revoked: false };
  }
  signOutInFlight = true;

  const { refreshToken } = useAuthStore.getState();
  let revoked = false;

  try {
    if (refreshToken) {
      // The endpoint reads `refreshToken` from the body; without it the server
      // matches no document and silently revokes nothing.
      await authApi.logout(refreshToken);
      revoked = true;
    }
  } catch {
    // Server-side revocation failed. Fall through: the local session is still
    // torn down, which is the security-relevant part on this client.
  } finally {
    clearClientSession();
    signOutInFlight = false;
  }

  return { revoked };
};
