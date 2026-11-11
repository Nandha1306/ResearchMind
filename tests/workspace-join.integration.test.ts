import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setTestSecrets, listen } from "./helpers/test-env";
import { mongoSkip, connectTestDatabase } from "./helpers/test-mongo";

/*
 * P1-A18 -- joining a workspace with an invite code. INTEGRATION: the real
 * workspace-service app against a real MongoDB.
 *
 * Invite codes do not expire in this product (there is no expiry field), so
 * there is no "expired code" case to test.
 */

setTestSecrets();

const id = () => new mongoose.Types.ObjectId().toString();
const OWNER = id();
const JOINER = id();

let db: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;
let app: { url: string; close: () => Promise<void> };
let Workspace: any;

const tokenFor = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

const api = (method: string, path: string, userId?: string, body?: unknown) =>
  fetch(`${app.url}/api/workspaces${path}`, {
    method,
    headers: {
      ...(userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

before(async () => {
  if (mongoSkip) return;
  db = await connectTestDatabase("join");
  ({ Workspace } = await import("../services/workspace-service/src/models/Workspace"));
  await Workspace.syncIndexes();
  const { default: workspaceApp } = await import("../services/workspace-service/src/app");
  app = await listen(workspaceApp);
});

after(async () => {
  await app?.close();
  await db?.cleanup();
});

const createWorkspace = async () => {
  const res = await api("POST", "/", OWNER, { name: "Research Group" });
  assert.strictEqual(res.status, 201);
  return (await res.json()).data as { _id: string; inviteCode: string };
};

describe("P1-A18: joining a workspace (real MongoDB)", { skip: mongoSkip }, () => {
  test("a valid code typed in lower case with spaces joins the right workspace", async () => {
    const ws = await createWorkspace();
    const res = await api("POST", "/join", JOINER, { inviteCode: `  ${ws.inviteCode.toLowerCase()} ` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data._id, ws._id);
    const listed = (await (await api("GET", "/", JOINER)).json()).data;
    assert.ok(listed.some((w: any) => w._id === ws._id), "the workspace list reflects the join");
    const membership = (await (await api("GET", `/${ws._id}/membership`, JOINER)).json()).data;
    assert.strictEqual(membership.isMember, true);
  });

  test("joining again is 409 and changes nothing", async () => {
    const ws = await createWorkspace();
    await api("POST", "/join", JOINER, { inviteCode: ws.inviteCode });
    const again = await api("POST", "/join", JOINER, { inviteCode: ws.inviteCode });
    assert.strictEqual(again.status, 409);
    const stored = await Workspace.findById(ws._id).lean();
    assert.strictEqual(stored.members.filter((m: string) => m === JOINER).length, 1);
  });

  test("the owner (already a member) gets 409, not a duplicate entry", async () => {
    const ws = await createWorkspace();
    assert.strictEqual((await api("POST", "/join", OWNER, { inviteCode: ws.inviteCode })).status, 409);
  });

  test("an unknown code is 404; an empty or oversized code is 400", async () => {
    assert.strictEqual((await api("POST", "/join", JOINER, { inviteCode: "ZZZZZZZZ" })).status, 404);
    assert.strictEqual((await api("POST", "/join", JOINER, { inviteCode: "   " })).status, 400);
    assert.strictEqual((await api("POST", "/join", JOINER, { inviteCode: "A".repeat(65) })).status, 400);
  });

  test("an unauthenticated join is 401", async () => {
    const ws = await createWorkspace();
    assert.strictEqual((await api("POST", "/join", undefined, { inviteCode: ws.inviteCode })).status, 401);
  });

  test("10 concurrent joins by the same user leave exactly one membership", async () => {
    const ws = await createWorkspace();
    const user = id();
    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => api("POST", "/join", user, { inviteCode: ws.inviteCode }).then((r) => r.status))
    );
    assert.strictEqual(statuses.filter((s) => s === 200).length, 1, statuses.join(","));
    assert.strictEqual(statuses.filter((s) => s === 409).length, 9);
    const stored = await Workspace.findById(ws._id).lean();
    assert.strictEqual(stored.members.filter((m: string) => m === user).length, 1);
  });

  test("a non-member cannot read a workspace or its members (404 'not found or access denied')", async () => {
    const ws = await createWorkspace();
    const outsider = id();
    assert.strictEqual((await api("GET", `/${ws._id}`, outsider)).status, 404);
    assert.strictEqual((await api("GET", `/${ws._id}/members`, outsider)).status, 404);
    assert.strictEqual((await (await api("GET", `/${ws._id}/membership`, outsider)).json()).data.isMember, false);
  });
});
