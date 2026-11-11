import crypto from "crypto";
import { User } from "../models/User";
import { RefreshToken } from "../models/RefreshToken";
import { RegisterUserDto, LoginUserDto } from "../types/auth.type";
import { hashPassword, comparePassword } from "../utils/hash";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { AppError } from "../../../../packages/shared/errors/AppError";

/** SHA-256 hash helper for refresh tokens */
const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/** Save refresh token hash for active user session. */
const saveRefreshToken = async (
  userId: string,
  token: string
) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const tokenHash = hashToken(token);

  await RefreshToken.create({
    userId,
    tokenHash,
    expiresAt,
  });
};

/** Create a new user and issue auth tokens. */
export const registerUser = async ({
  name,
  email,
  password,
}: RegisterUserDto) => {
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new AppError("User already exists", 409);
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

  await saveRefreshToken(user._id.toString(), refreshToken);

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
  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError("Invalid credentials", 401);
  }

  const isPasswordValid = await comparePassword(
    password,
    user.password
  );

  if (!isPasswordValid) {
    throw new AppError("Invalid credentials", 401);
  }

  const accessToken = generateAccessToken({
    userId: user._id.toString(),
  });

  const refreshToken = generateRefreshToken({
    userId: user._id.toString(),
  });

  await saveRefreshToken(user._id.toString(), refreshToken);

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

/** Validate refresh token, detect reuse, rotate pair, and issue new tokens. */
export const refreshAccessToken = async (refreshToken: string) => {
  let payload: { userId: string };

  try {
    payload = verifyRefreshToken(refreshToken) as { userId: string };
  } catch {
    throw new AppError("Invalid or expired refresh token", 401);
  }

  const tokenHash = hashToken(refreshToken);
  const storedToken = await RefreshToken.findOne({ tokenHash });

  if (!storedToken) {
    // Reuse Detection: A validly-signed refresh token was presented, but its hash
    // is not in the database (likely already rotated or revoked).
    // Revoke all sessions for this user as a protective security measure.
    await RefreshToken.deleteMany({ userId: payload.userId });
    throw new AppError("Invalid or revoked refresh token", 401);
  }

  // Delete the used refresh token (rotation)
  await RefreshToken.deleteOne({ _id: storedToken._id });

  // Issue brand-new access & refresh token pair
  const newAccessToken = generateAccessToken({ userId: payload.userId });
  const newRefreshToken = generateRefreshToken({ userId: payload.userId });

  await saveRefreshToken(payload.userId, newRefreshToken);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};

/** Revoke one of a user's refresh tokens. */
export const logoutUser = async (
  refreshToken: string,
  userId: string
) => {
  const tokenHash = hashToken(refreshToken);

  await RefreshToken.deleteMany({
    tokenHash,
    userId,
  });

  return {
    message: "Logged out successfully",
  };
};

/** Fetch authenticated user profile. */
export const getCurrentUser = async (userId: string) => {
  const user = await User.findById(userId).select("-password");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user;
};

/** Bulk fetch minimal user profiles by IDs for internal service hydration. */
export const getUsersBulk = async (userIds: string[]) => {
  const users = await User.find({
    _id: { $in: userIds },
  })
    .select("name email avatar")
    .lean();

  return users.map((u) => ({
    userId: u._id.toString(),
    name: u.name,
    email: u.email,
    avatar: u.avatar,
  }));
};