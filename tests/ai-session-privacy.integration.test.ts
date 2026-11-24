import assert from "node:assert";
import { test, before, after } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { infraDescribe } from "./helpers/infra";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * SEC-023 (user decision): the AI question history is private to the person
 * who asked -- every member, the owner included, sees only their own
 * sessions. The list is cursor-paged with the Wave 4 helpers (default 20,
 * cap 100, additive meta). REAL ai routes on a disposable MongoDB; the
 * workspace-service membership answer and document-service's live check are
 * local stubs. No provider call.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

const id = () => new mongoose.Types.ObjectId().toString();
const WS = id();
const OWNER = id();
const MEMBER_A = id();
const MEMBER_B = id();
const REMOVED = id();
const MEMBERS = [OWNER, MEMBER_A, MEMBER_B];
const LIVE_DOC = id();
const DELETED_DOC = id();
// Wave 6 (W5-L1): a member whose newest page cites 300 distinct documents.
const MEMBER_C = id();
MEMBERS.push(MEMBER_C);
const MANY_SOURCES = Array.from({ length: 30 }, () => Array.from({ length: 10 }, () => id()));
const MANY_LIVE = new Set(MANY_SOURCES.flat().filter((_, i) => i % 2 === 0));
const liveRequestSizes: number[] = [];
const tokenFor = (userId: string) => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

let db: { cleanup: () => Promise<void> } | undefined;
let aiApp: { url: string; close: () => Promise<void> };
let workspaceStub: { url: string; close: () => Promise<void> };
let docStub: { url: string; close: () => Promise<void> };
let AISession: any;

before(async () => {
  if (mongoSkip) return;
  db = await connectTestDatabase("aisessions");
  workspaceStub = await listen((req, res) => {
    let userId = "";
    try {
      userId = (jwt.verify(String(req.headers.authorization).replace(/^Bearer /, ""), process.env.JWT_ACCESS_SECRET!) as any).userId;
    } catch {
      /* not a member */
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: MEMBERS.includes(userId), isOwner: userId === OWNER } }));
  });
  docStub = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ids: string[] = JSON.parse(body || "{}").documentIds ?? [];
      res.setHeader("Content-Type", "application/json");
      liveRequestSizes.push(ids.length);
      // Wave 6 (W5-L1): the same 200-id cap as document-service's real handler.
      if (ids.length > 200) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: "Invalid live-documents request" }));
        return;
      }
      const live = ids.filter((d) => d === LIVE_DOC || MANY_LIVE.has(d));
      res.end(JSON.stringify({ success: true, data: { liveDocumentIds: live, liveDocuments: live.map((d) => ({ id: d, name: "Live.pdf" })) } }));
    });
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;
  process.env.DOCUMENT_SERVICE_URL = docStub.url;
  ({ AISession } = await import("../services/ai-service/src/models/AISession"));
  await AISession.init();
  const { default: aiRoutes } = await import("../services/ai-service/src/routes/ai.routes");
  const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
  const mini = express();
  mini.use(express.json());
  mini.use("/api/ai", aiRoutes);
  mini.use(errorMiddleware);
  aiApp = await listen(mini);

  const base = Date.now() - 1_000_000;
  const rows = [
    { userId: OWNER, query: "OWNER-PRIVATE question" },
    { userId: MEMBER_A, query: "A-PRIVATE question", sources: [{ documentId: DELETED_DOC, chunkIndex: 1, score: 0.5 }, { documentId: LIVE_DOC, chunkIndex: 0, score: 0.9 }] },
    ...Array.from({ length: 25 }, (_, i) => ({ userId: MEMBER_B, query: `B question ${i}` })),
    ...MANY_SOURCES.map((docs, i) => ({
      userId: MEMBER_C,
      query: `C question ${i}`,
      sources: docs.map((documentId, k) => ({ documentId, chunkIndex: k, score: 0.5 })),
    })),
  ].map((row, i) => ({
    workspaceId: WS,
    answer: "answer",
    sources: [],
    aiModel: "test-model",
    ...row,
    createdAt: new Date(base + i * 1000),
    updatedAt: new Date(base + i * 1000),
  }));
  await AISession.collection.insertMany(rows);
});

