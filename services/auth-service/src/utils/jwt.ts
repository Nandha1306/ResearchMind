import crypto from "crypto";
import jwt, { SignOptions, VerifyOptions } from "jsonwebtoken";

import { requireSecret } from "../../../../packages/shared/config/secrets";
import { requireTokenUserId } from "../../../../packages/shared/auth/access-token";
import { readTokenLifetimes } from "../config/token-lifetimes";

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

/*
 * Token lifetimes, validated with jwt.sign's own parser (W6-SEC-05; see
 * config/token-lifetimes.ts). server.ts refuses to start with an invalid
 * value; this module also fails closed if it is ever loaded with one.
 */
const lifetimes = readTokenLifetimes(process.env);
if (!lifetimes.ok) {
  throw new Error(lifetimes.message);
}

/**
 * Access token options. Default lifetime 5 minutes (SEC-007, user decision):
 * access tokens cannot be revoked, so logout and reuse revocation take full
 * effect within 5 minutes. The client refreshes transparently.
 */
const accessOptions: SignOptions = {
  algorithm: JWT_ALGORITHM,
  expiresIn: lifetimes.access.expiresIn as any,
};

/** Refresh token options */
const refreshOptions: SignOptions = {
  algorithm: JWT_ALGORITHM,
  expiresIn: lifetimes.refresh.expiresIn as any,
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

/**
 * Generate refresh token.
 *
 * Every refresh token carries a random `jti`. Without it, two tokens issued
 * for the same user within the same second (iat has 1 s resolution) were
 * byte-identical, so they shared one stored hash: the second insert hit the
 * unique index (500), and rotating or revoking one session affected the other.
 */
export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(
    payload,
    JWT_REFRESH_SECRET,
    { ...refreshOptions, jwtid: crypto.randomUUID() }
  );
};

/**
 * Verify access token. Same rules as the shared verifier (SEC-019): the
 * payload's userId must be a 24-hex id, and only `{ userId }` is returned.
 */
export const verifyAccessToken = (token: string): TokenPayload =>
  requireTokenUserId(jwt.verify(token, JWT_ACCESS_SECRET, verifyOptions));

/**
 * Verify refresh token. The userId check (SEC-019 c) stops an operator-shaped
 * userId before it reaches `RefreshToken.deleteMany({ userId })`.
 */
export const verifyRefreshToken = (token: string): TokenPayload =>
  requireTokenUserId(jwt.verify(token, JWT_REFRESH_SECRET, verifyOptions));
/** The single algorithm this system signs and verifies with. */
export const JWT_VERIFY_OPTIONS: VerifyOptions = verifyOptions;
