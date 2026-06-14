import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { registerUser, loginUser, refreshAccessToken, logoutUser, getCurrentUser } from "../services/auth.service";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";

/** Register a new user account. */
export const register = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await registerUser(req.body);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: result,
    });
  }
);

/** Authenticate user and return tokens. */
export const login = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await loginUser(req.body);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  }
);

/** Generate a new access token using refresh token. */
export const refresh = asyncHandler(
  async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    const result = await refreshAccessToken(refreshToken);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/** Logout user by revoking refresh token. */
export const logout = asyncHandler(
  async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    const result = await logoutUser(refreshToken);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/** Return authenticated user's profile. */
export const me = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const user = await getCurrentUser(
      req.user!.userId
    );

    res.status(200).json({
      success: true,
      data: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  }
);