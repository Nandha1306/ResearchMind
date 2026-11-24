import assert from "node:assert";
import { describe, test, before, after, beforeEach } from "node:test";
import { setTestSecrets } from "./helpers/test-env";
import { rawRequest, startGateway, startUpstreams } from "./helpers/gateway";

/*
 * ISS-044 (gateway health reports the rate-limit store; request ids) and
 * SEC-008 (gateway Content-Security-Policy). REAL gateway app; upstream stubs;
 * REDIS_URL on a closed port, so the limiter store is down (fail-open).
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
// SEC-016 (Wave 5): Swagger UI is opt-in; the CSP + Swagger test below needs it on.
process.env.API_DOCS_ENABLED = "true";
delete process.env.TRUST_PROXY;

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("ISS-044: gateway health and request ids", () => {
  test("/health stays 200 but reports the rate-limit store as down (degraded)", async () => {
    const res = await rawRequest(gateway.port, "GET", "/health");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.body), {
      success: true,
      service: "api-gateway",
      status: "degraded",
      dependencies: { rateLimitStore: "down" },
    });
  });

  test("a request without an id gets a UUID, echoed to the client and forwarded upstream", async () => {
    const res = await fetch(`${gateway.url}/api/auth/login`, { method: "POST" });
    await res.arrayBuffer();
    const id = res.headers.get("x-request-id") ?? "";
    assert.match(id, UUID);
    assert.strictEqual(upstreams.hits[0].requestId, id);
  });

  test("a valid incoming id is kept end to end", async () => {
    const res = await fetch(`${gateway.url}/api/auth/login`, { method: "POST", headers: { "X-Request-ID": "client-123:abc.DEF_9" } });
    await res.arrayBuffer();
    assert.strictEqual(res.headers.get("x-request-id"), "client-123:abc.DEF_9");
    assert.strictEqual(upstreams.hits[0].requestId, "client-123:abc.DEF_9");
  });

  test("an invalid incoming id (bad characters, too long) is replaced", async () => {
    for (const bad of ["a b", "<script>", "x".repeat(129), "id;drop"]) {
      upstreams.reset();
      const res = await fetch(`${gateway.url}/api/auth/login`, { method: "POST", headers: { "X-Request-ID": bad } });
      await res.arrayBuffer();
      const id = res.headers.get("x-request-id") ?? "";
      assert.match(id, UUID, bad);
      assert.strictEqual(upstreams.hits[0].requestId, id);
    }
  });
});

describe("SEC-008: gateway Content-Security-Policy", () => {
  test("health and proxied responses carry helmet's CSP", async () => {
    for (const [method, path] of [["GET", "/health"], ["POST", "/api/auth/login"]] as const) {
      const res = await fetch(`${gateway.url}${path}`, { method });
      await res.arrayBuffer();
      const csp = res.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'self'/, path);
      assert.match(csp, /object-src 'none'/, path);
    }
  });

  test("Swagger UI still loads under the CSP (scripts are files, not inline)", async () => {
    const res = await fetch(`${gateway.url}/api-docs/`);
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.doesNotMatch(html, /<script>(?!\s*<\/script>)[^<]+<\/script>/, "inline script would be blocked");
    assert.match(html, /swagger-ui-bundle\.js/);
  });
});
