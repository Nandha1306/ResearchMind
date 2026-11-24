import assert from "node:assert";
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
 * SEC-012 retrieval side (Wave 3 review M1): a vector can outlive its
 * document -- e.g. an upsert that timed out lands after the deletion removed
 * the document's vectors. Retrieval must never return, prompt with or cite
 * the text of a document that is deleted, missing or in another workspace.
 *
 * REAL ai routes, retrieval, RAG and session code; REAL document-service app
 * (its internal live-documents check) on a disposable MongoDB. Stubbed on the
 * real SDK objects: the Pinecone index (returns planted matches), the Voyage
 * query embedder and the LLM client (records the prompt). No provider call.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

const id = () => new mongoose.Types.ObjectId().toString();
const WS = id();
const OTHER_WS = id();
const USER = id();
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "10m" });

let db: { cleanup: () => Promise<void> } | undefined;
let docApp: { url: string; close: () => Promise<void> } | undefined;
let aiApp: { url: string; close: () => Promise<void> };
let workspaceStub: { url: string; close: () => Promise<void> };
let docRedis: any;
let tmpDir: string;
const prompts: string[] = [];
let matches: any[] = [];
let allMatches: any[] = [];
let lowOnly: any[] = [];
let ids: { live: string; deleted: string; foreign: string; ghost: string };

before(async () => {
  if (mongoSkip) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-retrieval-"));
  process.chdir(tmpDir);
  db = await connectTestDatabase("retrieval");

  workspaceStub = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: true, isOwner: false } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;

  const { Document } = await import("../services/document-service/src/models/Document");
  ({ default: docRedis } = await import("../services/document-service/src/config/redis"));
  const mk = (workspaceId: string, extra: Record<string, unknown> = {}) =>
    Document.create({
      workspaceId,
      uploadedBy: USER,
      originalName: "doc.pdf",
      fileType: "pdf",
      fileSize: 1,
      extractedText: "x",
      embeddingStatus: "indexed",
      ...extra,
    });
  ids = {
    // ISS-029: the source is labelled by this title in the prompt.
    live: (await mk(WS, { originalName: "Retrieval Handbook.pdf" }))._id.toString(),
    deleted: (await mk(WS, { deletedAt: new Date() }))._id.toString(),
    foreign: (await mk(OTHER_WS))._id.toString(),
    ghost: id(), // vectors of a document whose record is gone
  };
  const { default: documentApp } = await import("../services/document-service/src/app");
  docApp = await listen(documentApp);
  process.env.DOCUMENT_SERVICE_URL = docApp.url;

  const match = (documentId: string, text: string, workspaceId = WS, score = 0.9, embeddingModel = "voyage-3") => ({
    id: `${documentId}-chunk-0`,
    score,
    metadata: { documentId, workspaceId, chunkIndex: 0, text, fileType: "pdf", uploadedBy: USER, embeddingModel },
  });
  matches = [
    match(ids.deleted, "SECRET-DELETED text that a late upsert wrote back", WS, 0.99),
    match(ids.live, "Live text about retrieval.", WS, 0.8),
    match(ids.foreign, "FOREIGN workspace text", WS, 0.7),
    match(ids.ghost, "GHOST text of a vanished record", WS, 0.6),
    match(ids.live, "METADATA-OTHER-WS text", OTHER_WS, 0.5),
    // ISS-027: a vector embedded with another model is not comparable.
    match(ids.live, "OTHER-MODEL text embedded with voyage-4", WS, 0.97, "voyage-4"),
    // ISS-028: below MIN_RELEVANCE_SCORE (default 0.2).
    match(ids.live, "LOW-SCORE unrelated text", WS, 0.05),
  ];
  allMatches = matches;
  lowOnly = [match(ids.live, "LOW-SCORE only text", WS, 0.1), match(ids.live, "LOW-SCORE second text", WS, 0.19)];

  const { pineconeIndex } = await import("../services/ai-service/src/config/pinecone");
  (pineconeIndex as any).namespace = () => ({ query: async () => ({ matches: matches }) });
  const voyage = await import("../services/ai-service/src/config/voyage");
  voyage.voyageQueryEmbeddings.embedQuery = async () => Array(voyage.VOYAGE_EMBEDDING_DIMENSION).fill(0.01);
  const { grokClient } = await import("../services/ai-service/src/config/grok");
  (grokClient.chat.completions as any).create = async (params: any) => {
    prompts.push(params.messages.map((m: any) => m.content).join("\n"));
    return (async function* () {
      yield { choices: [{ delta: { content: "Grounded answer [1]." } }] };
    })();
  };

  const { default: aiRoutes } = await import("../services/ai-service/src/routes/ai.routes");
  const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
  const mini = express();
  mini.use(express.json());
  mini.use("/api/ai", aiRoutes);
  mini.use(errorMiddleware);
  aiApp = await listen(mini);
});

