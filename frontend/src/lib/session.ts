import { useAuthStore } from "../store/auth.store";
import { useWorkspaceStore } from "../store/workspace.store";
import { queryClient } from "./queryClient";
import { authApi } from "../api/auth.api";
import { AUTH_STORAGE_KEY, revokeTokensQuietly, tokenRefresh } from "../api/axios";
import {
  decideCrossTabAuthChange,
  parsePersistedAuth,
  revokeCurrentRefreshToken,
} from "./token-refresh";

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
    localStorage.removeItem(AUTH_STORAGE_KEY);
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
 * Revokes the CURRENT refresh token server-side on a best-effort basis (see
 * revokeCurrentRefreshToken: an expired access token is renewed first, so the
 * newest refresh token is the one revoked), then clears client state
 * unconditionally. A failed revocation must never leave the user stranded
 * inside the authenticated app; the caller is told whether it succeeded.
 */
export const signOutClientSession = async (): Promise<{ revoked: boolean }> => {
  if (signOutInFlight) {
    return { revoked: false };
  }
  signOutInFlight = true;

  try {
    const revoked = await revokeCurrentRefreshToken({
      waitForPendingRefresh: () => tokenRefresh.waitForPendingRefresh(),
      getTokens: () => {
        const { accessToken, refreshToken } = useAuthStore.getState();
        return { accessToken, refreshToken };
      },
      logout: (refreshToken) => authApi.logout(refreshToken),
      refreshAccessToken: (failed) => tokenRefresh.refreshAccessToken(failed),
    });
    return { revoked };
  } finally {
    clearClientSession();
    signOutInFlight = false;
  }
};

let crossTabSyncInstalled = false;

/**
 * Keep this tab's session consistent with other tabs (P1-A12): adopt tokens
 * another tab rotated (so this tab never spends a stale refresh token), end
 * the session when another tab signs out, and reload when another account
 * signs in. Call once at startup.
 */
export const installCrossTabSessionSync = (): void => {
  if (crossTabSyncInstalled || typeof window === "undefined") return;
  crossTabSyncInstalled = true;

  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_STORAGE_KEY && event.key !== null) return;

    const state = useAuthStore.getState();
    const persisted = parsePersistedAuth(
      event.key === null ? null : event.newValue
    );
    const action = decideCrossTabAuthChange(
      {
        isAuthenticated: state.isAuthenticated,
        userId: state.user?.id ?? null,
        refreshToken: state.refreshToken,
      },
      persisted
    );

    if (action === "adopt" && persisted?.accessToken && persisted.refreshToken) {
      state.setTokens(persisted.accessToken, persisted.refreshToken);
    } else if (action === "signed-out") {
      // Another tab signed out. This tab may hold a newer refresh token than
      // the one that tab revoked (e.g. it rotated it a moment ago), so revoke
      // the token held here too. Clearing first also discards (and revokes)
      // the result of any refresh still in flight in this tab.
      const { accessToken, refreshToken } = state;
      clearClientSession();
      if (accessToken && refreshToken) {
        revokeTokensQuietly(refreshToken, accessToken);
      }
    } else if (action === "reload") {
      window.location.reload();
    }
  });
};
