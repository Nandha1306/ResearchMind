import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * SEC-017: no `X-Powered-By: Express` fingerprint, neither from
 * workspace-service directly (it had no helmet and never disabled it) nor
 * through the gateway (the proxy copied upstream headers after helmet).
 * ISS-050 (iii): the server bounds the workspace name at 100 characters, like
 * the client form. Real workspace app; requests that fail validation never
 * reach MongoDB, so no database is needed.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
const USER = "665f1c2b9d3e4a00dddd0017";
const token = () => jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

let ws: { url: string; close: () => Promise<void> };

before(async () => {
  const { default: workspaceApp } = await import("../services/workspace-service/src/app");
  ws = await listen(workspaceApp);
});

after(async () => {
  await ws?.close();
});

const createWorkspace = (body: unknown) =>
  fetch(`${ws.url}/api/workspaces`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("SEC-017: workspace-service sends no X-Powered-By", () => {
  test("a validation error (400) and the unauthenticated 401 carry no x-powered-by", async () => {
    const bad = await createWorkspace({ name: "" });
    await bad.text();
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.headers.get("x-powered-by"), null);
    const unauth = await fetch(`${ws.url}/api/workspaces`);
    await unauth.text();
    assert.strictEqual(unauth.status, 401);
    assert.strictEqual(unauth.headers.get("x-powered-by"), null);
  });
});

describe("SEC-017: the gateway strips X-Powered-By from proxied responses", () => {
  test("an upstream that sends X-Powered-By: Express (workspaces and the AI stream proxy)", async () => {
    const { startGateway, startUpstreams } = await import("./helpers/gateway");
    const upstreams = await startUpstreams();
    upstreams.applyEnv();
    const gateway = await startGateway();
    try {
      for (const route of ["/api/workspaces", "/api/ai/sessions/workspace/665f1c2b9d3e4a00cccc0017"]) {
        const res = await fetch(`${gateway.url}${route}`, { headers: { Authorization: `Bearer ${token()}` } });
        await res.text();
        assert.ok(res.status < 500, `${route}: ${res.status}`);
        assert.strictEqual(res.headers.get("x-powered-by"), null, route);
      }
    } finally {
      await gateway.close();
      await upstreams.close();
    }
  });
});

describe("ISS-050 (iii): workspace name is at most 100 characters", () => {
  test("the shared schema accepts 100 and rejects 101 characters", async () => {
    const { createWorkspaceSchema } = await import("../packages/validation/schemas/workspace.schema");
    assert.ok(createWorkspaceSchema.safeParse({ name: "a".repeat(100) }).success);
    const tooLong = createWorkspaceSchema.safeParse({ name: "a".repeat(101) });
    assert.strictEqual(tooLong.success, false);
  });

  test("the real route answers 400 for a 101-character name (before any database access)", async () => {
    const res = await createWorkspace({ name: "a".repeat(101) });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.match(body.message, /at most 100 characters/);
  });
});
