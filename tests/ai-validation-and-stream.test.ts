import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * P1-A24 AI input validation, P1-A23 meeting-summary robustness and P1-A21
 * gateway stream termination.
 *  - Schemas and the summarizer are UNIT tests (the LLM client is replaced
 *    with fixtures; no provider is called).
 *  - The ai routes run the REAL router + validation + membership middleware
 *    against a workspace-service stub; requests that pass validation are only
 *    sent where no provider call follows.
 *  - The gateway test runs the REAL api-gateway app in front of a stub
 *    ai-service that dies mid-stream.
 */

setTestSecrets();
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";
process.env.REDIS_URL = "redis://127.0.0.1:6599"; // rate limiter fails open; never reached

const WS = "665f1c2b9d3e4a00cccc0003";
const USER = "665f1c2b9d3e4a00dddd0004";
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

let schemas: typeof import("../packages/validation/schemas/ai.schema");
let workspaceStub: { url: string; close: () => Promise<void> };
let aiApp: { url: string; close: () => Promise<void> };

before(async () => {
  // The caller is NOT a member of any workspace.
  workspaceStub = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: false } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;

  schemas = await import("../packages/validation/schemas/ai.schema");

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
  await workspaceStub?.close();
});

describe("P1-A24: AI query schemas", () => {
  test("whitespace-only, oversized and malformed queries are rejected", () => {
    const base = { workspaceId: WS, query: "What is RAG?" };
    assert.ok(schemas.ragQuerySchema.safeParse(base).success);
    assert.strictEqual(schemas.ragQuerySchema.safeParse({ ...base, query: "   \n\t " }).success, false);
    assert.strictEqual(schemas.ragQuerySchema.safeParse({ ...base, query: "x".repeat(2001) }).success, false);
    assert.strictEqual(schemas.ragQuerySchema.safeParse({ ...base, query: 42 }).success, false);
    assert.strictEqual(schemas.ragQuerySchema.safeParse({ ...base, workspaceId: "abc" }).success, false);
    assert.strictEqual(schemas.ragQuerySchema.safeParse({ ...base, topK: 11 }).success, false, "topK matches the retrieval clamp");
    assert.strictEqual(schemas.semanticSearchSchema.safeParse({ ...base, query: "  " }).success, false);
  });

  test("valid queries are trimmed and keep their defaults", () => {
    const parsed = schemas.ragQuerySchema.parse({ workspaceId: WS, query: "  hello  " });
    assert.strictEqual(parsed.query, "hello");
    assert.strictEqual(parsed.topK, 5);
    assert.strictEqual(schemas.ragQuerySchema.parse({ workspaceId: WS, query: "q", topK: 10 }).topK, 10);
    assert.ok(schemas.ragQuerySchema.safeParse({ workspaceId: WS, query: "x".repeat(2000) }).success);
  });
});

