import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import { setTestSecrets } from "./helpers/test-env";

/*
 * RT-007: provider errors (Voyage, Pinecone, Cloudinary, LLM) must not leak
 * key identifiers, bearer tokens, cookies or URL query strings into logs, and
 * raw provider text must never be stored or shown as a document's failure
 * reason. UNIT: the shared log helper, the real embedding worker with stubbed
 * collaborators, the real RAG pipeline with a failing embedder, and the API
 * serializer. No infrastructure.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

const LEAKY = 'Request failed 401 {"detail":"Provided API key is invalid."} api_key=pa-STUBKEY123456 Authorization: Bearer abc.def.ghi set-cookie: sid=s3cr3t; https://api.example.test/v1/embed?key=QUERYSECRET';
const SECRETS = ["pa-STUBKEY123456", "abc.def.ghi", "sid=s3cr3t", "QUERYSECRET"];

let safe: typeof import("../packages/shared/errors/safe-error");
let worker: typeof import("../services/ai-service/src/workers/embedding.worker");
let serializer: typeof import("../services/document-service/src/utils/document-serializer");

let redisWorker: { disconnect: () => void } | undefined;

before(async () => {
  safe = await import("../packages/shared/errors/safe-error");
  worker = await import("../services/ai-service/src/workers/embedding.worker");
  serializer = await import("../services/document-service/src/utils/document-serializer");
  ({ default: redisWorker } = await import("../services/ai-service/src/config/redis-worker"));
});

after(() => {
  // The worker module opens a Redis client (dead port); close it so the test process exits.
  redisWorker?.disconnect();
});

const captureErrors = (t: any) => {
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" ")));
  t.mock.method(console, "warn", (...args: unknown[]) => lines.push(args.map(String).join(" ")));
  return lines;
};

describe("RT-007: describeErrorForLog", () => {
  test("keeps the name and status, removes keys, bearer tokens, cookies and query strings", () => {
    const error = Object.assign(new Error(LEAKY), { name: "VoyageError", http_code: 401 });
    const line = safe.describeErrorForLog(error);
    assert.match(line, /^VoyageError status=401/);
    for (const secret of SECRETS) assert.ok(!line.includes(secret), `${secret} leaked: ${line}`);
    assert.ok(line.length < 400);
  });

  test("handles non-Error values and statusCode/code fields", () => {
    assert.match(safe.describeErrorForLog("plain text"), /plain text/);
    assert.match(safe.describeErrorForLog(Object.assign(new Error("x"), { statusCode: 503, code: "ECONNRESET" })), /status=503 code=ECONNRESET/);
    assert.match(safe.describeErrorForLog(Object.assign(new Error("Invalid api_key 123456789012345"), { http_code: 401 })), /status=401/);
    assert.ok(!safe.describeErrorForLog(new Error("Invalid api_key 123456789012345")).includes("123456789012345"));
  });
});

describe("RT-007: the embedding worker stores fixed reasons and logs redacted detail", () => {
  const JOB = { documentId: "665f1c2b9d3e4a0012345678", workspaceId: "665f1c2b9d3e4a0087654321" };
  const deps = (embed: () => Promise<unknown>, reported: string[]) => ({
    claim: async () => ({ claimed: true as const, claimToken: 1, workspaceId: JOB.workspaceId }),
    fetchSource: async () => ({ workspaceId: JOB.workspaceId, uploadedBy: "665f1c2b9d3e4a00aaaaaaaa", fileType: "pdf" as const, extractedText: "Some text.\n\nMore." }),
    updateStatus: async (_id: string, _status: string, error?: string) => {
      if (error) reported.push(error);
      return {};
    },
    chunk: async (text: string) => [{ index: 0, text, tokenCount: 1 }],
    embed,
    deleteVectors: async () => {},
    upsertVectors: async () => ({ documentId: JOB.documentId, workspaceId: JOB.workspaceId, vectorCount: 1 }),
  });

  test("a provider error is stored as 'Indexing failed'; the log has no secret", async (t) => {
    const lines = captureErrors(t);
    const reported: string[] = [];
    await assert.rejects(worker.processEmbeddingJob(JOB, deps(async () => { throw new Error(LEAKY); }, reported) as any, { statusRetryDelayMs: 1 }));
    assert.deepStrictEqual(reported, ["Indexing failed"]);
    const all = lines.join("\n");
    for (const secret of SECRETS) assert.ok(!all.includes(secret), `${secret} logged`);
  });

  test("a job that exceeds its deadline is stored as 'Indexing timed out'", async (t) => {
    captureErrors(t);
    const reported: string[] = [];
    await assert.rejects(
      worker.processEmbeddingJob(JOB, deps(() => new Promise(() => {}), reported) as any, { statusRetryDelayMs: 1, jobTimeoutMs: 50 })
    );
    assert.deepStrictEqual(reported, ["Indexing timed out"]);
  });
});

describe("RT-007: the RAG stream logs retrieval failures without secrets", () => {
  test("a failing query embedding: SSE error message unchanged, log free of the key", async (t) => {
    const lines = captureErrors(t);
    const voyage = await import("../services/ai-service/src/config/voyage");
    const original = voyage.voyageQueryEmbeddings.embedQuery;
    voyage.voyageQueryEmbeddings.embedQuery = async () => {
      throw new Error(LEAKY);
    };
    try {
      const { runRagStreamQuery } = await import("../services/ai-service/src/services/rag.service");
      const events: Array<[string, any]> = [];
      await runRagStreamQuery({
        workspaceId: "665f1c2b9d3e4a0087654321",
        userId: "665f1c2b9d3e4a00aaaaaaaa",
        query: "anything",
        emitEvent: (event, data) => events.push([event, data]),
      });
      const error = events.find(([e]) => e === "error");
      assert.ok(error);
      assert.strictEqual(error![1].message, "Could not search this workspace's documents right now. Please try again.");
      const all = lines.join("\n");
      for (const secret of SECRETS) assert.ok(!all.includes(secret), `${secret} logged`);
    } finally {
      voyage.voyageQueryEmbeddings.embedQuery = original;
    }
  });
});

describe("RT-007: the document API returns only canonical failure reasons", () => {
  test("a raw provider reason is masked as 'Indexing failed'; canonical reasons pass through", () => {
    const view = (embeddingError: string | null) => (serializer.toClientDocument({ _id: "x", embeddingError }) as any).embeddingError;
    assert.strictEqual(view("Voyage 401 api_key=pa-STUBKEY123456"), "Indexing failed");
    for (const reason of [
      "No extractable text",
      "Document contains no usable text",
      "Indexing failed",
      "Indexing timed out",
      "Indexing failed after 3 attempts",
      "Could not queue the document for indexing",
      "Embedding job did not match the document's workspace",
    ]) {
      assert.strictEqual(view(reason), reason);
    }
    assert.strictEqual(view(null), null);
  });
});
