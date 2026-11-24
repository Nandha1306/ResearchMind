import assert from "node:assert";
import { describe, test, before, after, beforeEach } from "node:test";
import jwt from "jsonwebtoken";
import { setTestSecrets } from "./helpers/test-env";
import { rawRequest, rawSocketRequest, startGateway, startUpstreams, variantsOf } from "./helpers/gateway";
import { nonCanonicalPathReason } from "../services/api-gateway/src/middlewares/path-guard.middleware";

/*
 * SEC-003: non-canonical request paths are rejected (400) by the REAL gateway
 * app before any other middleware, so no path variant can skip a rate limiter
 * or `authenticate` and still be served by the upstream.
 *
 * This file needs no Redis: REDIS_URL points at a dead port, so the limiters
 * fail open and every accepted request reaches the upstream stubs. That makes
 * "the upstream never saw it" a direct check of the guard. Counting against
 * the limits with a real Redis is in gateway-rate-limit.timing.ts.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599"; // nothing listens: limiters fail open

const USER = "665f1c2b9d3e4a00dddd0004";
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });
const auth = { Authorization: `Bearer ${token}` };

const PROTECTED = ["/api/auth/login", "/api/auth/register", "/api/ai/query", "/api/ai/search", "/api/ai/summarize-meeting"];

describe("SEC-003: path canonical-form check (unit)", () => {
  for (const route of PROTECTED) {
    test(`every variant of ${route} is non-canonical`, () => {
      for (const variant of variantsOf(route)) {
        assert.ok(nonCanonicalPathReason(variant), `${variant} was accepted`);
      }
    });
  }

  test("canonical paths, query strings, a trailing slash and ordinary escapes are accepted", () => {
    for (const ok of [
      "/api/auth/login",
      "/api/auth/login?next=/x//y&a=..",
      "/api/auth/login/",
      "/api/workspaces/665f1c2b9d3e4a00cccc0003/members",
      "/api/documents/search?q=%2F%2e%5C",
      "/api/tasks/board%20one",
      "/health",
      "/",
    ]) {
      assert.strictEqual(nonCanonicalPathReason(ok), null, ok);
    }
  });

  test("absolute-form and asterisk request targets are rejected", () => {
    assert.ok(nonCanonicalPathReason("http://127.0.0.1:5000/api/auth/login"));
    assert.ok(nonCanonicalPathReason("*"));
  });
});

describe("SEC-003: the real gateway rejects non-canonical paths before any middleware", () => {
  let upstreams: Awaited<ReturnType<typeof startUpstreams>>;
  let gateway: Awaited<ReturnType<typeof startGateway>>;

  before(async () => {
    upstreams = await startUpstreams();
    upstreams.applyEnv();
    gateway = await startGateway();
  });

  after(async () => {
    await gateway?.close();
    await upstreams?.close();
  });

  beforeEach(() => upstreams.reset());

  for (const route of [...PROTECTED, "/api/workspaces/665f1c2b9d3e4a00cccc0003", "/api/tasks/board/x", "/api/documents/x/y"]) {
    test(`variants of ${route} get 400 and never reach an upstream`, async () => {
      for (const variant of variantsOf(route)) {
        // With and without a token: a backslash used to skip `authenticate` too.
        for (const headers of [auth, {}]) {
          const res = await rawRequest(gateway.port, "POST", variant, { headers });
          assert.strictEqual(res.status, 400, `${variant} -> ${res.status} ${res.body}`);
          assert.deepStrictEqual(JSON.parse(res.body), { success: false, message: "Invalid request path" });
        }
      }
      assert.deepStrictEqual(upstreams.hits, [], "a non-canonical path reached an upstream");
    });
  }

  test("absolute-form request target and a raw NUL are rejected without reaching an upstream", async () => {
    const absolute = await rawSocketRequest(
      gateway.port,
      `POST http://127.0.0.1:${gateway.port}/api/auth//login HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
    );
    assert.strictEqual(absolute.status, 400);
    const nul = await rawSocketRequest(
      gateway.port,
      `POST /api/auth/login\u0000 HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
    );
    assert.strictEqual(nul.status, 400);
    assert.deepStrictEqual(upstreams.hits, []);
  });

  test("canonical paths still work: login, query strings, trailing slash, authenticated AI route", async () => {
    assert.strictEqual((await rawRequest(gateway.port, "POST", "/api/auth/login")).status, 401);
    assert.strictEqual((await rawRequest(gateway.port, "POST", "/api/auth/login?next=%2Fapp")).status, 401);
    assert.strictEqual((await rawRequest(gateway.port, "POST", "/api/auth/login/")).status, 401);
    assert.strictEqual((await rawRequest(gateway.port, "POST", "/api/ai/query", { headers: auth })).status, 200);
    assert.strictEqual((await rawRequest(gateway.port, "POST", "/api/ai/query")).status, 401, "authenticate still runs");
    assert.strictEqual((await rawRequest(gateway.port, "GET", "/api/workspaces", { headers: auth })).status, 200);
    assert.strictEqual((await rawRequest(gateway.port, "GET", "/health")).status, 200);
    assert.deepStrictEqual(
      upstreams.hits.map((h) => h.route),
      ["login", "login", "login", "ai-query", "generic"]
    );
  });

  test("a path that only starts like a proxied prefix (/api/authx, /api/aix) is not forwarded", async () => {
    assert.strictEqual((await rawRequest(gateway.port, "POST", "/api/authx/login")).status, 404);
    assert.strictEqual((await rawRequest(gateway.port, "POST", "/api/aiquery", { headers: auth })).status, 404);
    assert.strictEqual((await rawRequest(gateway.port, "GET", "/api/workspacesX")).status, 404);
    assert.deepStrictEqual(upstreams.hits, []);
  });
});
