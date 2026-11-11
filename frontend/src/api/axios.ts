import axios from "axios";
import { useAuthStore } from "../store/auth.store";
import { clearClientSession } from "../lib/session";
import { attachAuthInterceptors } from "./auth-interceptors";
import {
  createTokenRefreshCoordinator,
  parsePersistedAuth,
  RefreshUnavailableError,
  SessionExpiredError,
} from "../lib/token-refresh";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Do not attempt a token refresh when this request returns 401. */
    skipAuthRefresh?: boolean;
    /** Internal: this request has already been retried after a refresh. */
    _retry?: boolean;
  }
}

/** Key under which zustand persists the auth store (see auth.store.ts). */
export const AUTH_STORAGE_KEY = "researchmind-auth";

const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Best-effort server-side revocation of a refresh token, using the matching
 * access token (the logout endpoint requires one). Never throws.
 */
export const revokeTokensQuietly = (refreshToken: string, accessToken: string): void => {
  void axios
    .post(
      `${API_URL}/auth/logout`,
      { refreshToken },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    .catch(() => undefined);
};

/** One refresh coordinator for axios, the SSE client and sign-out (P1-A12). */
export const tokenRefresh = createTokenRefreshCoordinator({
  getSession: () => {
    const state = useAuthStore.getState();
    return {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      sessionId: state.sessionId,
      userId: state.user?.id ?? null,
    };
  },
  readPersistedTokens: () => {
    try {
      return parsePersistedAuth(localStorage.getItem(AUTH_STORAGE_KEY));
    } catch {
      return null;
    }
  },
  setTokens: (accessToken, refreshToken) =>
    useAuthStore.getState().setTokens(accessToken, refreshToken),
  requestRefresh: async (refreshToken) => {
    // Plain axios (no interceptors): a 401 here must not recurse.
    const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    return {
      accessToken: response.data.data.accessToken,
      refreshToken: response.data.data.refreshToken,
    };
  },
  endSession: clearClientSession,
  // Tokens issued to a session that ended while the refresh was on the wire:
  // revoke them server-side so they cannot outlive the sign-out.
  revokeRefreshToken: (refreshToken, accessToken) =>
    revokeTokensQuietly(refreshToken, accessToken),
  withExclusiveLock: (fn) => {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    return locks ? locks.request("researchmind-token-refresh", fn) : fn();
  },
});

// Attach the access token; on 401 renew it once (shared coordinator) and retry.
attachAuthInterceptors(axiosInstance, {
  getAccessToken: () => useAuthStore.getState().accessToken,
  coordinator: tokenRefresh,
});

/**
 * A valid access token for non-axios requests (the SSE stream).
 * `forceRefresh` renews it; pass the token that was rejected so a refresh that
 * already happened elsewhere is reused instead of repeated.
 */
export const ensureFreshToken = async (
  forceRefresh = false,
  rejectedAccessToken?: string | null
): Promise<string> => {
  const { accessToken } = useAuthStore.getState();

  if (accessToken && !forceRefresh) {
    return accessToken;
  }

  try {
    return await tokenRefresh.refreshAccessToken(rejectedAccessToken ?? accessToken);
  } catch (error) {
    if (error instanceof RefreshUnavailableError) {
      throw error;
    }
    throw error instanceof SessionExpiredError ? error : new SessionExpiredError();
  }
};

export default axiosInstance;