after(async () => {
  await aiApp?.close();
  await workspaceStub?.close();
  await docStub?.close();
  await db?.cleanup();
});

const sessions = async (userId: string, query = "") => {
  const res = await fetch(`${aiApp.url}/api/ai/sessions/workspace/${WS}${query}`, { headers: { Authorization: `Bearer ${tokenFor(userId)}` } });
  return { status: res.status, body: await res.json() };
};

infraDescribe("SEC-023: AI history is private to the asking user (real MongoDB)", mongoSkip, () => {
  test("each member, the owner included, sees only their own sessions", async () => {
    const owner = await sessions(OWNER);
    assert.strictEqual(owner.status, 200);
    assert.deepStrictEqual(owner.body.data.map((s: any) => s.query), ["OWNER-PRIVATE question"]);
    const a = await sessions(MEMBER_A);
    assert.deepStrictEqual(a.body.data.map((s: any) => s.query), ["A-PRIVATE question"]);
    const b = await sessions(MEMBER_B);
    assert.ok(b.body.data.every((s: any) => s.userId === MEMBER_B));
    assert.ok(!JSON.stringify(b.body).includes("PRIVATE"));
  });

  test("paging: default 20 newest first with meta; limit walks without overlap; clamp to 100; bad limit or cursor 400", async () => {
    const first = await sessions(MEMBER_B);
    assert.strictEqual(first.body.data.length, 20);
    assert.deepStrictEqual(first.body.meta.limit, 20);
    assert.strictEqual(first.body.meta.hasMore, true);
    assert.strictEqual(first.body.data[0].query, "B question 24");

    const seen: string[] = [];
    let cursor = "";
    const sizes: number[] = [];
    for (;;) {
      const page = await sessions(MEMBER_B, `?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.strictEqual(page.status, 200);
      sizes.push(page.body.data.length);
      seen.push(...page.body.data.map((s: any) => s.query));
      if (!page.body.meta.hasMore) break;
      cursor = page.body.meta.nextCursor;
    }
    assert.deepStrictEqual(sizes, [10, 10, 5]);
    assert.strictEqual(new Set(seen).size, 25);
    assert.strictEqual(seen[0], "B question 24");

    const clamped = await sessions(MEMBER_B, "?limit=1000");
    assert.strictEqual(clamped.body.meta.limit, 100);
    assert.strictEqual(clamped.body.data.length, 25);
    assert.strictEqual((await sessions(MEMBER_B, "?limit=0")).status, 400);
    assert.strictEqual((await sessions(MEMBER_B, "?cursor=not-a-cursor")).status, 400);
  });

  test("SEC-012 redaction still applies to the caller's own sessions", async () => {
    const a = await sessions(MEMBER_A);
    assert.deepStrictEqual(a.body.data[0].sources, [
      { documentId: "", chunkIndex: 1, score: 0.5, deleted: true },
      { documentId: LIVE_DOC, chunkIndex: 0, score: 0.9 },
    ]);
  });

  test("W5-L1: a page citing 300 distinct documents keeps live sources (liveness checked in requests of <= 200)", async () => {
    liveRequestSizes.length = 0;
    const c = await sessions(MEMBER_C, "?limit=30");
    assert.strictEqual(c.status, 200);
    assert.strictEqual(c.body.data.length, 30);
    assert.deepStrictEqual([...liveRequestSizes].sort((a, b) => b - a), [200, 100]);
    let kept = 0;
    let redacted = 0;
    for (const session of c.body.data) {
      const i = Number(String(session.query).replace("C question ", ""));
      session.sources.forEach((src: any, k: number) => {
        const original = MANY_SOURCES[i][k];
        if (MANY_LIVE.has(original)) {
          assert.deepStrictEqual(src, { documentId: original, chunkIndex: k, score: 0.5 });
          kept++;
        } else {
          assert.deepStrictEqual(src, { documentId: "", chunkIndex: k, score: 0.5, deleted: true });
          redacted++;
        }
      });
    }
    assert.strictEqual(kept, 150);
    assert.strictEqual(redacted, 150);
  });

  test("a non-member (e.g. a removed member) still gets 403", async () => {
    assert.strictEqual((await sessions(REMOVED)).status, 403);
  });
});