describe("P1-A24: validation through the real ai routes", () => {
  const post = (path: string, body: unknown, auth = true) =>
    fetch(`${aiApp.url}/api/ai${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  test("empty, excessive and malformed input -> 400 with an actionable message", async () => {
    for (const body of [
      { workspaceId: WS, query: "   " },
      { workspaceId: WS, query: "x".repeat(2001) },
      { workspaceId: WS, query: "q", topK: 50 },
      { workspaceId: "not-an-id", query: "q" },
      { query: "q" },
    ]) {
      const res = await post("/query", body);
      assert.strictEqual(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.ok((await res.json()).message);
    }
    assert.strictEqual((await post("/search", { workspaceId: WS, query: " " })).status, 400);
  });

  test("a valid query for a workspace the caller does not belong to -> 403 (no retrieval)", async () => {
    assert.strictEqual((await post("/query", { workspaceId: WS, query: "secret plans?" })).status, 403);
    assert.strictEqual((await post("/search", { workspaceId: WS, query: "secret plans?" })).status, 403);
  });

  test("unauthenticated -> 401", async () => {
    assert.strictEqual((await post("/query", { workspaceId: WS, query: "q" }, false)).status, 401);
  });

  test("meeting summary: a non-member is refused before any LLM call (403); bad workspace id 400", async () => {
    const text = "Alice will draft the intro by Friday. Bob reviews.";
    assert.strictEqual((await post("/summarize-meeting", { workspaceId: WS, text })).status, 403);
    assert.strictEqual((await post("/summarize-meeting", { workspaceId: "x", text })).status, 400);
  });
});

describe("P1-A23: meeting summary normalisation and failures (fixture LLM output)", () => {
  let summarizer: typeof import("../services/ai-service/src/services/meeting-summarizer.service");
  let grokClient: any;
  let lastRequest: any;
  let reply: any;

  before(async () => {
    ({ grokClient } = await import("../services/ai-service/src/config/grok"));
    grokClient.chat.completions.create = async (request: any) => {
      lastRequest = request;
      if (reply instanceof Error) throw reply;
      return reply;
    };
    summarizer = await import("../services/ai-service/src/services/meeting-summarizer.service");
  });

  const completion = (content: string, finish_reason = "stop") => ({ choices: [{ message: { content }, finish_reason }] });

  test("nulls, missing lists, extra keys and code fences are normalised (not a 502)", async () => {
    reply = completion(
      "```json\n" +
        JSON.stringify({
          meeting_date: null,
          attendees: null,
          summary: "  Planning  ",
          decisions: ["Ship v1", null, ""],
          action_items: [
            { task: "Draft intro", assignee: null, due: "2026-03-14", confidence: 0.9 },
            { task: null, assignee: "x", due: "" },
          ],
          next_meeting: null,
          extra_field: "ignored",
        }) +
        "\n```"
    );
    const summary = await summarizer.generateMeetingSummary("Meeting notes with enough text.");
    assert.deepStrictEqual(summary, {
      meeting_date: "",
      attendees: [],
      summary: "Planning",
      decisions: ["Ship v1"],
      action_items: [{ task: "Draft intro", assignee: "", due: "2026-03-14" }],
      open_questions: [],
      next_meeting: "",
    });
  });

  test("the request carries an explicit output limit", async () => {
    reply = completion(JSON.stringify({ summary: "s" }));
    await summarizer.generateMeetingSummary("Meeting notes with enough text.");
    assert.strictEqual(lastRequest.max_tokens, summarizer.MEETING_SUMMARY_MAX_TOKENS);
  });

  test("ISS-030: the request asks for JSON mode, and the prompt mentions JSON", async () => {
    reply = completion(JSON.stringify({ summary: "s" }));
    await summarizer.generateMeetingSummary("Meeting notes with enough text.");
    assert.deepStrictEqual(lastRequest.response_format, { type: "json_object" });
    assert.match(lastRequest.messages.map((m: any) => m.content).join("\n"), /JSON/);
  });

  test("ISS-030: a provider 400 in JSON mode is retried once without it; never more, and other failures are not retried", async (t) => {
    t.mock.method(console, "warn", () => {});
    t.mock.method(console, "error", () => {});
    const requests: any[] = [];
    const saved = grokClient.chat.completions.create;
    try {
      grokClient.chat.completions.create = async (request: any) => {
        requests.push(request);
        if (request.response_format) {
          throw Object.assign(new Error("400 response_format json_object is not supported"), { status: 400 });
        }
        return completion(JSON.stringify({ summary: "fallback ok" }));
      };
      const summary = await summarizer.generateMeetingSummary("Meeting notes with enough text.");
      assert.strictEqual(summary.summary, "fallback ok");
      assert.strictEqual(requests.length, 2);
      assert.deepStrictEqual(requests[0].response_format, { type: "json_object" });
      assert.strictEqual(requests[1].response_format, undefined);

      requests.length = 0;
      grokClient.chat.completions.create = async (request: any) => {
        requests.push(request);
        throw Object.assign(new Error("400 bad request"), { status: 400 });
      };
      await assert.rejects(summarizer.generateMeetingSummary("Meeting notes with enough text."), (e: any) => e.name === "LlmUnavailableError");
      assert.strictEqual(requests.length, 2, "exactly one fallback attempt, no loop");

      requests.length = 0;
      grokClient.chat.completions.create = async (request: any) => {
        requests.push(request);
        throw Object.assign(new Error("500 upstream"), { status: 500 });
      };
      await assert.rejects(summarizer.generateMeetingSummary("Meeting notes with enough text."), (e: any) => e.name === "LlmUnavailableError");
      assert.strictEqual(requests.length, 1, "a non-400 failure is not retried");
    } finally {
      grokClient.chat.completions.create = saved;
    }
  });

  test("a reply cut off at the token limit is a clear failure, never a partial summary", async () => {
    reply = completion('{"summary": "half a sum', "length");
    await assert.rejects(summarizer.generateMeetingSummary("Meeting notes with enough text."), (e: any) => e.name === "LlmUnavailableError" && e.statusCode === 502);
  });

  test("wrong types, non-JSON and provider errors are clear failures", async () => {
    for (const r of [
      completion(JSON.stringify({ summary: { nested: true } })),
      completion("Sure! Here is your summary: ..."),
      Object.assign(new Error("ECONNRESET"), { status: 500 }),
    ]) {
      reply = r;
      await assert.rejects(summarizer.generateMeetingSummary("Meeting notes with enough text."), (e: any) => e.name === "LlmUnavailableError");
    }
  });
});

