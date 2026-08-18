import jwt, { SignOptions } from "jsonwebtoken";

interface TokenPayload {
  userId: string;
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "researchmind_access_secret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "researchmind_refresh_secret";

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
    JWT_ACCESS_SECRET,
    accessOptions
  );
};

/** Generate refresh token */
export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(
    payload,
    JWT_REFRESH_SECRET,
    refreshOptions
  );
};

/** Verify access token */
export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(
    token,
    JWT_ACCESS_SECRET
  ) as TokenPayload;
};

/** Verify refresh token */
export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(
    token,
    JWT_REFRESH_SECRET
  ) as TokenPayload;
};