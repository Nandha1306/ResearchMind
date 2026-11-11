import jwt, { SignOptions, VerifyOptions } from "jsonwebtoken";

import { requireSecret } from "../../../../packages/shared/config/secrets";

interface TokenPayload {
  userId: string;
}

/*
 * No fallbacks. These previously defaulted to literals that were published in
 * the service READMEs and docs/onboarding.md, so any deployment missing the env
 * var signed tokens with a publicly-known key. requireSecret throws instead.
 */
const JWT_ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET");
const JWT_REFRESH_SECRET = requireSecret("JWT_REFRESH_SECRET");

/*
 * The signing algorithm is pinned on BOTH sides.
 *
 * jsonwebtoken defaults to HS256 when signing, but on verify it will honour
 * whatever `alg` the token header claims unless `algorithms` is supplied. That
 * is the classic algorithm-confusion foothold, so verification is restricted to
 * exactly this one algorithm.
 */
const JWT_ALGORITHM = "HS256" as const;

/** Access token options */
const accessOptions: SignOptions = {
  algorithm: JWT_ALGORITHM,
  expiresIn: (process.env.ACCESS_TOKEN_EXPIRES as any) || "15m",
};

/** Refresh token options */
const refreshOptions: SignOptions = {
  algorithm: JWT_ALGORITHM,
  expiresIn: (process.env.REFRESH_TOKEN_EXPIRES as any) || "7d",
};

/** Verification options: only the pinned algorithm is accepted. */
const verifyOptions: VerifyOptions = {
  algorithms: [JWT_ALGORITHM],
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
    JWT_ACCESS_SECRET,
    verifyOptions
  ) as TokenPayload;
};

/** Verify refresh token */
export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(
    token,
    JWT_REFRESH_SECRET,
    verifyOptions
  ) as TokenPayload;
};
/** The single algorithm this system signs and verifies with. */
export const JWT_VERIFY_OPTIONS: VerifyOptions = verifyOptions;
