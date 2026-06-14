import { User } from "../models/User";
import { RefreshToken } from "../models/RefreshToken";
import { RegisterUserDto, LoginUserDto } from "../types/auth.type";
import { hashPassword, comparePassword } from "../utils/hash";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { AppError } from "../../../../packages/shared/errors/AppError";

/** Save refresh token for active user session. */
const saveRefreshToken = async (
  userId: string,
  token: string
) => {
  const expiresAt = new Date();

  expiresAt.setDate(
    expiresAt.getDate() + 7
  );

  await RefreshToken.create({
    userId,
    token,
    expiresAt,
  });
};

/** Create a new user and issue auth tokens. */
export const registerUser = async ({
  name,
  email,
  password,
}: RegisterUserDto) => {
  const existingUser =
    await User.findOne({ email });

  if (existingUser) {
    throw new AppError(
      "User already exists",
      409
    );
  }

  const hashedPassword =
    await hashPassword(password);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
  });

  const accessToken =
    generateAccessToken({
      userId: user._id.toString(),
    });

  const refreshToken =
    generateRefreshToken({
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

/** Verify credentials and issue new tokens. */
export const loginUser = async ({
  email,
  password,
}: LoginUserDto) => {
  const user =
    await User.findOne({ email });

  if (!user) {
    throw new AppError(
      "Invalid credentials",
      401
    );
  }

  const isPasswordValid =
    await comparePassword(
      password,
      user.password
    );

  if (!isPasswordValid) {
    throw new AppError(
      "Invalid credentials",
      401
    );
  }

  const accessToken =
    generateAccessToken({
      userId: user._id.toString(),
    });

  const refreshToken =
    generateRefreshToken({
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
    const payload =
      verifyRefreshToken(
        refreshToken
      );

    const storedToken =
      await RefreshToken.findOne({
        token: refreshToken,
      });

    if (!storedToken) {
      throw new AppError(
        "Invalid refresh token",
        401
      );
    }

    return {
      accessToken:
        generateAccessToken({
          userId: payload.userId,
        }),
    };
  } catch {
    throw new AppError(
      "Invalid or expired refresh token",
      401
    );
  }
};

/** Remove refresh token and logout user. */
export const logoutUser = async (
  refreshToken: string
) => {
  await RefreshToken.deleteOne({
    token: refreshToken,
  });

  return {
    message:
      "Logged out successfully",
  };
};

/** Fetch authenticated user profile. */
export const getCurrentUser = async (
  userId: string
) => {
  const user =
    await User.findById(userId).select(
      "-password"
    );

  if (!user) {
    throw new AppError(
      "User not found",
      404
    );
  }

  return user;
};