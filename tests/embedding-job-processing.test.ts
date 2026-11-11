import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * UNIT: the real processEmbeddingJob with its collaborators replaced (claim
 * endpoint, status endpoint, chunker, embedding provider, vector store). This
 * proves the control flow -- claim before work, skip unclaimable deliveries,
 * compensate when the document is deleted mid-job, record failures -- not the
 * behaviour of the real providers. Real claim atomicity is covered by
 * document-lifecycle.integration.test.ts.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599"; // module-level client; never used here
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";

let worker: typeof import("../services/ai-service/src/workers/embedding.worker");
let statusClient: typeof import("../services/ai-service/src/services/document-status.service");
let DocumentServiceError: typeof import("../services/ai-service/src/services/document-status.service").DocumentServiceError;
let redisWorker: any;
let fakeDocumentService: { url: string; close: () => Promise<void> };
let claimResponse: { status: number; body: string } = { status: 404, body: "Cannot POST" };

before(async () => {
  // Stand-in for document-service, used by the claim-client tests below.
  fakeDocumentService = await listen((_req, res) => {
    res.statusCode = claimResponse.status;
    res.end(claimResponse.body);
  });
  process.env.DOCUMENT_SERVICE_URL = fakeDocumentService.url;

  worker = await import("../services/ai-service/src/workers/embedding.worker");
  statusClient = await import("../services/ai-service/src/services/document-status.service");
  ({ DocumentServiceError } = statusClient);
  ({ default: redisWorker } = await import("../services/ai-service/src/config/redis-worker"));
});

after(async () => {
  redisWorker?.disconnect();
  await fakeDocumentService?.close();
});

const JOB = {
  documentId: "665f1c2b9d3e4a0012345678",
  workspaceId: "665f1c2b9d3e4a0087654321",
  uploadedBy: "665f1c2b9d3e4a00aaaaaaaa",
  extractedText: "First paragraph.\n\nSecond paragraph.",
  fileType: "pdf" as const,
};

type Calls = string[];

/** Fake collaborators that record the order of calls. */
const fakeDeps = (calls: Calls, overrides: Partial<Record<string, any>> = {}) => ({
  claim: async () => {
    calls.push("claim");
    return { claimed: true as const, claimToken: 7, workspaceId: JOB.workspaceId };
  },
  updateStatus: async (_id: string, status: string, error?: string, claimToken?: number) => {
    assert.strictEqual(claimToken, 7, "status updates carry the claim's fencing token");
    calls.push(error ? `status:${status}:${error}` : `status:${status}`);
    return {};
  },
  chunk: async (text: string) => {
    calls.push("chunk");
    return text.split("\n\n").map((t, index) => ({ index, text: t, tokenCount: 1 }));
  },
  embed: async (texts: string[]) => {
    calls.push("embed");
    return texts.map((_, index) => ({ index, embedding: [0.1, 0.2] }));
  },
  deleteVectors: async () => {
    calls.push("deleteVectors");
  },
  upsertVectors: async ({ chunks }: { chunks: unknown[] }) => {
    calls.push("upsert");
    return { documentId: JOB.documentId, workspaceId: JOB.workspaceId, vectorCount: chunks.length };
  },
  ...overrides,
});

