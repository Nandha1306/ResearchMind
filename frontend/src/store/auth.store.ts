import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { User } from "../types/auth.types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * Monotonic counter identifying the current sign-in session.
   *
   * Bumped by login, register AND logout. An in-flight token refresh captures
   * this value before it starts and refuses to write tokens back if it has
   * changed by the time the response lands -- otherwise a refresh that was
   * already on the wire when the user signed out would silently resurrect the
   * previous session. Transient by design: never persisted.
   */
  sessionId: number;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  register: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setUser: (user: User | null) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      sessionId: 0,
      login: (user, accessToken, refreshToken) =>
        set((state) => ({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
          sessionId: state.sessionId + 1,
        })),
      register: (user, accessToken, refreshToken) =>
        set((state) => ({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
          sessionId: state.sessionId + 1,
        })),
      /**
       * Clears authentication state only.
       *
       * This is NOT the application sign-out. Use `signOutClientSession()` in
       * `lib/session.ts`, which also clears workspace state and the query
       * cache. This action stays narrow because the axios interceptor calls it
       * on an unrecoverable 401.
       */
      logout: () =>
        set((state) => ({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
          sessionId: state.sessionId + 1,
        })),
      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
        }),
      setTokens: (accessToken, refreshToken) =>
        set({
          accessToken,
          refreshToken,
        }),
      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: "researchmind-auth",
      storage: createJSONStorage(() => localStorage),
      // Only persist tokens and basic auth state, user info
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
