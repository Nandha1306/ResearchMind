import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * ISS-015: when the client leaves an answer stream, generation stops (the
 * LLM request's signal is aborted), nothing more is written to the closed
 * response, and no session is saved -- a partial answer is never persisted.
 *
 * REAL ai routes, controller, RAG pipeline and grok streaming code. Stubbed
 * on the real SDK objects: the Pinecone index (no matches, so no
 * document-service call), the Voyage query embedder, the LLM client (a slow
 * fake stream that honours the request signal like the SDK does) and
 * AISession.create (records calls; no MongoDB). No provider call.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

const WS = "665f1c2b9d3e4a00cccc0015";
const USER = "665f1c2b9d3e4a00dddd0015";
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

const TOTAL_TOKENS = 20;
const TOKEN_GAP_MS = 100;

let aiApp: { url: string; close: () => Promise<void> };
let workspaceStub: { url: string; close: () => Promise<void> };
let llm: { signal?: AbortSignal; produced: number; finished: boolean };
let savedSessions: unknown[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

before(async () => {
  process.on("unhandledRejection", onUnhandled);
  workspaceStub = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: true, isOwner: false } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;

  const { pineconeIndex } = await import("../services/ai-service/src/config/pinecone");
  (pineconeIndex as any).namespace = () => ({ query: async () => ({ matches: [] }) });
  const voyage = await import("../services/ai-service/src/config/voyage");
  voyage.voyageQueryEmbeddings.embedQuery = async () => Array(voyage.VOYAGE_EMBEDDING_DIMENSION).fill(0.01);

  const { AISession } = await import("../services/ai-service/src/models/AISession");
  (AISession as any).create = async (doc: unknown) => {
    savedSessions.push(doc);
    return { _id: { toString: () => "665f1c2b9d3e4a00eeee0015" } };
  };

  const { grokClient } = await import("../services/ai-service/src/config/grok");
  (grokClient.chat.completions as any).create = async (_params: any, opts: { signal?: AbortSignal } = {}) => {
    const state = llm; // this request's record, even if a later test resets `llm`
    state.signal = opts.signal;
    return (async function* () {
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        await new Promise((resolve) => setTimeout(resolve, TOKEN_GAP_MS));
        if (opts.signal?.aborted) {
          // The SDK rejects the stream iteration once its signal is aborted.
          throw Object.assign(new Error("Request was aborted."), { name: "AbortError" });
        }
        state.produced++;
        yield { choices: [{ delta: { content: `t${i} ` } }] };
      }
      state.finished = true;
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
  process.off("unhandledRejection", onUnhandled);
  await aiApp?.close();
  await workspaceStub?.close();
});

const reset = () => {
  llm = { produced: 0, finished: false };
  savedSessions = [];
};

const ask = (signal?: AbortSignal) =>
  fetch(`${aiApp.url}/api/ai/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ workspaceId: WS, query: "Tell me everything" }),
    signal,
  });

describe("ISS-015: client disconnect stops generation and saves nothing", () => {
  test("the client leaves after two tokens: the LLM signal is aborted, generation stops, no session is saved", async (t) => {
    reset();
    const logged: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args.map(String).join(" ")); });

    const client = new AbortController();
    const res = await ask(client.signal);
    assert.strictEqual(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while ((received.match(/event: token/g) ?? []).length < 2) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    assert.strictEqual((received.match(/event: token/g) ?? []).length, 2);
    client.abort();
    await reader.cancel().catch(() => {});

    // Give the server well under the remaining ~1.8 s of generation.
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.ok(llm.signal, "the LLM request received a signal");
    assert.strictEqual(llm.signal!.aborted, true, "the LLM request was aborted");
    assert.ok(llm.produced < TOTAL_TOKENS, `generation continued: ${llm.produced}/${TOTAL_TOKENS}`);
    assert.strictEqual(llm.finished, false);
    assert.strictEqual(savedSessions.length, 0, "a partial answer was saved");

    // The rest of the generator would have finished by now if it were still running.
    await new Promise((resolve) => setTimeout(resolve, TOKEN_GAP_MS * 3));
    assert.ok(llm.produced <= 5, `tokens produced after the abort: ${llm.produced}`);
    assert.strictEqual(savedSessions.length, 0);
    assert.deepStrictEqual(unhandled, []);
    assert.ok(!logged.some((l) => /write after end/i.test(l)), logged.join("\n"));
    assert.ok(!logged.some((l) => /LLM.*(timeout|stream_interrupted)/i.test(l)), "a client disconnect was logged as an LLM failure");
  });

  test("control: without a disconnect the answer completes and one session is saved", async () => {
    reset();
    const res = await ask();
    const raw = await res.text();
    assert.strictEqual(res.status, 200);
    assert.match(raw, /event: done/);
    assert.strictEqual((raw.match(/event: token/g) ?? []).length, TOTAL_TOKENS);
    assert.strictEqual(llm.signal?.aborted, false);
    assert.strictEqual(llm.finished, true);
    assert.strictEqual(savedSessions.length, 1);
  });
});
