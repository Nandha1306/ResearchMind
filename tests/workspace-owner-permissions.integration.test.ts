import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe, before, after } from "node:test";
import { infraDescribe } from "./helpers/infra";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * SEC-010: owner-only destructive actions and member removal, across the
 * REAL workspace-, document- and task-service apps and the real ai routes,
 * all in this process on one disposable MongoDB. document-, task- and ai-
 * service ask the REAL workspace-service for membership/ownership (no stub),
 * so removal is proven to take effect through the live check.
 * Stubbed: Cloudinary destroy, ai-service's internal vector delete.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599"; // closed port; queue not used here
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

const id = () => new mongoose.Types.ObjectId().toString();
const OWNER = id();
const MEMBER = id();
const MEMBER2 = id();
const OUTSIDER = id();
const tokenFor = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "10m" });

let db: { cleanup: () => Promise<void> } | undefined;
let workspaceApp: { url: string; close: () => Promise<void> };
let documentApp: { url: string; close: () => Promise<void> };
let taskApp: { url: string; close: () => Promise<void> };
let aiApp: { url: string; close: () => Promise<void> };
let vectorStub: { url: string; close: () => Promise<void> };
let Document: any;
let Task: any;
let Board: any;
let docRedis: any;
let tmpDir: string;
const vectorCalls: string[] = [];
const destroyCalls: string[] = [];

before(async () => {
  if (mongoSkip) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-owner-"));
  process.chdir(tmpDir);
  db = await connectTestDatabase("owner");

  vectorStub = await listen((req, res) => {
    vectorCalls.push(req.url || "");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true }));
  });
  process.env.AI_SERVICE_URL = vectorStub.url;

  const { default: wsApp } = await import("../services/workspace-service/src/app");
  const { Workspace } = await import("../services/workspace-service/src/models/Workspace");
  await Workspace.syncIndexes();
  workspaceApp = await listen(wsApp);
  process.env.WORKSPACE_SERVICE_URL = workspaceApp.url;

  const { default: cloudinary } = await import("../services/document-service/src/config/cloudinary");
  cloudinary.uploader.destroy = (async (publicId: string) => {
    destroyCalls.push(publicId);
    return { result: "ok" };
  }) as any;
  ({ default: docRedis } = await import("../services/document-service/src/config/redis"));
  ({ Document } = await import("../services/document-service/src/models/Document"));
  const { default: docApp } = await import("../services/document-service/src/app");
  documentApp = await listen(docApp);

  ({ Task } = await import("../services/task-service/src/models/Task"));
  ({ Board } = await import("../services/task-service/src/models/Board"));
  const { default: tApp } = await import("../services/task-service/src/app");
  taskApp = await listen(tApp);
  process.env.TASK_SERVICE_URL = taskApp.url;

  const { default: aiRoutes } = await import("../services/ai-service/src/routes/ai.routes");
  const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
  const mini = express();
  mini.use(express.json());
  mini.use("/api/ai", aiRoutes);
  mini.use(errorMiddleware);
  aiApp = await listen(mini);
});

after(async () => {
  for (const server of [aiApp, taskApp, documentApp, workspaceApp, vectorStub]) await server?.close();
  docRedis?.disconnect();
  await db?.cleanup();
  if (tmpDir) {
    const { default: logger } = await import("../services/document-service/src/utils/logger");
    await new Promise<void>((resolve) => {
      logger.on("finish", () => resolve());
      logger.end();
      setTimeout(resolve, 1000);
    });
    process.chdir(os.tmpdir());
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(`Could not remove temp dir ${tmpDir}: ${(error as Error).message}`);
    }
  }
});

const call = async (base: string, method: string, url: string, userId: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenFor(userId)}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body
  }
  return { status: res.status, body: json };
};
const ws = (method: string, url: string, userId: string, body?: unknown) =>
  call(workspaceApp.url, method, `/api/workspaces${url}`, userId, body);
