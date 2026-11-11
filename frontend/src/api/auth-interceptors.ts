import type { AxiosInstance } from "axios";
import {
  RefreshUnavailableError,
  type TokenRefreshCoordinator,
} from "../lib/token-refresh";

/**
 * Endpoints whose 401 means "wrong credentials / invalid token", never
 * "access token expired": refreshing for them is pointless or harmful.
 */
export const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh"];

const isNoRefreshPath = (url: string | undefined) =>
  Boolean(url && NO_REFRESH_PATHS.some((path) => url.endsWith(path)));

const bearerOf = (header: unknown): string | null =>
  typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null;

/**
 * Attach the access token to every request, and on a 401 renew it once
 * through the shared coordinator and retry (P1-A12). Kept separate from the
 * axios instance setup so it can be tested with a fake adapter.
 */
export const attachAuthInterceptors = (
  instance: AxiosInstance,
  deps: {
    getAccessToken(): string | null;
    coordinator: Pick<TokenRefreshCoordinator, "refreshAccessToken">;
  }
) => {
  instance.interceptors.request.use((config) => {
    const token = deps.getAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      if (
        error.response?.status !== 401 ||
        !originalRequest ||
        originalRequest._retry ||
        originalRequest.skipAuthRefresh ||
        isNoRefreshPath(originalRequest.url)
      ) {
        return Promise.reject(error);
      }

      // Retried at most once: a 401 after a successful refresh is final, so
      // there is no refresh loop.
      originalRequest._retry = true;

      let accessToken: string;
      try {
        accessToken = await deps.coordinator.refreshAccessToken(
          bearerOf(originalRequest.headers?.Authorization)
        );
      } catch (refreshError) {
        // Temporarily unable to refresh: surface that (the user is still
        // signed in). Session over: reject with the original 401, which
        // callers already map to "session expired" (the session is cleared).
        if (refreshError instanceof RefreshUnavailableError) {
          return Promise.reject(refreshError);
        }
        return Promise.reject(error);
      }

      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return instance(originalRequest);
    }
  );
};
