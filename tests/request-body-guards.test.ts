import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import express from "express";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * Express 5 leaves `req.body` undefined when a request has no body (or no
 * parser matched). These routes destructured it directly and crashed with a
 * TypeError -> HTTP 500. Each case below drives the REAL handler/middleware.
 */

setTestSecrets();

let server: { url: string; close: () => Promise<void> };

before(async () => {
  const { requireWorkspaceMembership } = await import("../services/ai-service/src/middlewares/workspace.middleware");
  const { createBoardHandler } = await import("../services/task-service/src/controllers/board.controller");
  const { default: authInternalRoutes } = await import("../services/auth-service/src/routes/internal.routes");
  const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { userId: "user-1" }; // as if `authenticate` had run
    next();
  });

  // Same middleware order as POST /api/ai/summarize-meeting.
  app.post("/api/ai/summarize-meeting", requireWorkspaceMembership, (_req, res) => res.json({ success: true }));
  app.post("/api/tasks/workspaces/:workspaceId/boards", createBoardHandler);
  app.use("/internal", authInternalRoutes);

  app.use(errorMiddleware);
  server = await listen(app);
});

after(async () => {
  await server?.close();
});

describe("Requests without a body get 4xx instead of 500", () => {
  test("ai-service summarize-meeting membership check -> 400 'Workspace ID is required'", async () => {
    const res = await fetch(`${server.url}/api/ai/summarize-meeting`, {
      method: "POST",
      headers: { Authorization: "Bearer x" },
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).message, /Workspace ID is required/);
  });

  test("task-service create board -> 400 'Board name is required'", async () => {
    const res = await fetch(`${server.url}/api/tasks/workspaces/ws-1/boards`, { method: "POST" });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).message, /Board name is required/);
  });

  test("auth-service /internal/users/bulk with a valid token and no body -> 400", async () => {
    const res = await fetch(`${server.url}/internal/users/bulk`, {
      method: "POST",
      headers: { "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN! },
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).message, /userIds must be an array/);
  });

  test("auth-service /internal/users/bulk without the internal token is still 401", async () => {
    const res = await fetch(`${server.url}/internal/users/bulk`, { method: "POST" });
    assert.strictEqual(res.status, 401);
  });
});
