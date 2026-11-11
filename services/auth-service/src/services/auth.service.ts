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
  const now = new Date();

  /*
   * Atomically claim the presented token. Exactly one request can move it
   * from "active" (rotatedAt null) to "rotated"; a concurrent refresh with the
   * same token cannot also pass this step. (Previously findOne + deleteOne:
   * two concurrent requests could both succeed, and reuse detection never
   * fired.) A single-document update needs no transaction, which matters
   * because the deployment runs a standalone MongoDB.
   *
   * The rotated record is kept only until the grace window ends (TTL index on
   * expiresAt), so a later replay finds nothing and is treated as reuse.
   */
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, rotatedAt: null },
    {
      $set: {
        rotatedAt: now,
        expiresAt: new Date(now.getTime() + refreshReuseGraceMs()),
      },
    },
    { returnDocument: "before" }
  );

  if (!claimed) {
    const existing = await RefreshToken.findOne({ tokenHash })
      .select("rotatedAt")
      .lean();

    if (
      existing?.rotatedAt &&
      now.getTime() - new Date(existing.rotatedAt).getTime() <= refreshReuseGraceMs()
    ) {
      // Rotated moments ago by a concurrent request (e.g. a second browser
      // tab). That is ordinary concurrency, not theft: reject this request but
      // do NOT revoke the user's other sessions.
      throw new AppError("Refresh token has already been used", 401);
    }

    // Reuse Detection: a validly-signed refresh token that is no longer
    // active (rotated earlier, revoked, or unknown). Revoke all sessions for
    // this user as a protective security measure.
    await RefreshToken.deleteMany({ userId: payload.userId });
    throw new AppError("Invalid or revoked refresh token", 401);
  }

  // Issue brand-new access & refresh token pair
  const newAccessToken = generateAccessToken({ userId: payload.userId });
  const newRefreshToken = generateRefreshToken({ userId: payload.userId });

  try {
    await saveRefreshToken(payload.userId, newRefreshToken);
  } catch (error) {
    // Never report a rotation that did not persist. Release the claim so the
    // client's current token stays usable for a retry, then surface the error
    // (a database outage is mapped to 503 by the error middleware).
    await RefreshToken.updateOne(
      { _id: claimed._id },
      { $set: { rotatedAt: null, expiresAt: claimed.expiresAt } }
    ).catch(() => {});
    throw error;
  }

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};

/**
 * How long a just-rotated refresh token is remembered so that a concurrent
 * refresh with it is rejected WITHOUT revoking every session.
 *
 * Trade-off: inside this window a replayed token is also not treated as
 * theft (an attacker who refreshed first is not revoked by the victim's
 * request). It is therefore kept short -- long enough for simultaneous
 * requests from one browser (tabs racing on the same token), far shorter than
 * a realistic theft-and-replay. Set to 0 to disable. Read per call so tests
 * can change it. Unset or empty means the default; bounded to 0..60 s.
 */
const DEFAULT_REFRESH_REUSE_GRACE_MS = 10_000;
const refreshReuseGraceMs = (): number => {
  const raw = process.env.REFRESH_REUSE_GRACE_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_REFRESH_REUSE_GRACE_MS;
  }
  const configured = Number(raw);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(configured, 60_000);
  }
  return DEFAULT_REFRESH_REUSE_GRACE_MS;
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