import assert from "node:assert";
import crypto from "node:crypto";
import { test, describe, before, after } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * Exercises the REAL auth-service token utilities, refresh rotation logic and
 * the shared `authenticate` middleware.
 *
 * Previously this file re-implemented hashing and reuse detection inline and
 * asserted against its own copy, so it could never catch a regression.
 *
 * The RefreshToken model is stubbed at the method level (unit test): no
 * MongoDB is required, but the real service logic runs unchanged.
 */

setTestSecrets();

let jwtUtils: typeof import("../services/auth-service/src/utils/jwt");
let authService: typeof import("../services/auth-service/src/services/auth.service");
let RefreshToken: any;
let authenticate: typeof import("../packages/shared/auth/authenticate").authenticate;
let AppError: typeof import("../packages/shared/errors/AppError").AppError;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

before(async () => {
  jwtUtils = await import("../services/auth-service/src/utils/jwt");
  authService = await import("../services/auth-service/src/services/auth.service");
  ({ RefreshToken } = await import("../services/auth-service/src/models/RefreshToken"));
  ({ authenticate } = await import("../packages/shared/auth/authenticate"));
  ({ AppError } = await import("../packages/shared/errors/AppError"));
});

describe("JWT utilities (auth-service/src/utils/jwt.ts)", () => {
  test("access token round-trips and carries the userId", () => {
    const token = jwtUtils.generateAccessToken({ userId: "user-1" });
    assert.strictEqual(jwtUtils.verifyAccessToken(token).userId, "user-1");
  });

  test("a refresh token is rejected where an access token is required", () => {
    const refresh = jwtUtils.generateRefreshToken({ userId: "user-1" });
    assert.throws(() => jwtUtils.verifyAccessToken(refresh));
  });

  test("alg:none and tampered tokens are rejected (algorithm pinned to HS256)", () => {
    const unsigned = jwt.sign({ userId: "user-1" }, "", { algorithm: "none" });
    assert.throws(() => jwtUtils.verifyAccessToken(unsigned));

    const valid = jwtUtils.generateAccessToken({ userId: "user-1" });
    const [h, , s] = valid.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ userId: "admin" })).toString("base64url");
    assert.throws(() => jwtUtils.verifyAccessToken(`${h}.${forgedPayload}.${s}`));
  });
});

describe("Refresh rotation and reuse detection (auth.service.refreshAccessToken)", () => {
  const original: Record<string, any> = {};
  const calls: Record<string, any[]> = {};

  before(() => {
    for (const name of ["findOne", "deleteMany", "deleteOne", "create"]) {
      original[name] = RefreshToken[name];
    }
  });

  after(() => {
    Object.assign(RefreshToken, original);
  });

  const stubModel = (stored: unknown) => {
    for (const key of Object.keys(calls)) delete calls[key];
    const record = (name: string) => (arg: unknown) => {
      (calls[name] ||= []).push(arg);
      return Promise.resolve(name === "findOne" ? stored : {});
    };
    RefreshToken.findOne = record("findOne");
    RefreshToken.deleteMany = record("deleteMany");
    RefreshToken.deleteOne = record("deleteOne");
    RefreshToken.create = record("create");
  };

  test("a known token is rotated: old hash deleted, new hash stored, new pair returned", async () => {
    const presented = jwtUtils.generateRefreshToken({ userId: "user-42" });
    stubModel({ _id: "stored-id" });

    const result = await authService.refreshAccessToken(presented);

    assert.deepStrictEqual(calls.findOne, [{ tokenHash: sha256(presented) }]);
    assert.deepStrictEqual(calls.deleteOne, [{ _id: "stored-id" }]);
    assert.strictEqual(calls.deleteMany, undefined, "must not revoke all sessions on a normal refresh");
    assert.strictEqual(calls.create.length, 1);
    assert.strictEqual(calls.create[0].userId, "user-42");
    assert.strictEqual(calls.create[0].tokenHash, sha256(result.refreshToken));
    assert.strictEqual(jwtUtils.verifyAccessToken(result.accessToken).userId, "user-42");
  });

  test("reuse of a validly-signed but unknown token revokes ALL of the user's sessions", async () => {
    const reused = jwtUtils.generateRefreshToken({ userId: "user-7" });
    stubModel(null);

    await assert.rejects(authService.refreshAccessToken(reused), (err: any) => {
      assert.ok(err instanceof AppError);
      assert.strictEqual(err.statusCode, 401);
      return true;
    });
    assert.deepStrictEqual(calls.deleteMany, [{ userId: "user-7" }]);
    assert.strictEqual(calls.create, undefined, "no new token may be issued on reuse");
  });

  test("an invalid or missing token is a 401 and never touches the database", async () => {
    stubModel(null);
    for (const bad of ["not-a-jwt", undefined as unknown as string]) {
      await assert.rejects(authService.refreshAccessToken(bad), (err: any) => err.statusCode === 401);
    }
    assert.strictEqual(calls.findOne, undefined);
  });
});

describe("POST /api/auth/refresh through the real router", () => {
  test("a request with no body is 401, not a 500 (Express 5 leaves req.body undefined)", async () => {
    const { default: authRoutes } = await import("../services/auth-service/src/routes/auth.routes");
    const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use(errorMiddleware);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/auth/refresh`, { method: "POST" });
      assert.strictEqual(res.status, 401);
      assert.strictEqual((await res.json()).success, false);
    } finally {
      await server.close();
    }
  });
});

describe("Shared authenticate middleware", () => {
  const run = (authorization?: string) => {
    const req: any = { headers: authorization ? { authorization } : {} };
    let error: any;
    authenticate(req, {} as any, (err?: any) => {
      error = err;
    });
    return { req, error };
  };

  test("missing / non-Bearer header is 401", () => {
    assert.strictEqual(run().error.statusCode, 401);
    assert.strictEqual(run("Basic abc").error.statusCode, 401);
  });

  test("a valid access token attaches req.user", () => {
    const { req, error } = run(`Bearer ${jwtUtils.generateAccessToken({ userId: "u-9" })}`);
    assert.strictEqual(error, undefined);
    assert.strictEqual(req.user.userId, "u-9");
  });

  test("an expired token is 401", () => {
    const expired = jwt.sign({ userId: "u-9" }, process.env.JWT_ACCESS_SECRET!, {
      algorithm: "HS256",
      expiresIn: -10,
    });
    assert.strictEqual(run(`Bearer ${expired}`).error.statusCode, 401);
  });
});
