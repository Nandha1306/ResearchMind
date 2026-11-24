import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe, before, after, beforeEach } from "node:test";
import { infraDescribe } from "./helpers/infra";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Redis from "ioredis";
import { setTestSecrets, listen } from "./helpers/test-env";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";
import { REDIS_DB_OFFSETS, redisSkip, deleteKeys, testRedisUrlFor } from "./helpers/test-redis";
import { rawRequest, startGateway } from "./helpers/gateway";

/*
 * SEC-006/ARC-007 + ISS-037 with real infrastructure: disposable MongoDB and
 * a disposable Redis (TEST_REDIS_URL host, database index base + 1 -- this
 * file's own, see helpers/test-redis.ts; only the embedding queue key and
 * rl:* keys are ever deleted).
 *
 * REAL document-service app (producer, claim, text and status endpoints),
 * REAL ai-service worker code and its document-service client. Stubbed: the
 * embedding provider and the vector store (injected deps), Cloudinary
 * uploader, workspace membership.
 */

setTestSecrets();
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";

const QUEUE = "researchmind:embedding:jobs";
const WS = new mongoose.Types.ObjectId().toString();
const OTHER_WS = new mongoose.Types.ObjectId().toString();
const USER = new mongoose.Types.ObjectId().toString();
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "10m" });
const INTERNAL = () => ({ "X-Internal-Token": process.env.INTERNAL_SERVICE_TOKEN! });

const skip = mongoSkip || redisSkip;

let redisUrl = "";
let direct: Redis;
let workspaceStub: { url: string; close: () => Promise<void> };
let docApp: { url: string; close: () => Promise<void> };
let gateway: Awaited<ReturnType<typeof startGateway>>;
let db: { cleanup: () => Promise<void> } | undefined;
let Document: any;
let docRedis: any;
let recoverEmbeddingWork: any;
let worker: typeof import("../services/ai-service/src/workers/embedding.worker");
let redisWorker: any;
let tmpDir: string;

before(async () => {
  if (skip) return;
  // Wave 6 (W6-TEST-02): base + 1 of TEST_REDIS_URL's index (was a fixed /8).
  redisUrl = testRedisUrlFor(REDIS_DB_OFFSETS.embeddingJobs);
  process.env.REDIS_URL = redisUrl;
  direct = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await direct.del(QUEUE);

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-pointer-jobs-"));
  process.chdir(tmpDir);

  workspaceStub = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: true } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;

  db = await connectTestDatabase("pointerjobs");
  const { default: cloudinary } = await import("../services/document-service/src/config/cloudinary");
  cloudinary.uploader.upload = (async (_file: string, options: Record<string, any>) => ({
    public_id: `${options.folder}/${options.public_id}`,
    resource_type: options.resource_type,
    type: options.type,
  })) as any;
  ({ default: docRedis } = await import("../services/document-service/src/config/redis"));
  ({ Document } = await import("../services/document-service/src/models/Document"));
  ({ recoverEmbeddingWork } = await import("../services/document-service/src/services/document.service"));
  await Document.init();
  const { default: documentApp } = await import("../services/document-service/src/app");
  docApp = await listen(documentApp);

  process.env.DOCUMENT_SERVICE_URL = docApp.url;
  worker = await import("../services/ai-service/src/workers/embedding.worker");
  ({ default: redisWorker } = await import("../services/ai-service/src/config/redis-worker"));
  gateway = await startGateway();
});