const tasks = (method: string, url: string, userId: string, body?: unknown) =>
  call(taskApp.url, method, `/api/tasks${url}`, userId, body);
const docs = (method: string, url: string, userId: string) => call(documentApp.url, method, `/api/documents${url}`, userId);

/** A workspace owned by OWNER with MEMBER and MEMBER2 joined. */
const setup = async () => {
  const created = await ws("POST", "/", OWNER, { name: `Lab ${crypto.randomBytes(3).toString("hex")}` });
  assert.strictEqual(created.status, 201);
  const W = created.body.data._id as string;
  for (const user of [MEMBER, MEMBER2]) {
    assert.strictEqual((await ws("POST", "/join", user, { inviteCode: created.body.data.inviteCode })).status, 200);
  }
  const board = await tasks("POST", `/workspaces/${W}/boards`, OWNER, { name: "Board" });
  assert.strictEqual(board.status, 201);
  const boardId = board.body.data._id as string;
  const memberTask = await tasks("POST", `/workspaces/${W}/tasks`, MEMBER, { boardId, title: "member's own task" });
  assert.strictEqual(memberTask.status, 201, JSON.stringify(memberTask.body));
  const assigned = await tasks("POST", `/workspaces/${W}/tasks`, OWNER, { boardId, title: "for member 2", assigneeId: MEMBER2 });
  assert.strictEqual(assigned.status, 201, JSON.stringify(assigned.body));
  const mkDoc = (uploadedBy: string) =>
    Document.create({
      workspaceId: W,
      uploadedBy,
      originalName: "paper.pdf",
      fileType: "pdf",
      fileSize: 10,
      extractedText: "text",
      embeddingStatus: "indexed",
      cloudinaryPublicId: `researchmind/documents/${crypto.randomUUID()}`,
      cloudinaryDeliveryType: "authenticated",
      cloudinaryResourceType: "image",
    });
  const memberDoc = await mkDoc(MEMBER);
  const ownerDoc = await mkDoc(OWNER);
  return {
    W,
    boardId,
    memberTaskId: memberTask.body.data._id as string,
    assignedTaskId: assigned.body.data._id as string,
    memberDocId: memberDoc._id.toString(),
    ownerDocId: ownerDoc._id.toString(),
  };
};

infraDescribe("SEC-010: owner-only destructive actions (real services)", mongoSkip, () => {
  test("the membership endpoint reports ownership", async () => {
    const { W } = await setup();
    assert.deepStrictEqual((await ws("GET", `/${W}/membership`, OWNER)).body.data, { isMember: true, isOwner: true });
    assert.deepStrictEqual((await ws("GET", `/${W}/membership`, MEMBER)).body.data, { isMember: true, isOwner: false });
    assert.deepStrictEqual((await ws("GET", `/${W}/membership`, OUTSIDER)).body.data, { isMember: false, isOwner: false });
  });

  test("a member gets 403 on every destructive route, an outsider 403 too; nothing is deleted", async () => {
    const s = await setup();
    vectorCalls.length = 0;
    destroyCalls.length = 0;
    const counts = async () => ({
      docs: await Document.countDocuments({ workspaceId: s.W }),
      tasks: await Task.countDocuments({ workspaceId: s.W }),
      boards: await Board.countDocuments({ workspaceId: s.W }),
    });
    const before = await counts();
    for (const user of [MEMBER, OUTSIDER]) {
      const results = [
        await docs("DELETE", `/${s.memberDocId}`, user), // even the uploader's own document
        await docs("DELETE", `/${s.ownerDocId}`, user),
        await tasks("DELETE", `/workspaces/${s.W}/tasks/${s.memberTaskId}`, user), // even their own task
        await tasks("DELETE", `/workspaces/${s.W}/boards/${s.boardId}?cascade=true`, user),
      ];
      for (const result of results) assert.strictEqual(result.status, 403, `${user}: ${JSON.stringify(result.body)}`);
      if (user === MEMBER) {
        assert.match(results[0].body.message, /Only the workspace owner can delete documents/);
        assert.match(results[2].body.message, /Only the workspace owner can delete tasks/);
        assert.match(results[3].body.message, /Only the workspace owner can delete boards/);
      }
    }
    assert.deepStrictEqual(await counts(), before);
    assert.deepStrictEqual(vectorCalls, []);
    assert.deepStrictEqual(destroyCalls, []);
  });

  test("the owner can delete documents, tasks and boards", async () => {
    const s = await setup();
    assert.strictEqual((await docs("DELETE", `/${s.memberDocId}`, OWNER)).status, 200);
    assert.strictEqual((await tasks("DELETE", `/workspaces/${s.W}/tasks/${s.memberTaskId}`, OWNER)).status, 200);
    assert.strictEqual((await tasks("DELETE", `/workspaces/${s.W}/boards/${s.boardId}?cascade=true`, OWNER)).status, 200);
    assert.strictEqual(await Document.countDocuments({ _id: s.memberDocId }), 0);
    assert.strictEqual(await Board.countDocuments({ _id: s.boardId }), 0);
  });
});

