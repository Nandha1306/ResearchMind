import assert from "node:assert";
import { test, describe, before, after, beforeEach } from "node:test";
import { infraDescribe } from "./helpers/infra";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setTestSecrets, listen } from "./helpers/test-env";
import { mongoSkip, connectTestDatabase } from "./helpers/test-mongo";

/*
 * INTEGRATION (real task-service app + real MongoDB):
 *  - P1-A16 assignee identity: only workspace members can be assigned
 *  - P1-A17 bulk creation: all-or-nothing, idempotent, isolated
 *  - P1-A13 membership outcomes through the real routes (400 / 403 / 503)
 * workspace-service is a local stub (membership + member list) driven by the
 * caller's JWT, as the real one is.
 */

setTestSecrets();

const id = () => new mongoose.Types.ObjectId().toString();
const WS_A = id();
const WS_B = id();
const ALICE = id();
const BOB = id();
const MALLORY = id(); // member of WS_B only
const MEMBERS: Record<string, string[]> = { [WS_A]: [ALICE, BOB], [WS_B]: [MALLORY] };

let db: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;
let app: { url: string; close: () => Promise<void> };
let workspaceStub: { url: string; close: () => Promise<void> };
let workspaceServiceDown = false;
/** Only the member-list endpoint fails (membership checks still work). */
let memberListDown = false;
let Task: any;
let TaskActivity: any;

const tokenFor = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

