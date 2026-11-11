import axiosInstance from "./axios";
import type { LoginPayload, RegisterPayload, AuthResponse, UserResponse } from "../types/auth.types";

export const authApi = {
  login: async (payload: LoginPayload): Promise<AuthResponse> => {
    const response = await axiosInstance.post<AuthResponse>("/auth/login", payload);
    return response.data;
  },

  register: async (payload: RegisterPayload): Promise<AuthResponse> => {
    const response = await axiosInstance.post<AuthResponse>("/auth/register", payload);
    return response.data;
  },

  /**
   * Revoke a refresh token server-side.
   *
   * The token MUST be sent in the body -- auth-service deletes the matching
   * RefreshToken document by value, so calling this with no body returns 200
   * while revoking nothing.
   */
  logout: async (refreshToken: string): Promise<{ success: boolean }> => {
    const response = await axiosInstance.post<{ success: boolean }>("/auth/logout", {
      refreshToken,
    });
    return response.data;
  },

  refreshToken: async (refreshToken: string): Promise<AuthResponse> => {
    const response = await axiosInstance.post<AuthResponse>("/auth/refresh", { refreshToken });
    return response.data;
  },

  getProfile: async (): Promise<UserResponse> => {
    const response = await axiosInstance.get<UserResponse>("/auth/me");
    return response.data;
  },
};