describe("processEmbeddingJob (ai-service/src/workers/embedding.worker.ts)", () => {
  test("success: claim -> chunk -> embed -> replace vectors -> indexed", async () => {
    const calls: Calls = [];
    const outcome = await worker.processEmbeddingJob(JOB, fakeDeps(calls) as any);
    assert.strictEqual(outcome, "indexed");
    assert.deepStrictEqual(calls, ["claim", "chunk", "embed", "deleteVectors", "upsert", "status:indexed"]);
  });

  test("duplicate delivery / another worker holds the claim: skipped, no provider calls", async () => {
    for (const reason of ["in-progress", "already-indexed", "retry-limit", "deleted"]) {
      const calls: Calls = [];
      const outcome = await worker.processEmbeddingJob(
        JOB,
        fakeDeps(calls, {
          claim: async () => {
            calls.push("claim");
            return { claimed: false, reason };
          },
        }) as any
      );
      assert.strictEqual(outcome, "skipped", reason);
      assert.deepStrictEqual(calls, ["claim"], reason);
    }
  });

  test("document deleted while processing (indexed update -> 410): written vectors are removed", async () => {
    const calls: Calls = [];
    const outcome = await worker.processEmbeddingJob(
      JOB,
      fakeDeps(calls, {
        updateStatus: async (_id: string, status: string) => {
          calls.push(`status:${status}`);
          throw new DocumentServiceError("gone", 410);
        },
      }) as any
    );
    assert.strictEqual(outcome, "deleted-during-processing");
    assert.deepStrictEqual(calls, [
      "claim", "chunk", "embed", "deleteVectors", "upsert", "status:indexed", "deleteVectors",
    ]);
  });

  test("document fully removed (404) while processing: vectors are removed too", async () => {
    const calls: Calls = [];
    await worker.processEmbeddingJob(
      JOB,
      fakeDeps(calls, {
        updateStatus: async () => {
          throw new DocumentServiceError("not found", 404);
        },
      }) as any
    );
    assert.strictEqual(calls.filter((c) => c === "deleteVectors").length, 2);
  });

  test("embedding provider failure: marked failed with the reason, error rethrown, nothing written", async () => {
    const calls: Calls = [];
    await assert.rejects(
      worker.processEmbeddingJob(
        JOB,
        fakeDeps(calls, {
          embed: async () => {
            calls.push("embed");
            throw new Error("Voyage 503 Service Unavailable");
          },
        }) as any
      ),
      /Voyage 503/
    );
    assert.deepStrictEqual(calls, ["claim", "chunk", "embed", "status:failed:Voyage 503 Service Unavailable"]);
  });

  test("vector store failure after the claim: marked failed (the recovery sweep retries)", async () => {
    const calls: Calls = [];
    await assert.rejects(
      worker.processEmbeddingJob(
        JOB,
        fakeDeps(calls, {
          upsertVectors: async () => {
            calls.push("upsert");
            throw new Error("Pinecone timeout");
          },
        }) as any
      ),
      /Pinecone timeout/
    );
    assert.strictEqual(calls.at(-1), "status:failed:Pinecone timeout");
  });

  test("failure AND the document was deleted meanwhile: partial vectors are removed", async () => {
    const calls: Calls = [];
    const outcome = await worker.processEmbeddingJob(
      JOB,
      fakeDeps(calls, {
        upsertVectors: async () => {
          calls.push("upsert");
          throw new Error("Pinecone timeout mid-batch");
        },
        updateStatus: async (_id: string, status: string) => {
          calls.push(`status:${status}`);
          throw new DocumentServiceError("gone", 410);
        },
      }) as any
    );
    assert.strictEqual(outcome, "deleted-during-processing");
    assert.strictEqual(calls.at(-1), "deleteVectors");
  });

  test("a document with no usable text is marked failed with a clear reason", async () => {
    const calls: Calls = [];
    await assert.rejects(
      worker.processEmbeddingJob(
        { ...JOB, extractedText: "" },
        fakeDeps(calls, {
          chunk: async () => {
            calls.push("chunk");
            return [];
          },
        }) as any
      ),
      /no usable text/
    );
    assert.strictEqual(calls.at(-1), "status:failed:Document contains no usable text");
  });

  test("a job whose workspace does not match the claimed document is refused before any work", async () => {
    const calls: Calls = [];
    const outcome = await worker.processEmbeddingJob(
      { ...JOB, workspaceId: "665f1c2b9d3e4a00ffffffff" },
      fakeDeps(calls) as any
    );
    assert.strictEqual(outcome, "skipped");
    assert.deepStrictEqual(calls, ["claim", "status:failed:Embedding job did not match the document's workspace"]);
  });

  test("claim superseded at the final update: result discarded, nothing undone", async () => {
    const calls: Calls = [];
    const outcome = await worker.processEmbeddingJob(
      JOB,
      fakeDeps(calls, {
        updateStatus: async () => {
          calls.push("status");
          throw new DocumentServiceError("superseded", 409);
        },
      }) as any
    );
    assert.strictEqual(outcome, "superseded");
    assert.deepStrictEqual(calls, ["claim", "chunk", "embed", "deleteVectors", "upsert", "status"]);
  });

  test("a transient failure of the final status update is retried", async () => {
    const calls: Calls = [];
    let failures = 2;
    const outcome = await worker.processEmbeddingJob(
      JOB,
      fakeDeps(calls, {
        updateStatus: async (_id: string, status: string) => {
          calls.push(`status:${status}`);
          if (failures-- > 0) throw new DocumentServiceError("bad gateway", 502);
          return {};
        },
      }) as any,
      { statusRetryDelayMs: 1 }
    );
    assert.strictEqual(outcome, "indexed");
    assert.strictEqual(calls.filter((c) => c === "status:indexed").length, 3);
  });

  test("two workers racing for one document: only the claim winner does the work", async () => {
    let claimed = false;
    const calls: Calls = [];
    const claim = async () => {
      await new Promise((r) => setTimeout(r, 5));
      if (claimed) return { claimed: false as const, reason: "in-progress" };
      claimed = true;
      return { claimed: true as const, claimToken: 7, workspaceId: JOB.workspaceId };
    };
    const outcomes = await Promise.all([
      worker.processEmbeddingJob(JOB, fakeDeps(calls, { claim }) as any),
      worker.processEmbeddingJob(JOB, fakeDeps(calls, { claim }) as any),
    ]);
    assert.deepStrictEqual(outcomes.sort(), ["indexed", "skipped"]);
    assert.strictEqual(calls.filter((c) => c === "embed").length, 1);
  });
});