describe("P1-A21: gateway ends the client stream when ai-service dies mid-answer", () => {
  let gateway: { url: string; close: () => Promise<void> };
  let aiStub: { url: string; close: () => Promise<void> };
  let rateLimitRedis: any;
  let behaviour: "die" | "complete" | "slow" = "die";
  // ARC-012: what the slow upstream saw.
  const slow = { written: 0, closedAt: -1, writtenAtClose: -1 };

  before(async () => {
    aiStub = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`event: token\ndata: ${JSON.stringify({ text: "partial " })}\n\n`);
      if (behaviour === "slow") {
        // A long answer: one token every 50 ms, 40 in all (~2 s).
        const timer = setInterval(() => {
          if (res.destroyed || res.writableEnded) return;
          slow.written += 1;
          res.write(`event: token\ndata: ${JSON.stringify({ text: `t${slow.written}` })}\n\n`);
          if (slow.written >= 40) {
            clearInterval(timer);
            res.end(`event: done\ndata: ${JSON.stringify({ sessionId: "s1", unverifiedCitations: [] })}\n\n`);
          }
        }, 50);
        res.on("close", () => {
          clearInterval(timer);
          if (slow.closedAt < 0) {
            slow.closedAt = Date.now();
            slow.writtenAtClose = slow.written;
          }
        });
        return;
      }
      if (behaviour === "die") {
        setTimeout(() => req.socket.destroy(), 50); // crash mid-stream
      } else {
        setTimeout(() => {
          res.write(`event: token\ndata: ${JSON.stringify({ text: "answer" })}\n\n`);
          res.end(`event: done\ndata: ${JSON.stringify({ sessionId: "s1", unverifiedCitations: [] })}\n\n`);
        }, 50);
      }
    });
    process.env.AI_SERVICE_URL = aiStub.url;
    const { default: gatewayApp } = await import("../services/api-gateway/src/app");
    ({ rateLimitRedis } = await import("../services/api-gateway/src/middlewares/rate-limit.middleware"));
    gateway = await listen(gatewayApp);
  });

  after(async () => {
    await gateway?.close();
    await aiStub?.close();
    rateLimitRedis?.disconnect?.();
  });

  const ask = async () => {
    const res = await fetch(`${gateway.url}/api/ai/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId: WS, query: "q" }),
      signal: AbortSignal.timeout(8000),
    });
    let text = "";
    try {
      text = await res.text();
    } catch {
      // A reset connection may surface as a read error: the stream still ended.
    }
    return text;
  };

  test("upstream crash: the client's stream ends (no hang) and carries no terminal event", async () => {
    behaviour = "die";
    const started = Date.now();
    const text = await ask();
    assert.ok(Date.now() - started < 5000, "ended promptly");
    assert.ok(!text.includes("event: done"), "never looks complete");
  });

  test("normal stream passes through the gateway complete and in order", async () => {
    behaviour = "complete";
    const text = await ask();
    assert.match(text, /partial [\s\S]*answer[\s\S]*event: done/);
  });

  /*
   * ARC-012 guard: a client that leaves mid-answer must close the upstream
   * stream too (ai-service then aborts generation and saves nothing, ISS-015,
   * tests/ai-stream-disconnect.test.ts). http-proxy aborts the upstream
   * request when the client goes; this pins it before any proxy upgrade.
   */
  test("ARC-012: a client disconnect at the gateway closes the upstream stream promptly", async () => {
    behaviour = "slow";
    const { default: http } = await import("node:http");
    const body = JSON.stringify({ workspaceId: WS, query: "q" });
    const { port, hostname } = new URL(gateway.url);
    const leftAt = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: hostname,
          port: Number(port),
          method: "POST",
          path: "/api/ai/query",
          agent: false,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
            Authorization: `Bearer ${token}`,
          },
        },
        (res) => {
          let chunks = 0;
          res.on("data", () => {
            chunks += 1;
            if (chunks === 3) {
              const at = Date.now();
              req.destroy(); // the user closed the tab
              resolve(at);
            }
          });
          res.on("end", () => reject(new Error("the stream completed before the client left")));
        }
      );
      req.on("error", () => undefined);
      req.end(body);
    });
    // Wait long enough for the full answer (40 x 50 ms) had it kept going.
    await new Promise((r) => setTimeout(r, 2500));
    assert.ok(slow.closedAt >= 0, "the upstream stream was never closed");
    assert.ok(slow.closedAt - leftAt < 1000, `upstream closed ${slow.closedAt - leftAt} ms after the client left`);
    assert.strictEqual(slow.written, slow.writtenAtClose, "the upstream kept writing after the close");
    assert.ok(slow.written < 40, "the upstream produced the whole answer for a client that had left");
  });
});
