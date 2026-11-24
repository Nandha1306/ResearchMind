import assert from "node:assert";
import http from "node:http";
import { describe, test, before, after } from "node:test";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";
import { startGateway } from "./helpers/gateway";

/*
 * RT-003: the gateway bounds how long it waits for a silent upstream
 * (GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS, an IDLE limit) and answers 504.
 * REAL gateway app; upstream stubs; REDIS_URL on a closed port.
 * Timing-sensitive: run serialized by `npm run test:timing`.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS = "1000";
delete process.env.TRUST_PROXY;

const token = jwt.sign({ userId: "665f1c2b9d3e4a00dddd0004" }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

let hang: { url: string; close: () => Promise<void> };
let slow: { url: string; close: () => Promise<void> };
let sse: { url: string; close: () => Promise<void> };
let gateway: Awaited<ReturnType<typeof startGateway>>;
const pending = new Set<http.ServerResponse>();

before(async () => {
  // auth: never answers; workspaces: answers after 500 ms; ai: SSE heartbeats every 400 ms for 3 s.
  hang = await listen((_req, res) => {
    pending.add(res);
  });
  slow = await listen((_req, res) => {
    setTimeout(() => res.end(JSON.stringify({ success: true })), 500);
  });
  sse = await listen((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    let n = 0;
    const timer = setInterval(() => {
      n++;
      if (n * 400 >= 3000) {
        clearInterval(timer);
        res.end(`event: done\ndata: {}\n\n`);
        return;
      }
      res.write(": ping\n\n");
    }, 400);
  });
  process.env.AUTH_SERVICE_URL = hang.url;
  process.env.WORKSPACE_SERVICE_URL = slow.url;
  process.env.DOCUMENT_SERVICE_URL = slow.url;
  process.env.TASK_SERVICE_URL = slow.url;
  process.env.AI_SERVICE_URL = sse.url;
  gateway = await startGateway();
});

after(async () => {
  for (const res of pending) res.destroy();
  await gateway?.close();
  await hang?.close();
  await slow?.close();
  await sse?.close();
});

describe("RT-003: upstream idle timeout", () => {
  test("an upstream that never answers gets a 504 within the idle limit", async () => {
    const started = Date.now();
    const res = await fetch(`${gateway.url}/api/auth/me`, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json();
    const elapsed = Date.now() - started;
    assert.strictEqual(res.status, 504);
    assert.deepStrictEqual(body, { success: false, message: "The service took too long to respond. Please try again." });
    assert.ok(elapsed >= 900 && elapsed < 2500, `took ${elapsed} ms`);
  });

  test("a slow but answering upstream is unaffected", async () => {
    const res = await fetch(`${gateway.url}/api/workspaces`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 200);
    await res.arrayBuffer();
  });

  test("an SSE answer longer than the limit stays open while heartbeats keep arriving", async () => {
    const started = Date.now();
    const res = await fetch(`${gateway.url}/api/ai/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const text = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(Date.now() - started >= 2500, "stream ended early");
    assert.match(text, /event: done/);
  });
});