describe("claim client (ai-service/src/services/document-status.service.ts)", () => {
  test("a bare 404 (claim endpoint missing, e.g. older document-service) is an error, not 'deleted'", async () => {
    claimResponse = { status: 404, body: "Cannot POST /internal/documents/x/embedding/claim" };
    await assert.rejects(statusClient.claimDocumentForEmbedding(JOB.documentId), /404/);
  });

  test("a 404/409/410 decision with a reason is a skip", async () => {
    for (const [status, reason] of [[404, "not-found"], [409, "in-progress"], [410, "deleted"]] as const) {
      claimResponse = { status, body: JSON.stringify({ success: false, reason }) };
      assert.deepStrictEqual(await statusClient.claimDocumentForEmbedding(JOB.documentId), { claimed: false, reason });
    }
  });

  test("a successful claim returns the fencing token and workspace", async () => {
    claimResponse = {
      status: 200,
      body: JSON.stringify({ success: true, data: { embeddingAttempts: 1, claimToken: 4, workspaceId: JOB.workspaceId } }),
    };
    assert.deepStrictEqual(await statusClient.claimDocumentForEmbedding(JOB.documentId), {
      claimed: true, claimToken: 4, workspaceId: JOB.workspaceId,
    });
  });

  test("a 200 claim without a fencing token or workspace is an error (never processed unfenced)", async () => {
    for (const body of [
      "not json",
      JSON.stringify({ success: true, data: { workspaceId: JOB.workspaceId } }),
      JSON.stringify({ success: true, data: { claimToken: 3 } }),
      JSON.stringify({ success: true, data: { claimToken: "3", workspaceId: JOB.workspaceId } }),
    ]) {
      claimResponse = { status: 200, body };
      await assert.rejects(statusClient.claimDocumentForEmbedding(JOB.documentId), /no claim token/, body);
    }
  });
});