after(async () => {
  if (worker) await worker.stopEmbeddingWorker().catch(() => {});
  await gateway?.close();
  await docApp?.close();
  await workspaceStub?.close();
  docRedis?.disconnect();
  redisWorker?.disconnect();
  if (direct) {
    await direct.del(QUEUE).catch(() => {});
    await deleteKeys(direct, "rl:*").catch(() => {});
    direct.disconnect();
  }
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

beforeEach(async () => {
  if (!skip) await direct.del(QUEUE);
});

/** Minimal single-page PDF whose text contains `marker`. */
const pdfWith = (marker: string) => {
  const content = `BT /F1 12 Tf 72 720 Td (${marker}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
};

const upload = async (marker: string) => {
  const form = new FormData();
  form.append("workspaceId", WS);
  form.append("file", new Blob([new Uint8Array(pdfWith(marker))]), "paper.pdf");
  const res = await fetch(`${docApp.url}/api/documents/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  assert.strictEqual(res.status, 201, JSON.stringify(body));
  return body.data._id as string;
};

const assertPointerEntries = (entries: string[], marker: string) => {
  for (const entry of entries) {
    assert.ok(Buffer.byteLength(entry) < 256, `entry is ${Buffer.byteLength(entry)} bytes`);
    assert.deepStrictEqual(Object.keys(JSON.parse(entry)).sort(), ["documentId", "workspaceId"]);
    assert.ok(!entry.includes(marker), "document text written to Redis");
  }
};

const insertDocument = (fields: Record<string, unknown> = {}) =>
  Document.create({
    workspaceId: WS,
    uploadedBy: USER,
    originalName: "stored.pdf",
    fileType: "pdf",
    fileSize: 10,
    extractedText: `STORED-${crypto.randomBytes(4).toString("hex")} text of the document.`,
    embeddingStatus: "pending",
    ...fields,
  });

const claim = async (id: string) => {
  const res = await fetch(`${docApp.url}/internal/documents/${id}/embedding/claim`, { method: "POST", headers: INTERNAL() });
  return (await res.json()).data as { claimToken: number; workspaceId: string };
};

const source = (id: string, query: Record<string, string>, headers: Record<string, string> = INTERNAL()) =>
  fetch(`${docApp.url}/internal/documents/${id}/embedding-source?${new URLSearchParams(query)}`, { headers });

const fakeProviders = (record: { upserts: any[] }, overrides: Record<string, any> = {}) => ({
  ...worker.defaultEmbeddingJobDeps,
  embed: async (texts: string[]) => texts.map((_t, index) => ({ index, embedding: [0.1, 0.2] })),
  deleteVectors: async () => {},
  upsertVectors: async (input: any) => {
    record.upserts.push(input);
    return { documentId: input.documentId, workspaceId: input.workspaceId, vectorCount: input.chunks.length };
  },
  ...overrides,
});

const waitFor = async (what: string, condition: () => Promise<boolean>, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
};

infraDescribe("SEC-006: queue entries are pointers (real Redis)", skip, () => {
  test("upload, re-index and the recovery sweep enqueue only {documentId, workspaceId}", async () => {
    const marker = `MARK${crypto.randomBytes(6).toString("hex")}`;
    const id = await upload(marker);
    assert.match((await Document.findById(id).lean()).extractedText, new RegExp(marker), "text was extracted");
    let entries = await direct.lrange(QUEUE, 0, -1);
    assert.strictEqual(entries.length, 1);
    assertPointerEntries(entries, marker);
    assert.deepStrictEqual(JSON.parse(entries[0]), { documentId: id, workspaceId: WS });

    await direct.del(QUEUE);
    await Document.updateOne({ _id: id }, { $set: { embeddingStatus: "failed" } });
    const reindex = await fetch(`${docApp.url}/api/documents/${id}/reindex`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(reindex.status, 200);
    entries = await direct.lrange(QUEUE, 0, -1);
    assert.strictEqual(entries.length, 1);
    assertPointerEntries(entries, marker);

    await direct.del(QUEUE);
    await Document.updateOne({ _id: id }, { $set: { embeddingStatus: "pending", updatedAt: new Date(Date.now() - 60 * 60 * 1000) } }, { timestamps: false });
    const summary = await recoverEmbeddingWork();
    assert.ok(summary.requeued >= 1);
    entries = await direct.lrange(QUEUE, 0, -1);
    assertPointerEntries(entries, marker);
    assert.ok(entries.some((e) => JSON.parse(e).documentId === id));
  });
});

infraDescribe("SEC-006: internal text endpoint (real MongoDB)", skip, () => {
  test("refuses a missing or wrong secret, malformed input, unknown, deleted, cross-workspace and stale-claim requests", async () => {
    const doc = await insertDocument();
    const id = doc._id.toString();
    const { claimToken } = await claim(id);
    const ok = { workspaceId: WS, claimToken: String(claimToken) };

    assert.strictEqual((await source(id, ok, {})).status, 401);
    assert.strictEqual((await source(id, ok, { "X-Internal-Token": "wrong".repeat(10) })).status, 401);
    assert.strictEqual((await source(id, { workspaceId: WS, claimToken: "abc" })).status, 400);
    assert.strictEqual((await source("not-an-id", ok)).status, 400);
    assert.strictEqual((await source(new mongoose.Types.ObjectId().toString(), ok)).status, 404);

    const mismatch = await source(id, { ...ok, workspaceId: OTHER_WS });
    assert.strictEqual(mismatch.status, 403);
    assert.strictEqual((await mismatch.json()).reason, "workspace-mismatch");
    const stale = await source(id, { ...ok, claimToken: String(claimToken - 1) });
    assert.strictEqual(stale.status, 409);

    const good = await source(id, ok);
    assert.strictEqual(good.status, 200);
    assert.strictEqual(good.headers.get("cache-control"), "no-store");
    const body = await good.json();
    assert.deepStrictEqual(
      { ...body.data, documentId: String(body.data.documentId) },
      { documentId: id, workspaceId: WS, uploadedBy: USER, fileType: "pdf", extractedText: doc.extractedText }
    );

    await Document.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
    assert.strictEqual((await source(id, ok)).status, 410);
  });

  test("the gateway never routes to the internal surface", async () => {
    const doc = await insertDocument();
    const id = doc._id.toString();
    const { claimToken } = await claim(id);
    const query = `workspaceId=${WS}&claimToken=${claimToken}`;
    for (const target of [
      `/api/documents/internal/documents/${id}/embedding-source?${query}`,
      `/internal/documents/${id}/embedding-source?${query}`,
      `/api/documents/../internal/documents/${id}/embedding-source?${query}`,
    ]) {
      const res = await rawRequest(gateway.port, "GET", target, {
        headers: { Authorization: `Bearer ${token}`, ...INTERNAL() },
      });
      assert.ok([400, 403, 404].includes(res.status), `${target} -> ${res.status}`);
      assert.ok(!res.body.includes(doc.extractedText), `${target} returned the text`);
    }
  });
});

infraDescribe("SEC-006 + ISS-037: the real worker with real document-service (stubbed providers)", skip, () => {
  test("a pointer job is processed end to end from the stored text", async () => {
    const doc = await insertDocument();
    const record = { upserts: [] as any[] };
    const outcome = await worker.processEmbeddingJob(
      { documentId: doc._id.toString(), workspaceId: WS },
      fakeProviders(record) as any
    );
    assert.strictEqual(outcome, "indexed");
    assert.strictEqual((await Document.findById(doc._id).lean()).embeddingStatus, "indexed");
    const written = record.upserts[0].chunks.map((c: any) => c.text).join(" ");
    assert.ok(written.includes(doc.extractedText.split(" ")[0]), "stored text embedded");
    assert.strictEqual(record.upserts[0].uploadedBy, USER);
  });

  test("the running worker handles a legacy text-carrying entry from the queue, ignoring its text", async () => {
    const doc = await insertDocument();
    const record = { upserts: [] as any[] };
    await direct.rpush(
      QUEUE,
      JSON.stringify({
        documentId: doc._id.toString(),
        workspaceId: WS,
        uploadedBy: "attacker",
        fileType: "docx",
        extractedText: "INJECTED legacy text",
      })
    );
    void worker.startEmbeddingWorker({ deps: fakeProviders(record) as any, errorBackoffMs: 10 });
    try {
      await waitFor("the legacy job to be indexed", async () =>
        (await Document.findById(doc._id).lean()).embeddingStatus === "indexed"
      );
    } finally {
      await worker.stopEmbeddingWorker();
    }
    assert.ok(!JSON.stringify(record.upserts).includes("INJECTED"));
    assert.strictEqual(record.upserts[0].uploadedBy, USER);
    assert.strictEqual(record.upserts[0].fileType, "pdf");
  });

  test("ISS-037: a hung provider fails its job at the deadline and the worker goes on to the next job", async () => {
    const hung = await insertDocument();
    const next = await insertDocument();
    const record = { upserts: [] as any[] };
    const deps = fakeProviders(record, {
      embed: async (texts: string[]) => {
        if (texts.join(" ").includes(hung.extractedText.split(" ")[0])) return new Promise(() => {}); // never answers
        return texts.map((_t, index) => ({ index, embedding: [0.1, 0.2] }));
      },
    });
    await direct.rpush(QUEUE, JSON.stringify({ documentId: hung._id.toString(), workspaceId: WS }));
    await direct.rpush(QUEUE, JSON.stringify({ documentId: next._id.toString(), workspaceId: WS }));
    const started = Date.now();
    void worker.startEmbeddingWorker({ deps: deps as any, jobTimeoutMs: 500, errorBackoffMs: 10 });
    try {
      await waitFor("the next job to be indexed", async () =>
        (await Document.findById(next._id).lean()).embeddingStatus === "indexed"
      );
    } finally {
      await worker.stopEmbeddingWorker();
    }
    assert.ok(Date.now() - started < 10_000);
    const hungAfter = await Document.findById(hung._id).lean();
    assert.strictEqual(hungAfter.embeddingStatus, "failed");
    assert.match(hungAfter.embeddingError, /timed out/);
    assert.ok(!record.upserts.some((u) => u.documentId === hung._id.toString()), "vectors written after the deadline");
  });

  test("ISS-037: a late report from a timed-out claim is fenced out after the document was claimed again", async () => {
    const doc = await insertDocument();
    const id = doc._id.toString();
    const first = await claim(id);
    // The claim goes stale and another worker claims it again.
    await Document.updateOne({ _id: id }, { $set: { indexingStartedAt: new Date(Date.now() - 16 * 60 * 1000) } });
    const second = await claim(id);
    assert.ok(second.claimToken > first.claimToken);

    const { updateDocumentEmbeddingStatus, isClaimSupersededError } = await import(
      "../services/ai-service/src/services/document-status.service"
    );
    await assert.rejects(updateDocumentEmbeddingStatus(id, "indexed", undefined, first.claimToken), (e) => isClaimSupersededError(e));
    await assert.rejects(updateDocumentEmbeddingStatus(id, "failed", "Embedding timed out", first.claimToken), (e) => isClaimSupersededError(e));
    const current = await Document.findById(id).lean();
    assert.strictEqual(current.embeddingStatus, "indexing");
    assert.strictEqual(current.claimSequence, second.claimToken);
  });
});
