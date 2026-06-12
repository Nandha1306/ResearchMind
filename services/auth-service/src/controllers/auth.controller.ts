import { Request, Response } from "express";
import { registerUser, loginUser, refreshAccessToken, logoutUser } from "../services/auth.service";
import { AuthRequest } from "../middlewares/auth.middleware";
import { getCurrentUser } from "../services/auth.service";

/** Handle user registration requests. */
export const register = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await registerUser(req.body);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Registration failed",
    });
  }
};

/** Handle user login requests. */
export const login = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await loginUser(req.body);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Login failed",
    });
  }
};

/** Generate a new access token using a valid refresh token. */
export const refresh = async (
  req: Request,
  res: Response
) => {
  try {
    const { refreshToken } = req.body;

    const result = await refreshAccessToken(refreshToken);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Token refresh failed",
    });
  }
};

/** Handle user logout requests. */
export const logout = async (
  req: Request,
  res: Response
) => {
  try {
    const { refreshToken } = req.body;

    const result = await logoutUser(refreshToken);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Logout failed",
    });
  }
};

/** Return the authenticated user's profile. */
export const me = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const user = await getCurrentUser(
      req.user!.userId
    );

    return res.status(200).json({
      success: true,
      data: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "User not found",
    });
  }
};