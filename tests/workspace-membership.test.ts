import assert from "node:assert";
import { test, describe, before, after, beforeEach } from "node:test";
import express from "express";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * P1-A13 -- the shared workspace membership check
 * (packages/shared/auth/workspace-membership.ts), used by the document, task
 * and ai services. A local HTTP server stands in for workspace-service so
 * every reply (member, not member, 401, 5xx, slow, down, garbage) can be
 * produced. Also exercised through the real task-service middleware.
 */

setTestSecrets();

const WS = "665f1c2b9d3e4a0011111111";
const MEMBER = "Bearer member";

let stub: { url: string; close: () => Promise<void> };
let mode: "normal" | "slow" | "error500" | "garbage" | "unauthorized" | "notfound" = "normal";
const requests: string[] = [];

let membership: typeof import("../packages/shared/auth/workspace-membership");
let app: { url: string; close: () => Promise<void> };

before(async () => {
  stub = await listen((req, res) => {
    requests.push(req.url || "");
    res.setHeader("Content-Type", "application/json");
    if (mode === "slow") return void setTimeout(() => res.end("{}"), 2000);
    if (mode === "error500") return void ((res.statusCode = 500), res.end("{}"));
    if (mode === "garbage") return void res.end("<html>proxy error</html>");
    if (mode === "unauthorized") return void ((res.statusCode = 401), res.end("{}"));
    if (mode === "notfound") return void ((res.statusCode = 404), res.end("Cannot GET"));

    const isMember = req.headers.authorization === MEMBER;
    const membershipPath = /^\/api\/workspaces\/([^/]+)\/membership$/.exec(req.url || "");
    if (membershipPath) {
      return void res.end(JSON.stringify({ success: true, data: { isMember } }));
    }
    // GET /api/workspaces/:id (member list) -- 404 for non-members, as the real service.
    if (!isMember) return void ((res.statusCode = 404), res.end(JSON.stringify({ success: false })));
    res.end(JSON.stringify({ success: true, data: { _id: WS, members: ["u1", "u2"] } }));
  });
  process.env.WORKSPACE_SERVICE_URL = stub.url;

  membership = await import("../packages/shared/auth/workspace-membership");

  const { requireWorkspaceMembership } = await import("../services/task-service/src/middlewares/workspace.middleware");
  const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
  const mini = express();
  mini.use((req: any, _res, next) => {
    req.user = { userId: "u1" };
    next();
  });
  mini.get("/w/:workspaceId", requireWorkspaceMembership, (_req, res) => res.json({ ok: true }));
  mini.use(errorMiddleware);
  app = await listen(mini);
});

after(async () => {
  await app?.close();
  await stub?.close();
});

beforeEach(() => {
  mode = "normal";
  requests.length = 0;
});

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (error: any) {
    return error.statusCode;
  }
};

describe("checkWorkspaceMembership (shared)", () => {
  test("member -> true, not a member -> false", async () => {
    assert.strictEqual(await membership.checkWorkspaceMembership(WS, "u1", MEMBER), true);
    assert.strictEqual(await membership.checkWorkspaceMembership(WS, "u9", "Bearer outsider"), false);
  });

  test("a malformed workspace id is a 400 and never reaches workspace-service", async () => {
    for (const bad of ["abc", "../../admin", `${WS}?x=1`, "", "665f1c2b9d3e4a00111111zz"]) {
      assert.strictEqual(await statusOf(membership.checkWorkspaceMembership(bad, "u1", MEMBER)), 400, bad);
    }
    assert.deepStrictEqual(requests, []);
  });

  test("workspace-service down / slow / 5xx / garbage -> 503, never 'not a member'", async () => {
    mode = "error500";
    assert.strictEqual(await statusOf(membership.checkWorkspaceMembership(WS, "u1", MEMBER)), 503);
    mode = "garbage";
    assert.strictEqual(await statusOf(membership.checkWorkspaceMembership(WS, "u1", MEMBER)), 503);
    mode = "notfound"; // route missing / misrouted: a failed check, not "not a member"
    assert.strictEqual(await statusOf(membership.checkWorkspaceMembership(WS, "u1", MEMBER)), 503);
    mode = "slow";
    const started = Date.now();
    assert.strictEqual(
      await statusOf(membership.checkWorkspaceMembership(WS, "u1", MEMBER, { timeoutMs: 200 })),
      503
    );
    assert.ok(Date.now() - started < 1500, "bounded by the timeout");

    const saved = process.env.WORKSPACE_SERVICE_URL;
    process.env.WORKSPACE_SERVICE_URL = "http://127.0.0.1:1"; // nothing listens
    try {
      assert.strictEqual(await statusOf(membership.checkWorkspaceMembership(WS, "u1", MEMBER)), 503);
    } finally {
      process.env.WORKSPACE_SERVICE_URL = saved;
    }
  });

  test("an unauthenticated caller is 401", async () => {
    assert.strictEqual(await statusOf(membership.checkWorkspaceMembership(WS, "u1", undefined)), 401);
    mode = "unauthorized";
    assert.strictEqual(await statusOf(membership.checkWorkspaceMembership(WS, "u1", MEMBER)), 401);
  });

  test("getWorkspaceMemberIds: member ids for members, 403 for non-members", async () => {
    assert.deepStrictEqual(await membership.getWorkspaceMemberIds(WS, MEMBER), ["u1", "u2"]);
    assert.strictEqual(await statusOf(membership.getWorkspaceMemberIds(WS, "Bearer outsider")), 403);
    assert.strictEqual(await statusOf(membership.getWorkspaceMemberIds("nope", MEMBER)), 400);
  });
});

describe("through task-service requireWorkspaceMembership (real middleware + error mapping)", () => {
  const call = (workspaceId: string, auth = MEMBER) =>
    fetch(`${app.url}/w/${workspaceId}`, { headers: { Authorization: auth } });

  test("member 200, non-member 403", async () => {
    assert.strictEqual((await call(WS)).status, 200);
    assert.strictEqual((await call(WS, "Bearer outsider")).status, 403);
  });

  test("malformed id 400; workspace-service failing 503 (with a clear message)", async () => {
    assert.strictEqual((await call("abc")).status, 400);
    mode = "error500";
    const res = await call(WS);
    assert.strictEqual(res.status, 503);
    assert.match((await res.json()).message, /could not be verified/i);
  });
});
