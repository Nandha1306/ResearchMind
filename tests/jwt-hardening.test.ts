import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe, before } from "node:test";
import jwt from "jsonwebtoken";
import { setTestSecrets } from "./helpers/test-env";

/*
 * SEC-019 (c) + ISS-047: every access-token verifier (gateway, shared,
 * auth-service, workspace-service) goes through ONE helper that pins HS256
 * and requires `userId` to be a 24-hex ObjectId string. A validly signed
 * token whose userId is an object (`{"$gt":""}`) used to reach Mongo filters
 * as an operator (cross-workspace listing). Each middleware keeps its own
 * response envelope. The refresh path applies the same userId check.
 */

setTestSecrets();
const SECRET = () => process.env.JWT_ACCESS_SECRET!;
const GOOD_ID = "665f1c2b9d3e4a0012345678";

type Middleware = (req: any, res: any, next: (err?: any) => void) => unknown;
let verifiers: Array<{ name: string; mw: Middleware }>;
let jwtUtils: typeof import("../services/auth-service/src/utils/jwt");

before(async () => {
  verifiers = [
    { name: "gateway", mw: (await import("../services/api-gateway/src/middlewares/auth.middleware")).authenticate as Middleware },
    { name: "shared", mw: (await import("../packages/shared/auth/authenticate")).authenticate as Middleware },
    { name: "auth-service", mw: (await import("../services/auth-service/src/middlewares/auth.middleware")).authenticate as Middleware },
    { name: "workspace-service", mw: (await import("../services/workspace-service/src/middlewares/auth.middleware")).authenticate as Middleware },
  ];
  jwtUtils = await import("../services/auth-service/src/utils/jwt");
});

/** Run a middleware; resolves to "next" (with req.user) or the 401 outcome. */
const run = (mw: Middleware, token: string) => {
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  let status: number | undefined;
  let nextError: any;
  let passed = false;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  mw(req, res, (err?: any) => {
    if (err) nextError = err;
    else passed = true;
  });
  return { passed, status: status ?? nextError?.statusCode, user: req.user };
};

const BAD_PAYLOADS: Array<[string, Record<string, unknown>]> = [
  ["no userId", { sub: "x" }],
  ["object userId (Mongo operator)", { userId: { $gt: "" } }],
  ["non-hex string", { userId: "user-1" }],
  ["short string", { userId: "x" }],
  ["number", { userId: 42 }],
  ["25 hex chars", { userId: `${GOOD_ID}a` }],
  ["array", { userId: [GOOD_ID] }],
];

describe("SEC-019 / ISS-047: one hardened access-token verifier for all middlewares", () => {
  test("a valid token passes every verifier and req.user is exactly { userId }", () => {
    const token = jwt.sign({ userId: GOOD_ID }, SECRET(), { algorithm: "HS256", expiresIn: "5m" });
    for (const { name, mw } of verifiers) {
      const out = run(mw, token);
      assert.ok(out.passed, name);
      assert.deepStrictEqual(out.user, { userId: GOOD_ID }, name);
    }
  });

  for (const [label, payload] of BAD_PAYLOADS) {
    test(`a correctly signed token with ${label} is refused (401) by every verifier`, () => {
      const token = jwt.sign(payload, SECRET(), { algorithm: "HS256", expiresIn: "5m" });
      for (const { name, mw } of verifiers) {
        const out = run(mw, token);
        assert.strictEqual(out.passed, false, `${name} let it through`);
        assert.strictEqual(out.status, 401, name);
      }
    });
  }

  test("alg none and other algorithms are refused by every verifier", () => {
    const none = jwt.sign({ userId: GOOD_ID }, "", { algorithm: "none" });
    const hs512 = jwt.sign({ userId: GOOD_ID }, SECRET(), { algorithm: "HS512" });
    for (const token of [none, hs512]) {
      for (const { name, mw } of verifiers) {
        assert.strictEqual(run(mw, token).status, 401, name);
      }
    }
  });

  test("the refresh path applies the same userId check", () => {
    const refreshSecret = process.env.JWT_REFRESH_SECRET!;
    const objectId = jwt.sign({ userId: { $ne: null } }, refreshSecret, { algorithm: "HS256", expiresIn: "1h" });
    assert.throws(() => jwtUtils.verifyRefreshToken(objectId));
    const good = jwtUtils.generateRefreshToken({ userId: GOOD_ID });
    assert.strictEqual(jwtUtils.verifyRefreshToken(good).userId, GOOD_ID);
  });

  test("ISS-047: jwt.verify appears only in the shared helper and the auth-service signer", () => {
    const ROOT = path.join(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name) && /jwt\.verify\(/.test(fs.readFileSync(full, "utf8"))) {
          offenders.push(path.relative(ROOT, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(path.join(ROOT, "packages"));
    for (const service of fs.readdirSync(path.join(ROOT, "services"))) {
      const src = path.join(ROOT, "services", service, "src");
      if (fs.existsSync(src)) walk(src);
    }
    assert.deepStrictEqual(offenders.sort(), ["packages/shared/auth/access-token.ts", "services/auth-service/src/utils/jwt.ts"]);
  });
});
