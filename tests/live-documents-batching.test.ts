import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { listen, setTestSecrets } from "./helpers/test-env";

/*
 * Wave 6 WP-2 (W5-L1, scope amendments A-20 / R12).
 * A session-history page can cite up to 100 sessions x 10 sources = 1,000
 * distinct documents, but document-service's live check accepts at most 200
 * ids per request (it answers 400 above that, and the whole page used to be
 * redacted, failing closed). ai-service must split the de-duplicated ids into
 * requests of at most 200, keep the workspaceId on every request, merge the
 * answers, and still fail closed when ANY request fails.
 * UNIT: the real fetchLiveDocumentIds and redactDeletedSources against a
 * local stub of document-service that enforces the real request rules.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";

const CAP = 200;
const WS = "665f1c2b9d3e4a0087654321";
const oid = () => crypto.randomBytes(12).toString("hex");

type Seen = { workspaceId: unknown; documentIds: string[] };
let requests: Seen[] = [];
let live = new Set<string>();
let failRequestNumber = 0; // 1-based request number that answers 500; 0 = none

let stub: { url: string; close: () => Promise<void> };
let fetchLiveDocumentIds: typeof import("../services/ai-service/src/services/document-status.service").fetchLiveDocumentIds;
let redactDeletedSources: typeof import("../services/ai-service/src/services/ai-session.service").redactDeletedSources;

before(async () => {
  stub = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      const parsed = JSON.parse(body || "{}");
      requests.push({ workspaceId: parsed.workspaceId, documentIds: parsed.documentIds });
      // Same rules as document-service's liveDocumentsHandler.
      if (
        req.url !== "/internal/documents/live" ||
        req.headers["x-internal-token"] !== process.env.INTERNAL_SERVICE_TOKEN ||
        typeof parsed.workspaceId !== "string" ||
        !Array.isArray(parsed.documentIds) ||
        parsed.documentIds.length > CAP
      ) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: "Invalid live-documents request" }));
        return;
      }
      if (failRequestNumber && requests.length === failRequestNumber) {
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, message: "Internal Server Error" }));
        return;
      }
      const ids = (parsed.documentIds as string[]).filter((id) => live.has(id) && parsed.workspaceId === WS);
      res.end(JSON.stringify({ success: true, data: { liveDocumentIds: ids, liveDocuments: ids.map((id) => ({ id, name: `doc-${id}.pdf` })) } }));
    });
  });
  process.env.DOCUMENT_SERVICE_URL = stub.url;
  ({ fetchLiveDocumentIds } = await import("../services/ai-service/src/services/document-status.service"));
  ({ redactDeletedSources } = await import("../services/ai-service/src/services/ai-session.service"));
});

after(async () => {
  await stub?.close();
});

const reset = (liveIds: string[] = [], failAt = 0) => {
  requests = [];
  live = new Set(liveIds);
  failRequestNumber = failAt;
};

describe("W5-L1: fetchLiveDocumentIds batches to the callee's 200-id cap", () => {
  test("the callee cap is still 200 (not raised to fit the caller)", () => {
    const source = fs.readFileSync(path.join(__dirname, "../services/document-service/src/controllers/document.controller.ts"), "utf8");
    assert.match(source, /const MAX_LIVE_CHECK_IDS = 200;/);
  });

  test("no ids: no request", async () => {
    reset();
    assert.strictEqual((await fetchLiveDocumentIds(WS, [])).size, 0);
    assert.strictEqual(requests.length, 0);
  });

  test("exactly 200 distinct ids: one request", async () => {
    const ids = Array.from({ length: 200 }, oid);
    reset(ids.slice(0, 7));
    const result = await fetchLiveDocumentIds(WS, ids);
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].documentIds.length, 200);
    assert.deepStrictEqual([...result.keys()].sort(), ids.slice(0, 7).sort());
  });

  test("450 distinct ids: requests of 200, 200 and 50, each with the workspaceId; answers merged", async () => {
    const ids = Array.from({ length: 450 }, oid);
    const liveIds = ids.filter((_, i) => i % 3 === 0); // spread over every chunk
    reset(liveIds);
    const result = await fetchLiveDocumentIds(WS, ids);
    assert.deepStrictEqual(requests.map((r) => r.documentIds.length), [200, 200, 50]);
    for (const r of requests) {
      assert.strictEqual(r.workspaceId, WS);
      assert.ok(r.documentIds.length <= CAP);
    }
    assert.deepStrictEqual(requests.flatMap((r) => r.documentIds).sort(), [...ids].sort());
    assert.deepStrictEqual([...result.keys()].sort(), [...liveIds].sort());
    for (const id of liveIds) assert.strictEqual(result.get(id), `doc-${id}.pdf`);
  });

  test("an id cited many times is sent once (de-duplicated before batching)", async () => {
    const ids = Array.from({ length: 250 }, oid);
    reset(ids);
    const repeated = [...ids, ...ids, ...ids, ...ids];
    await fetchLiveDocumentIds(WS, repeated);
    const sent = requests.flatMap((r) => r.documentIds);
    assert.strictEqual(sent.length, 250);
    assert.strictEqual(new Set(sent).size, 250);
    assert.deepStrictEqual(requests.map((r) => r.documentIds.length), [200, 50]);
  });

  test("any failed request makes the whole check fail (fail closed)", async () => {
    const ids = Array.from({ length: 450 }, oid);
    reset(ids, 2);
    await assert.rejects(fetchLiveDocumentIds(WS, ids));
  });
});

describe("W5-L1: a history page citing more than 200 documents keeps its live sources", () => {
  const page = (perSession: number, sessions: number) => {
    const all: string[] = [];
    const rows = Array.from({ length: sessions }, (_, s) => ({
      query: `q${s}`,
      sources: Array.from({ length: perSession }, (_, k) => {
        const documentId = oid();
        all.push(documentId);
        return { documentId, chunkIndex: k, score: 0.5 };
      }),
    }));
    return { rows, all };
  };

  test("30 sessions x 10 distinct sources (300 ids): live kept in place, deleted redacted", async (t) => {
    t.mock.method(console, "warn", () => {});
    const { rows, all } = page(10, 30);
    const liveIds = all.filter((_, i) => i % 2 === 0);
    reset(liveIds);
    const out = await redactDeletedSources(rows as any[], WS, fetchLiveDocumentIds);
    assert.deepStrictEqual(requests.map((r) => r.documentIds.length), [200, 100]);
    const liveSet = new Set(liveIds);
    out.forEach((session: any, s: number) => {
      session.sources.forEach((src: any, k: number) => {
        const original = rows[s].sources[k];
        if (liveSet.has(original.documentId)) {
          assert.deepStrictEqual(src, { documentId: original.documentId, chunkIndex: k, score: 0.5 });
        } else {
          assert.deepStrictEqual(src, { documentId: "", chunkIndex: k, score: 0.5, deleted: true });
        }
      });
    });
  });

  test("one failed chunk redacts EVERY source on the page (no partial result)", async (t) => {
    const warnings: string[] = [];
    t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args.map(String).join(" ")));
    const { rows, all } = page(10, 30);
    reset(all, 2); // every id is live, but the second request fails
    const out = await redactDeletedSources(rows as any[], WS, fetchLiveDocumentIds);
    assert.ok(requests.length >= 2);
    for (const session of out as any[]) {
      for (const src of session.sources) assert.strictEqual(src.deleted, true);
    }
    assert.strictEqual(warnings.length, 1);
  });
});
