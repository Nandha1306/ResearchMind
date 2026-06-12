import jwt, { SignOptions } from "jsonwebtoken";

interface TokenPayload {
  userId: string;
}

/** Access token options */
const accessOptions: SignOptions = {
  expiresIn: (process.env.ACCESS_TOKEN_EXPIRES as any) || "15m",
};

/** Refresh token options */
const refreshOptions: SignOptions = {
  expiresIn: (process.env.REFRESH_TOKEN_EXPIRES as any) || "7d",
};

/** Generate access token */
export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET as string,
    accessOptions
  );
};

/** Generate refresh token */
export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET as string,
    refreshOptions
  );
};

/** Verify access token */
export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(
    token,
    process.env.JWT_ACCESS_SECRET as string
  ) as TokenPayload;
};

/** Verify refresh token */
export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(
    token,
    process.env.JWT_REFRESH_SECRET as string
  ) as TokenPayload;
};