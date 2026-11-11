import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import express from "express";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * Exercises the REAL task-service membership middleware (which calls the
 * workspace-service membership endpoint over HTTP) and the REAL subtask cycle
 * guard.
 *
 * Previously this file checked an inline array and an inline copy of the cycle
 * algorithm, so it passed regardless of the application code.
 */

setTestSecrets();

let stubWorkspaceService: { url: string; close: () => Promise<void> };
let app: express.Express;
let appServer: { url: string; close: () => Promise<void> };

// Workspace ids are Mongo ObjectIds: malformed ids are rejected (400) before
// any membership lookup (P1-A13), so the fixtures use valid-looking ids.
const WS_A = "665f1c2b9d3e4a00aaaa0001";
const WS_B = "665f1c2b9d3e4a00bbbb0002";
const MEMBER_TOKEN = "Bearer member-token";
const OUTSIDER_TOKEN = "Bearer outsider-token";

before(async () => {
  // Stand-in for workspace-service: only MEMBER_TOKEN belongs to workspace WS_A.
  stubWorkspaceService = await listen((req, res) => {
    const match = /^\/api\/workspaces\/([^/]+)\/membership$/.exec(req.url || "");
    const isMember = Boolean(match) && match![1] === WS_A && req.headers.authorization === MEMBER_TOKEN;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember } }));
  });
  process.env.WORKSPACE_SERVICE_URL = stubWorkspaceService.url;

  const { requireWorkspaceMembership } = await import(
    "../services/task-service/src/middlewares/workspace.middleware"
  );

  app = express();
  app.use(express.json());
  // Simulates `authenticate` having run.
  app.use((req: any, _res, next) => {
    if (req.headers["x-test-user"]) req.user = { userId: req.headers["x-test-user"] };
    next();
  });
  app.get("/api/tasks/workspaces/:workspaceId/tasks", requireWorkspaceMembership, (_req, res) => {
    res.json({ success: true, data: [] });
  });
  appServer = await listen(app);
});

after(async () => {
  await appServer?.close();
  await stubWorkspaceService?.close();
});

const call = (workspaceId: string, authorization?: string, user = "user-1") =>
  fetch(`${appServer.url}/api/tasks/workspaces/${workspaceId}/tasks`, {
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(user ? { "x-test-user": user } : {}),
    },
  });

describe("Workspace isolation (task-service requireWorkspaceMembership)", () => {
  test("a member of the workspace is allowed through", async () => {
    const res = await call(WS_A, MEMBER_TOKEN);
    assert.strictEqual(res.status, 200);
  });

  test("a user who is not a member gets 403", async () => {
    const res = await call(WS_A, OUTSIDER_TOKEN);
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await res.json()).success, false);
  });

  test("a member of workspace A cannot reach workspace B", async () => {
    const res = await call(WS_B, MEMBER_TOKEN);
    assert.strictEqual(res.status, 403);
  });

  test("no authenticated user is 401", async () => {
    const res = await call(WS_A, MEMBER_TOKEN, "");
    assert.strictEqual(res.status, 401);
  });
});

describe("Subtask cycle protection (task.service.assertParentChainIsSafe)", () => {
  let assertParentChainIsSafe: (ws: string, parent: string, self?: string) => Promise<void>;
  let Task: any;
  let originalFindOne: unknown;
  // id -> parentTaskId, all within workspace WS_A
  let parents: Record<string, string | null> = {};

  before(async () => {
    ({ assertParentChainIsSafe } = await import("../services/task-service/src/services/task.service"));
    ({ Task } = await import("../services/task-service/src/models/Task"));
    originalFindOne = Task.findOne;
    // Unit-level stub of the single query the guard issues.
    Task.findOne = (query: { _id: string; workspaceId: string }) => ({
      select: () => ({
        lean: async () =>
          query.workspaceId === WS_A && query._id in parents
            ? { parentTaskId: parents[query._id] }
            : null,
      }),
    });
  });

  after(() => {
    Task.findOne = originalFindOne;
  });

  const expect400 = async (promise: Promise<void>, pattern: RegExp) =>
    assert.rejects(promise, (err: any) => {
      assert.strictEqual(err.statusCode, 400);
      assert.match(err.message, pattern);
      return true;
    });

  test("a task cannot be its own parent", async () => {
    parents = { A: null };
    await expect400(assertParentChainIsSafe(WS_A, "A", "A"), /own parent/);
  });

  test("making A a child of its own descendant B is rejected", async () => {
    parents = { A: null, B: "A" }; // B is a subtask of A
    await expect400(assertParentChainIsSafe(WS_A, "B", "A"), /cycle/);
  });

  test("a valid re-parent is accepted", async () => {
    parents = { A: null, B: "A", C: null };
    await assertParentChainIsSafe(WS_A, "B", "C");
  });

  test("joining a chain that already contains a cycle is rejected", async () => {
    parents = { X: "Y", Y: "X" };
    await expect400(assertParentChainIsSafe(WS_A, "X"), /already contains a cycle/);
  });

  test("nesting deeper than the supported limit is rejected", async () => {
    parents = {};
    for (let i = 0; i < 25; i++) parents[`T${i}`] = i === 24 ? null : `T${i + 1}`;
    await expect400(assertParentChainIsSafe(WS_A, "T0"), /maximum supported depth/);
  });
});
