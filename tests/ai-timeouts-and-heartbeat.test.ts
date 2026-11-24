import assert from "node:assert";
import { describe, test, before, after } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";
import { parseBoundedInt, readBoundedIntEnv } from "../packages/shared/config/bounded-env";
import { SSEStreamParser } from "../frontend/src/utils/sse.ts";

/*
 * ISS-037 / ARC-013: provider time limits, bounded timeout settings and the
 * SSE heartbeat on the streamed AI answer.
 *  - withTimeout and the settings parser are exercised directly;
 *  - a Voyage call that never answers is bounded through the REAL
 *    embedding service (the provider object's method replaced);
 *  - the heartbeat runs through the REAL ai routes, controller and
 *    membership check, with the RAG runner replaced by a slow fake (no
 *    provider is called), and the frontend's real SSE parser reads the stream.
 */

setTestSecrets();
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";
process.env.REDIS_URL = "redis://127.0.0.1:6599"; // closed port; never used here

const WS = "665f1c2b9d3e4a00cccc0003";
const USER = "665f1c2b9d3e4a00dddd0004";
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

describe("ARC-013: bounded integer settings", () => {
  test("garbage, zero, negative, huge and unit-suffixed values fall back to the default", () => {
    for (const raw of ["abc", "0", "-5", "1e12", "30s", "12.5", " ", "9".repeat(30)]) {
      assert.strictEqual(parseBoundedInt(raw, 30_000, 1_000, 600_000).value, 30_000, JSON.stringify(raw));
    }
    assert.deepStrictEqual(parseBoundedInt(undefined, 30_000, 1_000, 600_000), { value: 30_000, valid: true });
    assert.deepStrictEqual(parseBoundedInt("45000", 30_000, 1_000, 600_000), { value: 45_000, valid: true });
  });

  test("ai-service timeouts read from the environment fall back to safe defaults", async () => {
    const { timeouts } = await import("../services/ai-service/src/config/timeouts");
    const saved = { ...process.env };
    try {
      process.env.LLM_REQUEST_TIMEOUT_MS = "abc";
      process.env.LLM_STREAM_IDLE_TIMEOUT_MS = "0";
      process.env.VOYAGE_DOCUMENT_TIMEOUT_MS = "-1";
      process.env.PINECONE_TIMEOUT_MS = "1e12";
      process.env.EMBEDDING_JOB_TIMEOUT_MS = "999999999";
      assert.strictEqual(timeouts.llmRequestMs(), 60_000);
      assert.strictEqual(timeouts.llmStreamIdleMs(), 30_000);
      assert.strictEqual(timeouts.voyageDocumentMs(), 30_000);
      assert.strictEqual(timeouts.pineconeMs(), 20_000);
      assert.strictEqual(timeouts.embeddingJobMs(), 600_000, "must stay below the 15 min claim lease");
      process.env.PINECONE_TIMEOUT_MS = "5000";
      assert.strictEqual(timeouts.pineconeMs(), 5_000);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
    assert.strictEqual(readBoundedIntEnv("RM_TEST_UNSET_SETTING", 7, 1, 10), 7);
  });
});

describe("ISS-037: provider calls are bounded", () => {
  test("withTimeout rejects with ProviderTimeoutError and clears its timer", async () => {
    const { withTimeout, ProviderTimeoutError } = await import("../services/ai-service/src/config/timeouts");
    const started = Date.now();
    await assert.rejects(withTimeout(new Promise(() => {}), 50, "stub call"), (e) => e instanceof ProviderTimeoutError);
    assert.ok(Date.now() - started < 500);
    assert.strictEqual(await withTimeout(Promise.resolve(42), 50, "fast call"), 42);
  });

  test("a Voyage document-embedding call that never answers fails within VOYAGE_DOCUMENT_TIMEOUT_MS", async () => {
    process.env.VOYAGE_DOCUMENT_TIMEOUT_MS = "1000";
    const voyage = await import("../services/ai-service/src/config/voyage");
    const { generateEmbeddings } = await import("../services/ai-service/src/services/embedding.service");
    const original = voyage.voyageEmbeddings.embedDocuments;
    voyage.voyageEmbeddings.embedDocuments = () => new Promise(() => {}); // provider never answers
    try {
      const started = Date.now();
      await assert.rejects(generateEmbeddings(["chunk"]), /timed out after 1000 ms/);
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 900 && elapsed < 3000, `took ${elapsed} ms`);
    } finally {
      voyage.voyageEmbeddings.embedDocuments = original;
      delete process.env.VOYAGE_DOCUMENT_TIMEOUT_MS;
    }
  });

  test("a Voyage query-embedding call that never answers fails within VOYAGE_QUERY_TIMEOUT_MS", async () => {
    process.env.VOYAGE_QUERY_TIMEOUT_MS = "1000";
    const voyage = await import("../services/ai-service/src/config/voyage");
    const { generateQueryEmbedding } = await import("../services/ai-service/src/services/query-embedding.service");
    const original = voyage.voyageQueryEmbeddings.embedQuery;
    voyage.voyageQueryEmbeddings.embedQuery = () => new Promise(() => {});
    try {
      const started = Date.now();
      await assert.rejects(generateQueryEmbedding("question"), /timed out after 1000 ms/);
      assert.ok(Date.now() - started < 3000);
    } finally {
      voyage.voyageQueryEmbeddings.embedQuery = original;
      delete process.env.VOYAGE_QUERY_TIMEOUT_MS;
    }
  });
});

