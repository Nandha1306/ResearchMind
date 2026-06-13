export interface User {
  id: string;
  name: string;
  email: string;
}

export interface AuthData {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  success: boolean;
  data: AuthData;
}

export interface UserResponse {
  success: boolean;
  data: User;
}

export type LoginPayload = Pick<User, "email"> & { password: string };
export type RegisterPayload = Pick<User, "name" | "email"> & { password: string };

