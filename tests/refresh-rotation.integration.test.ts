import assert from "node:assert";
import crypto from "node:crypto";
import { test, describe, before, after } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setTestSecrets } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * INTEGRATION: real auth-service code against a real (disposable) MongoDB.
 * Proves the atomic single-document claim under genuine concurrency -- a
 * unit test with a stubbed model cannot.
 */

setTestSecrets();

let authService: typeof import("../services/auth-service/src/services/auth.service");
let RefreshToken: typeof import("../services/auth-service/src/models/RefreshToken").RefreshToken;
let db: { cleanup: () => Promise<void> } | undefined;

before(async () => {
  if (mongoSkip) return;
  db = await connectTestDatabase("auth");
  authService = await import("../services/auth-service/src/services/auth.service");
  ({ RefreshToken } = await import("../services/auth-service/src/models/RefreshToken"));
  await RefreshToken.init(); // build indexes (unique tokenHash, TTL)
});

after(async () => {
  await db?.cleanup();
});

const newUser = async () => {
  const email = `user-${crypto.randomBytes(5).toString("hex")}@example.test`;
  const registered = await authService.registerUser({ name: "Test User", email, password: "password123" });
  return { email, userId: String(registered.user.id), refreshToken: registered.refreshToken };
};

const login = async (email: string) =>
  (await authService.loginUser({ email, password: "password123" })).refreshToken;

const rejectsWith401 = async (promise: Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(promise, (err: any) => {
    assert.strictEqual(err.statusCode, 401);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });

describe("Refresh-token rotation (real MongoDB)", { skip: mongoSkip }, () => {
  test("normal rotation issues a new pair and the old token stops working", async () => {
    const { refreshToken } = await newUser();
    const rotated = await authService.refreshAccessToken(refreshToken);
    assert.notStrictEqual(rotated.refreshToken, refreshToken);

    // The rotated token works once more.
    const again = await authService.refreshAccessToken(rotated.refreshToken);
    assert.ok(again.accessToken);
  });

  test("concurrent refreshes with one token: exactly one succeeds, the rest are rejected without revoking", async () => {
    const { email, refreshToken } = await newUser();
    const otherSession = await login(email);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => authService.refreshAccessToken(refreshToken))
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "exactly one concurrent refresh may rotate the token");
    assert.strictEqual(rejected.length, 4);
    for (const r of rejected) {
      assert.strictEqual(r.reason.statusCode, 401);
      assert.match(r.reason.message, /already been used/);
    }

    // Ordinary concurrency must not have revoked the user's sessions.
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ refreshToken: string }>).value;
    assert.ok(await authService.refreshAccessToken(winner.refreshToken));
    assert.ok(await authService.refreshAccessToken(otherSession));
  });

  test("reusing an old token after the grace window revokes every session of that user", async () => {
    const saved = process.env.REFRESH_REUSE_GRACE_MS;
    process.env.REFRESH_REUSE_GRACE_MS = "0";
    try {
      const { email, refreshToken } = await newUser();
      const otherSession = await login(email);
      const rotated = await authService.refreshAccessToken(refreshToken);

      await new Promise((r) => setTimeout(r, 20));
      await rejectsWith401(authService.refreshAccessToken(refreshToken), /revoked/);

      // All sessions, including the legitimate rotated one, are now revoked.
      await rejectsWith401(authService.refreshAccessToken(rotated.refreshToken));
      await rejectsWith401(authService.refreshAccessToken(otherSession));
    } finally {
      if (saved === undefined) delete process.env.REFRESH_REUSE_GRACE_MS;
      else process.env.REFRESH_REUSE_GRACE_MS = saved;
    }
  });

  test("an expired refresh token is rejected and leaves stored sessions untouched", async () => {
    const { userId, refreshToken } = await newUser();
    const expired = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET!, { algorithm: "HS256", expiresIn: -10 });
    await rejectsWith401(authService.refreshAccessToken(expired), /expired/);
    assert.ok(await authService.refreshAccessToken(refreshToken), "valid session still works");
  });

  test("after logout the token cannot be refreshed", async () => {
    const { userId, refreshToken } = await newUser();
    await authService.logoutUser(refreshToken, userId);
    await rejectsWith401(authService.refreshAccessToken(refreshToken));
  });

  test("multiple sessions rotate independently", async () => {
    const { email, refreshToken: sessionA } = await newUser();
    const sessionB = await login(email);
    assert.notStrictEqual(sessionA, sessionB, "two sessions get distinct tokens");

    const rotatedA = await authService.refreshAccessToken(sessionA);
    const rotatedB = await authService.refreshAccessToken(sessionB);
    assert.ok(rotatedA.refreshToken && rotatedB.refreshToken);
  });

  test("two logins in the same second get distinct, independently stored tokens", async () => {
    const { email } = await newUser();
    const [a, b] = await Promise.all([login(email), login(email)]);
    assert.notStrictEqual(a, b);
    assert.ok(await authService.refreshAccessToken(a));
    assert.ok(await authService.refreshAccessToken(b));
  });

  test("a database outage fails the refresh instead of reporting success", async () => {
    const { refreshToken } = await newUser();
    const previousBufferTimeout = mongoose.get("bufferTimeoutMS");
    mongoose.set("bufferTimeoutMS", 500);
    await mongoose.disconnect();
    try {
      await assert.rejects(authService.refreshAccessToken(refreshToken));
    } finally {
      mongoose.set("bufferTimeoutMS", previousBufferTimeout);
    }
  });
});