describe("ISS-037: SSE heartbeat on the streamed answer", () => {
  let workspaceStub: { url: string; close: () => Promise<void> };
  let aiApp: { url: string; close: () => Promise<void> };
  let controller: typeof import("../services/ai-service/src/controllers/query.controller");

  before(async () => {
    workspaceStub = await listen((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, data: { isMember: true } }));
    });
    process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;
    process.env.SSE_HEARTBEAT_MS = "1000";
    controller = await import("../services/ai-service/src/controllers/query.controller");
    const { default: aiRoutes } = await import("../services/ai-service/src/routes/ai.routes");
    const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
    const mini = express();
    mini.use(express.json());
    mini.use("/api/ai", aiRoutes);
    mini.use(errorMiddleware);
    aiApp = await listen(mini);
  });

  after(async () => {
    delete process.env.SSE_HEARTBEAT_MS;
    await aiApp?.close();
    await workspaceStub?.close();
  });

  test("comment frames arrive while a slow answer is prepared, stop afterwards, and the client parser ignores them", async () => {
    const original = controller.ragStream.run;
    controller.ragStream.run = (async ({ emitEvent, query }: any) => {
      emitEvent("start", { query });
      await new Promise((resolve) => setTimeout(resolve, 2500)); // slow retrieval / LLM
      emitEvent("token", { text: "Grounded answer." });
      emitEvent("done", { sessionId: "s1", unverifiedCitations: [] });
    }) as any;
    try {
      const res = await fetch(`${aiApp.url}/api/ai/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId: WS, query: "What is RAG?" }),
      });
      assert.strictEqual(res.status, 200);
      const raw = await res.text();
      const pings = raw.match(/^: ping$/gm) ?? [];
      assert.ok(pings.length >= 2, `expected at least 2 heartbeats, got ${pings.length}`);
      assert.ok(raw.trimEnd().endsWith("}"), "the stream ends with the done event, not a trailing heartbeat");

      // The frontend parser, fed in small pieces, sees exactly the real events.
      const parser = new SSEStreamParser();
      const events = [];
      for (let i = 0; i < raw.length; i += 7) events.push(...parser.push(raw.slice(i, i + 7)));
      events.push(...parser.flush());
      assert.deepStrictEqual(
        events.map((e: any) => e.type),
        ["start", "token", "done"]
      );
    } finally {
      controller.ragStream.run = original;
    }
  });
});
