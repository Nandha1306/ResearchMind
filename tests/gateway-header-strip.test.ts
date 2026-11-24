import assert from "node:assert";
import { describe, test, before, after, beforeEach } from "node:test";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { setTestSecrets } from "./helpers/test-env";
import { rawRequest, startGateway, startUpstreams } from "./helpers/gateway";

/*
 * Wave 6 WP-4 (W6-SEC-03, scope amendment A-12 / R4): the gateway must not
 * forward client-supplied internal or forwarding headers upstream.
 * x-internal-token, x-forwarded-for/-host/-proto/-port and forwarded are
 * removed on all five proxies (auth, workspaces, documents, tasks, ai incl.
 * the composed AI stream handler). The gateway itself sets none of them
 * (http-proxy-middleware xfwd stays off). The validated x-request-id is kept.
 * REAL gateway app; upstream stubs; REDIS_URL on a closed port (fail-open).
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";
delete process.env.TRUST_PROXY;

const STRIPPED = ["x-internal-token", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "forwarded"];

let upstreams: Awaited<ReturnType<typeof startUpstreams>>;
let gateway: Awaited<ReturnType<typeof startGateway>>;
let token: string;

before(async () => {
  upstreams = await startUpstreams();
  upstreams.applyEnv();
  gateway = await startGateway();
  token = jwt.sign({ userId: crypto.randomBytes(12).toString("hex") }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });
});

after(async () => {
  await gateway?.close();
  await upstreams?.close();
});

beforeEach(() => upstreams.reset());

const ROUTES: Array<[string, string, string]> = [
  ["auth", "GET", "/api/auth/me"],
  ["workspaces", "GET", "/api/workspaces/665f1c2b9d3e4a0087654321"],
  ["documents", "GET", "/api/documents/665f1c2b9d3e4a0087654321"],
  ["tasks", "GET", "/api/tasks/665f1c2b9d3e4a0087654321"],
  ["ai", "POST", "/api/ai/query"],
];

describe("W6-SEC-03: client-supplied internal and forwarding headers never reach an upstream", () => {
  for (const [prefix, method, path] of ROUTES) {
    test(`${prefix}: ${STRIPPED.join(", ")} removed; x-request-id kept`, async () => {
      const res = await rawRequest(gateway.port, method, path, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-ID": "strip-test-1",
          "X-Internal-Token": "client-supplied-internal-token",
          "X-Forwarded-For": "6.6.6.6",
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-Proto": "http",
          "X-Forwarded-Port": "1",
          Forwarded: "for=6.6.6.6;proto=http",
        },
      });
      assert.ok(res.status < 400, `${path}: ${res.status} ${res.body}`);
      assert.strictEqual(upstreams.hits.length, 1, `${path} did not reach the upstream once`);
      const seen = upstreams.hits[0].headers ?? {};
      for (const name of STRIPPED) {
        assert.strictEqual(seen[name], undefined, `${prefix}: ${name} reached the upstream`);
      }
      assert.strictEqual(seen["x-request-id"], "strip-test-1");
      assert.strictEqual(seen.authorization, `Bearer ${token}`, "the user's Authorization header must still be forwarded");
    });
  }

  test("without client headers the gateway adds no forwarding header itself (xfwd off)", async () => {
    const res = await rawRequest(gateway.port, "POST", "/api/auth/login");
    assert.strictEqual(res.status, 401);
    const seen = upstreams.hits[0].headers ?? {};
    for (const name of STRIPPED) assert.strictEqual(seen[name], undefined, name);
  });
});