after(async () => {
  await aiApp?.close();
  await docApp?.close();
  await workspaceStub?.close();
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

const post = (url: string, body: unknown) =>
  fetch(`${aiApp.url}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const FORBIDDEN = /SECRET-DELETED|FOREIGN|GHOST|METADATA-OTHER-WS|OTHER-MODEL|LOW-SCORE/;

const getSessions = () =>
  fetch(`${aiApp.url}/api/ai/sessions/workspace/${WS}`, { headers: { Authorization: `Bearer ${token}` } });

/** One stored session citing a live and a deleted document (SEC-012 a). */
const seedSession = async () => {
  const { AISession } = await import("../services/ai-service/src/models/AISession");
  await AISession.create({
    workspaceId: WS,
    userId: USER,
    query: "History question",
    answer: "Answer citing [Source 1] and [Source 2].",
    sources: [
      { documentId: ids.live, chunkIndex: 0, score: 0.8 },
      { documentId: ids.deleted, chunkIndex: 3, score: 0.7 },
    ],
    aiModel: "test-model",
  });
};

infraDescribe("SEC-012 (retrieval side): matches of deleted, missing or foreign documents are dropped", mongoSkip, () => {
  test("semantic search returns only the live document of the workspace", async () => {
    const res = await post("/api/ai/search", { workspaceId: WS, query: "retrieval", topK: 10 });
    const text = await res.text();
    assert.strictEqual(res.status, 200, text);
    assert.doesNotMatch(text, FORBIDDEN);
    const results = JSON.parse(text).data;
    assert.deepStrictEqual(results.map((r: any) => r.documentId), [ids.live]);
  });

  test("the streamed answer neither cites nor prompts with deleted text; the saved session has only live sources", async () => {
    prompts.length = 0;
    const res = await post("/api/ai/query", { workspaceId: WS, query: "What about retrieval?", topK: 10 });
    const raw = await res.text();
    assert.strictEqual(res.status, 200);
    assert.doesNotMatch(raw, FORBIDDEN);
    const sources = JSON.parse(/event: sources\ndata: (.*)\n/.exec(raw)![1]).sources;
    assert.deepStrictEqual(sources.map((s: any) => s.documentId), [ids.live]);
    assert.match(raw, /event: done/);
    assert.strictEqual(prompts.length, 1);
    assert.doesNotMatch(prompts[0], FORBIDDEN, "deleted text reached the LLM prompt");
    assert.match(prompts[0], /Live text about retrieval/);

    const { AISession } = await import("../services/ai-service/src/models/AISession");
    const saved = await AISession.find({ workspaceId: WS }).lean();
    assert.ok(saved.length >= 1);
    for (const session of saved) {
      assert.deepStrictEqual(session.sources.map((s: any) => String(s.documentId)), [ids.live]);
    }
  });

  test("ISS-029: the prompt labels the source by its title, not its database id", async () => {
    prompts.length = 0;
    const res = await post("/api/ai/query", { workspaceId: WS, query: "What about retrieval?", topK: 10 });
    await res.text();
    assert.strictEqual(prompts.length, 1);
    assert.match(prompts[0], /title="Retrieval Handbook\.pdf"/);
    assert.ok(!prompts[0].includes(ids.live), "the document's ObjectId reached the prompt");
  });

  test("ISS-029: the internal live-documents route keeps liveDocumentIds and adds liveDocuments titles", async () => {
    const res = await fetch(`${docApp!.url}/internal/documents/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": process.env.INTERNAL_SERVICE_TOKEN! },
      body: JSON.stringify({ workspaceId: WS, documentIds: [ids.live, ids.deleted, ids.foreign, ids.ghost] }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.deepStrictEqual(body.data.liveDocumentIds, [ids.live]);
    assert.deepStrictEqual(body.data.liveDocuments, [{ id: ids.live, name: "Retrieval Handbook.pdf" }]);
  });

  test("ISS-028: when every match is below the relevance threshold, no source is used", async () => {
    prompts.length = 0;
    matches = lowOnly;
    try {
      const res = await post("/api/ai/query", { workspaceId: WS, query: "Unrelated question", topK: 10 });
      const raw = await res.text();
      assert.strictEqual(res.status, 200);
      assert.doesNotMatch(raw, FORBIDDEN);
      const sources = JSON.parse(/event: sources\ndata: (.*)\n/.exec(raw)![1]).sources;
      assert.deepStrictEqual(sources, []);
      assert.strictEqual(prompts.length, 1);
      assert.match(prompts[0], /No relevant document chunks found in this workspace\./);
      assert.doesNotMatch(prompts[0], FORBIDDEN);
    } finally {
      matches = allMatches;
    }
  });

  test("SEC-012a: session history redacts sources of deleted documents in place", async () => {
    await seedSession();
    const res = await getSessions();
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    const session = body.data.find((s: any) => s.query === "History question");
    assert.ok(session, "seeded session returned");
    assert.strictEqual(session.answer, "Answer citing [Source 1] and [Source 2].");
    assert.deepStrictEqual(session.sources, [
      { documentId: ids.live, chunkIndex: 0, score: 0.8 },
      { documentId: "", chunkIndex: 3, score: 0.7, deleted: true },
    ]);
    assert.ok(!JSON.stringify(body).includes(ids.deleted), "deleted document id leaked");
  });

  test("if the live-documents check cannot run, retrieval fails closed (no matches returned)", async () => {
    await docApp!.close();
    docApp = undefined;
    const res = await post("/api/ai/search", { workspaceId: WS, query: "retrieval" });
    const text = await res.text();
    assert.ok(res.status >= 500, `status ${res.status}`);
    assert.doesNotMatch(text, FORBIDDEN);
    assert.doesNotMatch(text, /Live text/);
  });

  test("SEC-012a: if the check cannot run, session history redacts every source (fail closed)", async () => {
    // document-service was closed by the previous test.
    const res = await getSessions();
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    const session = body.data.find((s: any) => s.query === "History question");
    assert.ok(session);
    assert.deepStrictEqual(session.sources, [
      { documentId: "", chunkIndex: 0, score: 0.8, deleted: true },
      { documentId: "", chunkIndex: 3, score: 0.7, deleted: true },
    ]);
  });
});