before(async () => {
  if (mongoSkip) return;

  workspaceStub = await listen((req, res) => {
    if (workspaceServiceDown) {
      res.statusCode = 503;
      return void res.end("{}");
    }
    let userId = "";
    try {
      userId = (jwt.verify(String(req.headers.authorization).replace(/^Bearer /, ""), process.env.JWT_ACCESS_SECRET!) as any).userId;
    } catch {
      res.statusCode = 401;
      return void res.end("{}");
    }
    res.setHeader("Content-Type", "application/json");
    const membership = /^\/api\/workspaces\/([^/]+)\/membership$/.exec(req.url || "");
    if (membership) {
      // SEC-010 (stub extended): the first member listed is the workspace owner.
      const members = MEMBERS[membership[1]] ?? [];
      return void res.end(
        JSON.stringify({ success: true, data: { isMember: members.includes(userId), isOwner: members[0] === userId } })
      );
    }
    const detail = /^\/api\/workspaces\/([^/]+)$/.exec(req.url || "");
    if (detail && memberListDown) {
      res.statusCode = 503;
      return void res.end("{}");
    }
    if (detail && MEMBERS[detail[1]]?.includes(userId)) {
      return void res.end(JSON.stringify({ success: true, data: { _id: detail[1], members: MEMBERS[detail[1]] } }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, message: "Workspace not found or access denied" }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;

  db = await connectTestDatabase("tasks");
  ({ Task } = await import("../services/task-service/src/models/Task"));
  ({ TaskActivity } = await import("../services/task-service/src/models/TaskActivity"));
  await Task.syncIndexes();
  const { default: taskApp } = await import("../services/task-service/src/app");
  app = await listen(taskApp);
});

after(async () => {
  await app?.close();
  await workspaceStub?.close();
  await db?.cleanup();
});

beforeEach(async () => {
  workspaceServiceDown = false;
  memberListDown = false;
  if (!mongoSkip) {
    await Task.deleteMany({});
    await TaskActivity.deleteMany({});
  }
});

const api = (method: string, path: string, userId: string, body?: unknown) =>
  fetch(`${app.url}/api/tasks${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenFor(userId)}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const makeBoard = async (workspaceId = WS_A, userId = ALICE) => {
  const res = await api("POST", `/workspaces/${workspaceId}/boards`, userId, { name: "Board" });
  assert.strictEqual(res.status, 201);
  return (await res.json()).data._id as string;
};

/*
 * ARC-010: `findOneAndUpdate(..., { new: true })` is deprecated in Mongoose 9
 * (process warning with code "MONGOOSE"). Board and task updates use
 * `returnDocument: "after"`, which returns the same updated document.
 */
infraDescribe("ARC-010: board and task updates emit no Mongoose deprecation warning (real MongoDB)", mongoSkip, () => {
  test("PATCH a board and a task: 0 MONGOOSE warnings, and the responses hold the updated documents", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: any) => {
      if (warning?.code === "MONGOOSE" || /deprecated/i.test(String(warning?.message)) && /new/.test(String(warning?.message))) {
        warnings.push(String(warning.message));
      }
    };
    process.on("warning", onWarning);
    try {
      const boardId = await makeBoard();
      const board = await api("PATCH", `/workspaces/${WS_A}/boards/${boardId}`, ALICE, { name: "Renamed board" });
      assert.strictEqual(board.status, 200);
      assert.strictEqual((await board.json()).data.name, "Renamed board");
      const created = await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "Original title" });
      const taskId = (await created.json()).data._id;
      const task = await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { title: "Updated title" });
      assert.strictEqual(task.status, 200);
      assert.strictEqual((await task.json()).data.title, "Updated title");
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepStrictEqual(warnings, []);
    } finally {
      process.off("warning", onWarning);
    }
  });

  test("static guard: no `new: true|false` option in service sources", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const root = path.join(__dirname, "..", "services");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name) && /\bnew\s*:\s*(true|false)\b/.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    walk(root);
    assert.deepStrictEqual(offenders, []);
  });
});

infraDescribe("P1-A16: task assignee is a workspace member id (real MongoDB)", mongoSkip, () => {
  test("assigning a member stores that member's user id", async () => {
    const boardId = await makeBoard();
    const res = await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "Write intro", assigneeId: BOB });
    assert.strictEqual(res.status, 201);
    const task = (await res.json()).data;
    assert.strictEqual(task.assigneeId, BOB);
    assert.strictEqual((await Task.findById(task._id).lean()).assigneeId, BOB);
  });

  test("a display name, a random id or another workspace's user is rejected (400), nothing stored", async () => {
    const boardId = await makeBoard();
    for (const assigneeId of ["Bob Smith", id(), MALLORY]) {
      const res = await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "T", assigneeId });
      assert.strictEqual(res.status, 400, assigneeId);
      assert.match((await res.json()).message, /member of this workspace/);
    }
    assert.strictEqual(await Task.countDocuments({}), 0);
  });

  test("an empty assignee means unassigned", async () => {
    const boardId = await makeBoard();
    const res = await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "T", assigneeId: "" });
    assert.strictEqual(res.status, 201);
    assert.strictEqual((await res.json()).data.assigneeId, null);
  });

  test("updates: reassign to a member, reject a non-member, unassign with null", async () => {
    const boardId = await makeBoard();
    const taskId = (await (await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "T" })).json()).data._id;

    assert.strictEqual((await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { assigneeId: BOB })).status, 200);
    assert.strictEqual((await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { assigneeId: "Bob" })).status, 400);
    assert.strictEqual((await Task.findById(taskId).lean()).assigneeId, BOB, "rejected update changed nothing");
    assert.strictEqual((await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { assigneeId: null })).status, 200);
    assert.strictEqual((await Task.findById(taskId).lean()).assigneeId, null);
    // Other fields still update without touching the assignee (no member lookup needed).
    assert.strictEqual((await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { title: "Renamed" })).status, 200);
  });

  test("the member list is only consulted when an assignee is being set", async () => {
    const boardId = await makeBoard();
    const taskId = (await (await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "T" })).json()).data._id;
    memberListDown = true;
    // No assignee change: no lookup, so the update works.
    assert.strictEqual((await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { title: "Renamed" })).status, 200);
    assert.strictEqual((await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { assigneeId: null })).status, 200);
    // Setting an assignee needs the lookup; if it cannot run, nothing is saved.
    assert.strictEqual((await api("PATCH", `/workspaces/${WS_A}/tasks/${taskId}`, ALICE, { assigneeId: BOB })).status, 503);
    assert.strictEqual((await Task.findById(taskId).lean()).assigneeId, null);
  });

  test("filtering by assignee uses the stored id", async () => {
    const boardId = await makeBoard();
    await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "Bob's", assigneeId: BOB });
    await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "Alice's", assigneeId: ALICE });
    const list = (await (await api("GET", `/workspaces/${WS_A}/tasks`, ALICE)).json()).data;
    assert.deepStrictEqual(list.filter((t: any) => t.assigneeId === BOB).map((t: any) => t.title), ["Bob's"]);
  });
});

infraDescribe("P1-A17: bulk task creation (real MongoDB)", mongoSkip, () => {
  const items = (boardId: string, n: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => ({ boardId, title: `Action ${i + 1}`, ...extra }));

  test("valid batch: every task and its 'created' activity is written", async () => {
    const boardId = await makeBoard();
    const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardId, 3) });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.length, 3);
    assert.strictEqual(body.replayed, false);
    assert.strictEqual(await Task.countDocuments({ workspaceId: WS_A }), 3);
    assert.strictEqual(await TaskActivity.countDocuments({ workspaceId: WS_A, action: "created" }), 3);
  });

  test("one invalid item (foreign board / oversize title / non-member assignee) -> 400 and NO task created", async () => {
    const boardId = await makeBoard();
    const foreignBoard = await makeBoard(WS_B, MALLORY);
    const batches = [
      [...items(boardId, 2), { boardId: foreignBoard, title: "x" }],
      [...items(boardId, 2), { boardId, title: "t".repeat(201) }],
      [...items(boardId, 2), { boardId, title: "x", description: "d".repeat(5001) }],
      [...items(boardId, 2), { boardId, title: "x", assigneeId: MALLORY }],
      items(boardId, 51),
    ];
    for (const tasks of batches) {
      const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks });
      assert.strictEqual(res.status, 400);
    }
    assert.strictEqual(await Task.countDocuments({}), 0, "nothing partially imported");
    assert.strictEqual(await TaskActivity.countDocuments({}), 0);
  });

  test("a write failure part-way is rolled back (no partial import)", async () => {
    const boardId = await makeBoard();
    const original = TaskActivity.insertMany;
    TaskActivity.insertMany = async () => {
      throw new Error("simulated activity write failure");
    };
    try {
      const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardId, 4) });
      assert.strictEqual(res.status, 500);
    } finally {
      TaskActivity.insertMany = original;
    }
    assert.strictEqual(await Task.countDocuments({}), 0, "tasks written before the failure were removed");
  });

  test("a task write failure after the activities were written leaves no orphaned activity", async () => {
    const boardId = await makeBoard();
    const original = Task.insertMany;
    Task.insertMany = async () => {
      throw new Error("simulated task write failure");
    };
    try {
      const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardId, 3), importKey: "summary-fail:00:3" });
      assert.strictEqual(res.status, 500);
    } finally {
      Task.insertMany = original;
    }
    assert.strictEqual(await Task.countDocuments({}), 0);
    assert.strictEqual(await TaskActivity.countDocuments({}), 0, "activities rolled back");
    // The same import can then be submitted again successfully.
    const retry = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardId, 3), importKey: "summary-fail:00:3" });
    assert.strictEqual(retry.status, 201);
  });

  test("repeating an import (same importKey) creates nothing new and says so", async () => {
    const boardId = await makeBoard();
    const body = { tasks: items(boardId, 3), importKey: "summary-123:abc:3" };
    const first = await (await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, body)).json();
    const again = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, body);
    assert.strictEqual(again.status, 200);
    const replay = await again.json();
    assert.strictEqual(replay.replayed, true);
    assert.deepStrictEqual(replay.data.map((t: any) => t._id), first.data.map((t: any) => t._id));
    assert.strictEqual(await Task.countDocuments({ workspaceId: WS_A }), 3);
  });

  test("a repeat that finds only PART of an import (still writing / rolled back) is 409, not 'done'", async () => {
    const boardId = await makeBoard();
    const key = "summary-partial:aa:3";
    // Simulate the first request mid-write: 1 of 3 tasks exists under the key.
    await Task.create({ workspaceId: WS_A, boardId, title: "Action 1", createdBy: ALICE, importKey: key, importIndex: 0 });
    const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardId, 3), importKey: key });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(await Task.countDocuments({ workspaceId: WS_A }), 1, "nothing added");
  });

  test("concurrent duplicate submissions create exactly one set", async () => {
    const boardId = await makeBoard();
    const body = { tasks: items(boardId, 5), importKey: "summary-race:ff:5" };
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () => api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, body).then((r) => r.status))
    );
    assert.ok(statuses.every((s) => [200, 201, 409].includes(s)), statuses.join(","));
    assert.strictEqual(statuses.filter((s) => s === 201).length, 1);
    assert.strictEqual(await Task.countDocuments({ workspaceId: WS_A }), 5);
  });

  test("the same importKey in another workspace is a separate import (isolation)", async () => {
    const boardA = await makeBoard();
    const boardB = await makeBoard(WS_B, MALLORY);
    const key = "shared-key-123";
    assert.strictEqual((await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardA, 2), importKey: key })).status, 201);
    assert.strictEqual((await api("POST", `/workspaces/${WS_B}/tasks/bulk`, MALLORY, { tasks: items(boardB, 1), importKey: key })).status, 201);
    assert.strictEqual(await Task.countDocuments({ workspaceId: WS_A }), 2);
    assert.strictEqual(await Task.countDocuments({ workspaceId: WS_B }), 1);
  });

  test("a non-member cannot bulk-create in a workspace (403)", async () => {
    const boardId = await makeBoard();
    const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, MALLORY, { tasks: items(boardId, 1) });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(await Task.countDocuments({}), 0);
  });

  test("RT-004: the same importKey with different tasks (same count) is refused; nothing replayed or written", async () => {
    const boardId = await makeBoard();
    const key = "summary-rt004:aa:2";
    const first = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, {
      tasks: [{ boardId, title: "Alpha" }, { boardId, title: "Beta" }],
      importKey: key,
    });
    assert.strictEqual(first.status, 201);
    const second = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, {
      tasks: [{ boardId, title: "Gamma" }, { boardId, title: "Delta" }],
      importKey: key,
    });
    assert.strictEqual(second.status, 409);
    assert.match((await second.json()).message, /different set of tasks/);
    const titles = (await Task.find({ workspaceId: WS_A }).sort({ importIndex: 1 }).lean()).map((t: any) => t.title);
    assert.deepStrictEqual(titles, ["Alpha", "Beta"]);
  });

  test("RT-004: the same key with a different count is a mismatch, not 'partial'", async () => {
    const boardId = await makeBoard();
    const key = "summary-rt004:bb:2";
    await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardId, 2), importKey: key });
    const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks: items(boardId, 1), importKey: key });
    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.match(body.message, /different set of tasks/);
    assert.doesNotMatch(body.message, /Only part/);
  });

  test("RT-004: a replay still works after an imported task was edited (the stored fingerprint is compared)", async () => {
    const boardId = await makeBoard();
    const body = { tasks: items(boardId, 2), importKey: "summary-rt004:cc:2" };
    const first = await (await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, body)).json();
    await api("PATCH", `/workspaces/${WS_A}/tasks/${first.data[0]._id}`, ALICE, { title: "Renamed" });
    const again = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, body);
    assert.strictEqual(again.status, 200);
    assert.strictEqual((await again.json()).replayed, true);
  });

  test("RT-004: a partial import with the matching fingerprint is still the 'partial' 409", async () => {
    const boardId = await makeBoard();
    const key = "summary-rt004:dd:3";
    const tasks = items(boardId, 3);
    const { computeImportHash } = await import("../services/task-service/src/services/task.service");
    await Task.create({
      workspaceId: WS_A, boardId, title: "Action 1", createdBy: ALICE, importKey: key, importIndex: 0,
      importHash: computeImportHash(tasks),
    });
    const res = await api("POST", `/workspaces/${WS_A}/tasks/bulk`, ALICE, { tasks, importKey: key });
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).message, /Only part of this import exists/);
  });
});

infraDescribe("ISS-043: task, board and activity lists are bounded and cursor-paged (real MongoDB)", mongoSkip, () => {
  test("120 tasks: pages of 50, 50, 20 in newest-first order, no duplicates; clamp; bad cursor 400", async () => {
    const boardId = await makeBoard();
    const docs = Array.from({ length: 120 }, (_, i) => ({
      workspaceId: WS_A, boardId, title: `T${i}`, createdBy: ALICE,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 3))), // ties on createdAt on purpose
    }));
    await Task.insertMany(docs);
    const expected = (
      await Task.find({ workspaceId: WS_A, boardId }).sort({ createdAt: -1, _id: -1 }).select("_id").lean()
    ).map((t: any) => String(t._id));

    const sizes: number[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/workspaces/${WS_A}/tasks?boardId=${boardId}&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
      const body = await (await api("GET", url, ALICE)).json();
      sizes.push(body.data.length);
      seen.push(...body.data.map((t: any) => t._id));
      cursor = body.meta.nextCursor;
    } while (cursor);
    assert.deepStrictEqual(sizes, [50, 50, 20]);
    assert.deepStrictEqual(seen, expected);

    const all = await (await api("GET", `/workspaces/${WS_A}/tasks?boardId=${boardId}`, ALICE)).json();
    assert.strictEqual(all.data.length, 120, "default page = cap: same data as before");
    assert.deepStrictEqual(all.meta, { limit: 500, nextCursor: null, hasMore: false });
    assert.strictEqual((await (await api("GET", `/workspaces/${WS_A}/tasks?limit=100000`, ALICE)).json()).meta.limit, 500);
    assert.strictEqual((await api("GET", `/workspaces/${WS_A}/tasks?cursor=not-valid!`, ALICE)).status, 400);

    // Root-task filter still works together with paging.
    const roots = await (await api("GET", `/workspaces/${WS_A}/tasks?boardId=${boardId}&parentTaskId=null&limit=10`, ALICE)).json();
    assert.strictEqual(roots.data.length, 10);
    assert.strictEqual(roots.meta.hasMore, true);
  });

  test("boards (oldest first) and activities (newest first) page the same way", async () => {
    const { Board } = await import("../services/task-service/src/models/Board");
    for (let i = 0; i < 5; i++) await makeBoard();
    const boards: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/workspaces/${WS_A}/boards?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const body = await (await api("GET", url, ALICE)).json();
      boards.push(...body.data.map((b: any) => b._id));
      cursor = body.meta.nextCursor;
    } while (cursor);
    const expectedBoards = (await Board.find({ workspaceId: WS_A }).sort({ createdAt: 1, _id: 1 }).lean()).map((b: any) => String(b._id));
    assert.deepStrictEqual(boards, expectedBoards);

    const boardId = expectedBoards[0];
    const task = (await (await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "Edited" })).json()).data;
    for (const priority of ["low", "high", "medium"]) {
      await api("PATCH", `/workspaces/${WS_A}/tasks/${task._id}`, ALICE, { priority });
    }
    const page = await (await api("GET", `/workspaces/${WS_A}/tasks/${task._id}/activities?limit=2`, ALICE)).json();
    assert.strictEqual(page.data.length, 2);
    assert.strictEqual(page.meta.hasMore, true);
    const rest = await (await api("GET", `/workspaces/${WS_A}/tasks/${task._id}/activities?cursor=${page.meta.nextCursor}`, ALICE)).json();
    const all = await (await api("GET", `/workspaces/${WS_A}/tasks/${task._id}/activities`, ALICE)).json();
    assert.deepStrictEqual([...page.data, ...rest.data].map((a: any) => a._id), all.data.map((a: any) => a._id));
  });
});

infraDescribe("P1-A13: membership outcomes through the real task routes", mongoSkip, () => {
  test("malformed workspace id -> 400", async () => {
    assert.strictEqual((await api("GET", `/workspaces/abc/tasks`, ALICE)).status, 400);
  });

  test("workspace-service failing -> 503 (not 403), and no write happens", async () => {
    const boardId = await makeBoard();
    workspaceServiceDown = true;
    assert.strictEqual((await api("GET", `/workspaces/${WS_A}/tasks`, ALICE)).status, 503);
    assert.strictEqual((await api("POST", `/workspaces/${WS_A}/tasks`, ALICE, { boardId, title: "x" })).status, 503);
    assert.strictEqual(await Task.countDocuments({}), 0);
  });

  test("a task of another workspace is not reachable through this workspace (404)", async () => {
    const boardB = await makeBoard(WS_B, MALLORY);
    const taskB = (await (await api("POST", `/workspaces/${WS_B}/tasks`, MALLORY, { boardId: boardB, title: "secret" })).json()).data._id;
    assert.strictEqual((await api("GET", `/workspaces/${WS_A}/tasks/${taskB}`, ALICE)).status, 404);
    assert.strictEqual((await api("DELETE", `/workspaces/${WS_A}/tasks/${taskB}`, ALICE)).status, 404);
    assert.strictEqual(await Task.countDocuments({ _id: taskB }), 1, "not deleted");
  });
});
