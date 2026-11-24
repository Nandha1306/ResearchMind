import assert from "node:assert";
import path from "node:path";
import { test, describe, before, after } from "node:test";
import { freePort, runServiceToExit } from "./helpers/spawn-service";
import express from "express";
import { setTestSecrets, listen } from "./helpers/test-env";
import { startGateway, startUpstreams } from "./helpers/gateway";

/*
 * SEC-015 with scope-review rule R1: the gateway answered every origin with
 * `Access-Control-Allow-Origin: *`, and document/task-service reflected any
 * origin. Now:
 *  - CORS_ORIGIN unset: only loopback origins over http (localhost or
 *    127.0.0.1, any port -- Vite may pick another port) are allowed;
 *  - CORS_ORIGIN set: exactly those origins (loopback is not implicitly
 *    added); `*` and malformed entries stop the gateway at startup;
 *  - the internal services send no CORS headers (browsers only talk to the
 *    gateway).
 * REAL gateway app (CORS_ORIGIN unset in this process) and real service apps;
 * Redis on a dead port; upstreams are local stubs.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
delete process.env.CORS_ORIGIN;
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

let upstreams: Awaited<ReturnType<typeof startUpstreams>>;
let gateway: Awaited<ReturnType<typeof startGateway>>;
let cors: typeof import("../packages/shared/http/cors-origins");

before(async () => {
  cors = await import("../packages/shared/http/cors-origins");
  upstreams = await startUpstreams();
  upstreams.applyEnv();
  gateway = await startGateway();
});

after(async () => {
  await gateway?.close();
  await upstreams?.close();
});

const request = (url: string, origin: string, method = "GET") =>
  fetch(url, {
    method,
    headers: {
      Origin: origin,
      ...(method === "OPTIONS" ? { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } : {}),
    },
  });

describe("SEC-015: gateway CORS (CORS_ORIGIN unset: loopback dev default)", () => {
  test("a loopback origin on any port is allowed (GET and preflight)", async () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5174", "http://localhost:4173", "http://localhost:61234"]) {
      const res = await request(`${gateway.url}/health`, origin);
      await res.text();
      assert.strictEqual(res.headers.get("access-control-allow-origin"), origin, origin);
    }
    const pre = await request(`${gateway.url}/api/workspaces`, "http://localhost:5175", "OPTIONS");
    await pre.text();
    assert.strictEqual(pre.headers.get("access-control-allow-origin"), "http://localhost:5175");
  });

  test("a foreign origin gets no Access-Control-Allow-Origin (GET and preflight); never *", async () => {
    for (const origin of ["https://evil.example", "http://localhost.evil.example", "https://localhost:5173", "http://10.0.0.5:5173"]) {
      const res = await request(`${gateway.url}/health`, origin);
      await res.text();
      assert.strictEqual(res.headers.get("access-control-allow-origin"), null, origin);
      const pre = await request(`${gateway.url}/api/workspaces`, origin, "OPTIONS");
      await pre.text();
      assert.strictEqual(pre.headers.get("access-control-allow-origin"), null, `preflight ${origin}`);
    }
  });
});

describe("SEC-015: CORS_ORIGIN parsing", () => {
  test("a set list allows exactly those origins (trimmed, trailing slash removed); loopback is not implicit", () => {
    const parsed = cors.parseCorsOrigins(" https://app.example.com/ , http://localhost:5173");
    assert.strictEqual(parsed.error, undefined);
    const allow = cors.corsOriginAllowed(parsed);
    assert.ok(allow("https://app.example.com"));
    assert.ok(allow("http://localhost:5173"));
    assert.ok(!allow("http://localhost:5174"), "loopback is not implicitly allowed when CORS_ORIGIN is set");
    assert.ok(!allow("https://evil.example"));
  });

  test("unset means the loopback default", () => {
    const parsed = cors.parseCorsOrigins(undefined);
    assert.strictEqual(parsed.loopbackDefault, true);
    const allow = cors.corsOriginAllowed(parsed);
    assert.ok(allow("http://localhost:3000"));
    assert.ok(allow("http://127.0.0.1"));
    assert.ok(!allow("https://localhost:3000"), "https loopback is not part of the dev default");
    assert.ok(!allow("http://localhost.evil.example:5173"));
  });

  test("* and malformed entries are refused", () => {
    for (const bad of ["*", "null", "https://a.example/path", "ftp://a.example", "a.example", "https://a.example, *", "http://"]) {
      assert.ok(cors.parseCorsOrigins(bad).error, bad);
    }
  });

  test("the real gateway refuses to start with CORS_ORIGIN=*", async () => {
    // Wave 6 (W6-TEST-11/12): an ephemeral port instead of 5936 and a temp
    // working directory (no .env is loaded), via helpers/spawn-service.ts.
    const { code, output } = await runServiceToExit(
      path.join("services", "api-gateway", "src", "server.ts"),
      {
        PORT: String(await freePort()),
        CORS_ORIGIN: "*",
        REDIS_URL: "redis://127.0.0.1:6599",
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
      },
      20_000
    );
    assert.notStrictEqual(code, 0);
    assert.notStrictEqual(code, null, `gateway kept running: ${output}`);
    assert.match(output, /CORS_ORIGIN/);
    assert.doesNotMatch(output, /running on/);
  });
});

describe("SEC-015: internal services send no CORS headers", () => {
  after(async () => {
    // document-service and ai-service open Redis clients at import (dead port): close them.
    for (const client of [
      (await import("../services/document-service/src/config/redis")).default,
      (await import("../services/ai-service/src/config/redis")).default,
    ]) {
      (client as { disconnect: () => void }).disconnect();
    }
  });

  for (const [name, modulePath] of [
    ["auth-service", "../services/auth-service/src/app"],
    ["document-service", "../services/document-service/src/app"],
    ["task-service", "../services/task-service/src/app"],
    ["ai-service", "../services/ai-service/src/app"],
  ] as const) {
    test(`${name}: no Access-Control-Allow-Origin for a foreign origin`, async () => {
      const { default: app } = await import(modulePath);
      const mini = express();
      mini.use(app);
      const server = await listen(mini);
      try {
        const res = await fetch(`${server.url}/health`, { headers: { Origin: "https://evil.example" } });
        await res.text();
        assert.strictEqual(res.headers.get("access-control-allow-origin"), null);
      } finally {
        await server.close();
      }
    });
  }
});
