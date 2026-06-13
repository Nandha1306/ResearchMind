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

  logout: async (): Promise<{ success: boolean }> => {
    const response = await axiosInstance.post<{ success: boolean }>("/auth/logout");
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
