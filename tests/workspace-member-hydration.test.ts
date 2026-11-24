import assert from "node:assert";
import http from "node:http";
import { describe, test, before, after } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";
import { infraDescribe } from "./helpers/infra";

/*
 * ARC-004: member-name hydration (workspace-service -> auth-service) is
 * bounded (3 s) and no longer silent. REAL workspace-service app on a
 * disposable MongoDB; auth-service replaced by a stub whose behaviour each
 * test chooses. Members are always returned, with placeholder names when
 * the lookup cannot be used.
 */

setTestSecrets();

const OWNER = new mongoose.Types.ObjectId().toString();
const MEMBER = new mongoose.Types.ObjectId().toString();
const tokenFor = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

let db: { cleanup: () => Promise<void> } | undefined;
let app: { url: string; close: () => Promise<void> };
let authStub: { url: string; close: () => Promise<void> };
let behaviour: "hang" | "401" | "ok" = "ok";
const hanging = new Set<http.ServerResponse>();
let workspaceId = "";

before(async () => {
  if (mongoSkip) return;
  authStub = await listen((_req, res) => {
    if (behaviour === "hang") {
      hanging.add(res);
      return;
    }
    if (behaviour === "401") {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        data: [
          { userId: OWNER, name: "Real Name", email: "o@example.test" },
          { userId: MEMBER, name: "Member Name", email: "m@example.test" },
        ],
      })
    );
  });
  process.env.AUTH_SERVICE_URL = authStub.url;
  db = await connectTestDatabase("hydration");
  const { default: workspaceApp } = await import("../services/workspace-service/src/app");
  app = await listen(workspaceApp);
  const created = await fetch(`${app.url}/api/workspaces`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Hydration Lab" }),
  });
  workspaceId = (await created.json()).data._id;
});

after(async () => {
  for (const res of hanging) res.destroy();
  await app?.close();
  await authStub?.close();
  await db?.cleanup();
});

const members = async () => {
  const started = Date.now();
  const res = await fetch(`${app.url}/api/workspaces/${workspaceId}/members`, {
    headers: { Authorization: `Bearer ${tokenFor(OWNER)}` },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.json(), ms: Date.now() - started };
};

const captureWarnings = (t: any) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args.map(String).join(" ")));
  return warnings;
};

infraDescribe("ARC-004: member hydration is bounded and logged (real MongoDB)", mongoSkip, () => {
  test("without INTERNAL_SERVICE_TOKEN: placeholders and one warning per process", async (t) => {
    const saved = process.env.INTERNAL_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const warnings = captureWarnings(t);
    try {
      const first = await members();
      await members();
      assert.strictEqual(first.status, 200);
      assert.deepStrictEqual(first.body.data.map((m: any) => m.name), ["Researcher"]);
      assert.strictEqual(warnings.filter((w) => w.includes("INTERNAL_SERVICE_TOKEN")).length, 1);
    } finally {
      process.env.INTERNAL_SERVICE_TOKEN = saved;
    }
  });

  test("auth-service never answers: placeholders within the 3 s limit, with a warning", async (t) => {
    behaviour = "hang";
    const warnings = captureWarnings(t);
    const result = await members();
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body.data.map((m: any) => m.name), ["Researcher"]);
    assert.ok(result.ms >= 2500 && result.ms < 3500 + 1000, `took ${result.ms} ms`);
    assert.ok(warnings.some((w) => /Member name lookup failed: (TimeoutError|AbortError)/.test(w)), warnings.join("\n"));
  });

  test("auth-service answers 401: placeholders and a warning with the status only", async (t) => {
    behaviour = "401";
    const warnings = captureWarnings(t);
    const result = await members();
    assert.deepStrictEqual(result.body.data.map((m: any) => m.name), ["Researcher"]);
    assert.ok(warnings.some((w) => w.includes("answered 401")));
  });

  test("auth-service answers: real names", async () => {
    behaviour = "ok";
    const result = await members();
    assert.deepStrictEqual(result.body.data.map((m: any) => m.name), ["Real Name"]);
  });
});

/*
 * SEC-018 (user decision): a member's e-mail is shown only to the workspace
 * owner and to the member themself; everyone else gets "" (names stay
 * visible). Runs after the ARC-004 cases: it adds a second member.
 */
infraDescribe("SEC-018: member e-mail visibility (real MongoDB)", mongoSkip, () => {
  test("the owner sees every e-mail; a member sees only their own; names are visible to both", async () => {
    behaviour = "ok";
    const { Workspace } = await import("../services/workspace-service/src/models/Workspace");
    await Workspace.updateOne({ _id: workspaceId }, { $addToSet: { members: MEMBER } });
    const as = async (userId: string) => {
      const res = await fetch(`${app.url}/api/workspaces/${workspaceId}/members`, {
        headers: { Authorization: `Bearer ${tokenFor(userId)}` },
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()).data as Array<{ userId: string; name: string; email: string }>;
      return Object.fromEntries(data.map((m) => [m.userId, m]));
    };
    const ownerView = await as(OWNER);
    assert.strictEqual(ownerView[OWNER].email, "o@example.test");
    assert.strictEqual(ownerView[MEMBER].email, "m@example.test");
    const memberView = await as(MEMBER);
    assert.strictEqual(memberView[MEMBER].email, "m@example.test", "own e-mail");
    assert.strictEqual(memberView[OWNER].email, "", "the owner's e-mail is hidden from a member");
    assert.strictEqual(memberView[OWNER].name, "Real Name");
    assert.strictEqual(memberView[MEMBER].name, "Member Name");
  });
});

describe("ARC-004 module constant", () => {
  test("the hydration limit is 3 s", async () => {
    const { MEMBER_HYDRATION_TIMEOUT_MS } = await import("../services/workspace-service/src/services/workspace.service");
    assert.strictEqual(MEMBER_HYDRATION_TIMEOUT_MS, 3000);
  });
});