infraDescribe("SEC-010: member removal (real services)", mongoSkip, () => {
  test("only the owner can remove; the owner cannot be removed; a non-member gives 404", async () => {
    const { W } = await setup();
    const byMember = await ws("DELETE", `/${W}/members/${MEMBER2}`, MEMBER);
    assert.strictEqual(byMember.status, 403);
    assert.match(byMember.body.message, /Only the workspace owner can remove members/);
    assert.strictEqual((await ws("DELETE", `/${W}/members/${OWNER}`, OWNER)).status, 400, "owner removing themself");
    assert.strictEqual((await ws("DELETE", `/${W}/members/${OWNER}`, MEMBER)).status, 403);
    assert.strictEqual((await ws("DELETE", `/${W}/members/${OUTSIDER}`, OWNER)).status, 404, "not a member");
    assert.strictEqual((await ws("DELETE", `/${W}/members/${MEMBER2}`, OUTSIDER)).status, 404, "outsider: no existence leak");
    assert.strictEqual((await ws("GET", `/${W}/membership`, MEMBER2)).body.data.isMember, true, "nothing changed");
  });

  test("a removed member loses access on the very next request everywhere; their tasks are unassigned", async () => {
    const s = await setup();
    // Sanity: before removal MEMBER2 has access.
    assert.strictEqual((await docs("GET", `/workspace/${s.W}`, MEMBER2)).status, 200);

    const removed = await ws("DELETE", `/${s.W}/members/${MEMBER2}`, OWNER);
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    assert.deepStrictEqual(removed.body.data, { removedUserId: MEMBER2, tasksUnassigned: 1 });

    // Same, still-valid access token; no caching anywhere.
    assert.strictEqual((await ws("GET", `/${s.W}`, MEMBER2)).status, 404);
    assert.strictEqual((await ws("GET", `/${s.W}/membership`, MEMBER2)).body.data.isMember, false);
    assert.strictEqual((await docs("GET", `/workspace/${s.W}`, MEMBER2)).status, 403);
    assert.strictEqual((await docs("GET", `/${s.ownerDocId}`, MEMBER2)).status, 403);
    assert.strictEqual((await docs("GET", `/${s.ownerDocId}/file`, MEMBER2)).status, 403);
    assert.strictEqual((await tasks("GET", `/workspaces/${s.W}/tasks`, MEMBER2)).status, 403);
    assert.strictEqual((await tasks("GET", `/workspaces/${s.W}/boards`, MEMBER2)).status, 403);
    assert.strictEqual((await call(aiApp.url, "GET", `/api/ai/sessions/workspace/${s.W}`, MEMBER2)).status, 403);

    const task = await Task.findById(s.assignedTaskId).lean();
    assert.strictEqual(task.assigneeId, null, "removed member's task unassigned");
    assert.strictEqual((await ws("DELETE", `/${s.W}/members/${MEMBER2}`, OWNER)).status, 404, "already removed");
    // The remaining member is unaffected.
    assert.strictEqual((await docs("GET", `/workspace/${s.W}`, MEMBER)).status, 200);
  });

  test("H1: a removed member cannot rejoin -- the code is rotated and they are blocked until the owner re-admits them", async () => {
    const s = await setup();
    // As a member, MEMBER2 can read the invite code.
    const oldCode = (await ws("GET", `/${s.W}`, MEMBER2)).body.data.inviteCode as string;
    assert.ok(oldCode);

    assert.strictEqual((await ws("DELETE", `/${s.W}/members/${MEMBER2}`, OWNER)).status, 200);
    const newCode = (await ws("GET", `/${s.W}`, OWNER)).body.data.inviteCode as string;
    assert.ok(newCode && newCode !== oldCode, "invite code rotated on removal");
    assert.strictEqual((await ws("GET", `/${s.W}`, MEMBER)).body.data.inviteCode, newCode, "members see the new code");
    assert.ok(!("removedMembers" in (await ws("GET", `/${s.W}`, OWNER)).body.data), "removal list is not exposed");

    // Rejoin attempts: old code unknown (404); new code refused for the removed user (403).
    assert.strictEqual((await ws("POST", "/join", MEMBER2, { inviteCode: oldCode })).status, 404);
    const withNewCode = await ws("POST", "/join", MEMBER2, { inviteCode: newCode });
    assert.strictEqual(withNewCode.status, 403);
    assert.match(withNewCode.body.message, /removed from this workspace/);

    // Still no access anywhere after the attempts.
    assert.strictEqual((await ws("GET", `/${s.W}`, MEMBER2)).status, 404);
    assert.strictEqual((await docs("GET", `/workspace/${s.W}`, MEMBER2)).status, 403);
    assert.strictEqual((await docs("GET", `/${s.ownerDocId}/file`, MEMBER2)).status, 403);
    assert.strictEqual((await tasks("GET", `/workspaces/${s.W}/tasks`, MEMBER2)).status, 403);
    assert.strictEqual((await call(aiApp.url, "GET", `/api/ai/sessions/workspace/${s.W}`, MEMBER2)).status, 403);

    // Other members are unaffected; a newcomer can join with the new code.
    assert.strictEqual((await docs("GET", `/workspace/${s.W}`, MEMBER)).status, 200);
    assert.strictEqual((await ws("POST", "/join", OUTSIDER, { inviteCode: newCode })).status, 200);
    assert.strictEqual((await ws("DELETE", `/${s.W}/members/${OUTSIDER}`, OWNER)).status, 200);

    // Only the owner can lift the block; afterwards the user may join with the CURRENT code.
    assert.strictEqual((await ws("POST", `/${s.W}/members/${MEMBER2}/readmit`, MEMBER)).status, 403);
    assert.strictEqual((await ws("POST", `/${s.W}/members/${MEMBER}/readmit`, OWNER)).status, 404, "never removed");
    assert.strictEqual((await ws("POST", `/${s.W}/members/${MEMBER2}/readmit`, OWNER)).status, 200);
    const current = (await ws("GET", `/${s.W}`, OWNER)).body.data.inviteCode as string;
    assert.strictEqual((await ws("POST", "/join", MEMBER2, { inviteCode: oldCode })).status, 404, "old code stays dead");
    assert.strictEqual((await ws("POST", "/join", MEMBER2, { inviteCode: current })).status, 200);
    assert.strictEqual((await docs("GET", `/workspace/${s.W}`, MEMBER2)).status, 200);
  });

  test("the task cleanup route refuses calls without the internal secret", async () => {
    const res = await fetch(`${taskApp.url}/internal/workspaces/${id()}/members/${MEMBER2}/unassign`, { method: "POST" });
    assert.strictEqual(res.status, 401);
  });
});
