import axios from "axios";
import { useAuthStore } from "../store/auth.store";
import { clearClientSession } from "../lib/session";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor: Attach access token if present
axiosInstance.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: Handle token refresh on 401 Unauthorized
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Check if error is 401 Unauthorized and not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return axiosInstance(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const { refreshToken, sessionId } = useAuthStore.getState();

      if (!refreshToken) {
        // Nothing to refresh with. Tear the whole client session down rather
        // than only auth state, so no workspace or cached data outlives it.
        clearClientSession();
        isRefreshing = false;
        processQueue(error, null);
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${API_URL}/auth/refresh`, {
          refreshToken,
        });

        // The user may have signed out (or signed in as someone else) while
        // this refresh was on the wire. Writing the tokens back now would
        // resurrect the previous session, so drop the result instead.
        if (useAuthStore.getState().sessionId !== sessionId) {
          processQueue(error, null);
          return Promise.reject(error);
        }

        const newAccessToken = response.data.data.accessToken;

        const newRefreshToken =
          response.data.data.refreshToken ?? refreshToken;

        useAuthStore.getState().setTokens(
          newAccessToken,
          newRefreshToken
        );

        // Resume all failed requests
        processQueue(null, newAccessToken);

        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return axiosInstance(originalRequest);
      } catch (refreshError: any) {
        processQueue(refreshError, null);
        // Refresh failed. Only tear down if this is still the same session --
        // an explicit sign-out has already done the teardown, and repeating it
        // here could clobber a session the user has since started.
        if (useAuthStore.getState().sessionId === sessionId) {
          clearClientSession();
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Ensures a valid access token is available.
 * If token is missing or refresh is explicitly requested, attempts a refresh call.
 */
export const ensureFreshToken = async (forceRefresh = false): Promise<string> => {
  const { accessToken, refreshToken, sessionId } = useAuthStore.getState();

  if (accessToken && !forceRefresh) {
    return accessToken;
  }

  if (!refreshToken) {
    clearClientSession();
    throw new Error("Session expired. Please sign in again.");
  }

  try {
    const response = await axios.post(`${API_URL}/auth/refresh`, {
      refreshToken,
    });

    if (useAuthStore.getState().sessionId !== sessionId) {
      throw new Error("Session changed during refresh.");
    }

    const newAccessToken = response.data.data.accessToken;
    const newRefreshToken = response.data.data.refreshToken ?? refreshToken;

    useAuthStore.getState().setTokens(newAccessToken, newRefreshToken);
    return newAccessToken;
  } catch (err) {
    if (useAuthStore.getState().sessionId === sessionId) {
      clearClientSession();
    }
    throw new Error("Session expired. Please sign in again.");
  }
};

export default axiosInstance;
