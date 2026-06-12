import { User } from "../models/User";
import { RegisterUserDto, LoginUserDto } from "../types/auth.type";
import { hashPassword } from "../utils/hash";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt";
import { verifyRefreshToken } from "../utils/jwt";

import { comparePassword } from "../utils/hash";
import { RefreshToken } from "../models/RefreshToken";

/** Store a refresh token for a user session. */
const saveRefreshToken = async (
  userId: string,
  token: string
) => {
  const expiresAt = new Date();

  expiresAt.setDate(expiresAt.getDate() + 7);

  await RefreshToken.create({
    userId,
    token,
    expiresAt,
  });
};

/** Register a new user and issue auth tokens. */
export const registerUser = async ({
  name,
  email,
  password,
}: RegisterUserDto) => {
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new Error("User already exists");
  }

  const hashedPassword = await hashPassword(password);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
  });

  const accessToken = generateAccessToken({
    userId: user._id.toString(),
  });

  const refreshToken = generateRefreshToken({
    userId: user._id.toString(),
  });

    await saveRefreshToken(
        user._id.toString(),
        refreshToken
    );

  const userResponse = {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
  };

  return {
    user: userResponse,
    accessToken,
    refreshToken,
  };
};

/** Authenticate a user and issue new tokens. */
export const loginUser = async ({
  email,
  password,
}: LoginUserDto) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isPasswordValid = await comparePassword(
    password,
    user.password
  );

  if (!isPasswordValid) {
    throw new Error("Invalid credentials");
  }

  const accessToken = generateAccessToken({
    userId: user._id.toString(),
  });

  const refreshToken = generateRefreshToken({
    userId: user._id.toString(),
  });

  await saveRefreshToken(
    user._id.toString(),
    refreshToken
  );

  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
    },
    accessToken,
    refreshToken,
  };
};

/** Validate refresh token and issue a new access token. */
export const refreshAccessToken = async (
  refreshToken: string
) => {
  try {
    const payload = verifyRefreshToken(refreshToken);

    const storedToken = await RefreshToken.findOne({
      token: refreshToken,
    });

    if (!storedToken) {
      throw new Error("Invalid refresh token");
    }

    return {
      accessToken: generateAccessToken({
        userId: payload.userId,
      }),
    };
  } catch {
    throw new Error("Invalid or expired refresh token");
  }
};

/** Revoke a refresh token and logout the user. */
export const logoutUser = async (
  refreshToken: string
) => {
  await RefreshToken.deleteOne({
    token: refreshToken,
  });

  return {
    message: "Logged out successfully",
  };
};

/** Fetch authenticated user profile. */
export const getCurrentUser = async (
  userId: string
) => {
  const user = await User.findById(userId).select("-password");

  if (!user) {
    throw new Error("User not found");
  }

  return user;
};