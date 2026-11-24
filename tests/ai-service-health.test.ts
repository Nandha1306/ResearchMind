import assert from "node:assert";
import http from "node:http";
import { test, describe, before, after } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";
import { infraDescribe } from "./helpers/infra";
import { connectTestDatabase, mongoSkip } from "./helpers/test-mongo";

/*
 * ARC-008: ai-service's HTTP API does not need Redis (only the embedding
 * worker does). GET /health is now liveness: 200 "degraded" with
 * redis "down" when only Redis is down, 503 when MongoDB is down. The strict
 * worker-readiness check moved to GET /health/ready (503 if either is down).
 *
 * REQ-082: the meeting-summary route accepts the documented 50,000
 * characters of any script (the body limit there is 320 kB; elsewhere it
 * stays 100 kB). REAL ai-service app.ts; Redis on a dead port; the MongoDB
 * connection state is mocked; the LLM and the membership check are stubbed.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

const WS = "665f1c2b9d3e4a00cccc0082";
const USER = "665f1c2b9d3e4a00dddd0082";
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

let app: { url: string; close: () => Promise<void> };
let workspaceStub: { url: string; close: () => Promise<void> };
let redis: { disconnect: () => void };
let llmCalls = 0;

before(async () => {
  workspaceStub = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: true, isOwner: true } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;
  const { grokClient } = await import("../services/ai-service/src/config/grok");
  (grokClient.chat.completions as any).create = async () => {
    llmCalls++;
    return { choices: [{ message: { content: JSON.stringify({ summary: "ok" }) }, finish_reason: "stop" }] };
  };
  ({ default: redis } = await import("../services/ai-service/src/config/redis"));
  const { default: aiApp } = await import("../services/ai-service/src/app");
  app = await listen(aiApp);
});

after(async () => {
  await app?.close();
  await workspaceStub?.close();
  redis?.disconnect();
});

const get = async (path: string) => {
  const res = await fetch(`${app.url}${path}`);
  return { status: res.status, body: await res.json() };
};

/*
 * The MongoDB state is real: the first test connects mongoose to a disposable
 * database (mocking `readyState` makes mongoose start index builds on a
 * connection that does not exist, which never settle). The second test runs
 * after that connection is closed.
 */
infraDescribe("ARC-008: ai-service liveness vs readiness (real MongoDB)", mongoSkip, () => {
  test("MongoDB up, Redis down: /health 200 degraded with redis down; /health/ready 503", async () => {
    const db = await connectTestDatabase("aihealth");
    try {
      assert.strictEqual(mongoose.connection.readyState, 1);
      await runUpChecks();
    } finally {
      await db.cleanup();
    }
  });

  test("MongoDB down: both /health and /health/ready are 503", async () => {
    assert.notStrictEqual(mongoose.connection.readyState, 1);
    assert.strictEqual((await get("/health")).status, 503);
    assert.strictEqual((await get("/health/ready")).status, 503);
  });
});

const runUpChecks = async () => {
  {
    const live = await get("/health");
    assert.strictEqual(live.status, 200);
    assert.strictEqual(live.body.status, "degraded");
    assert.strictEqual(live.body.dependencies.redis, "down");
    assert.strictEqual(live.body.dependencies.mongo, "up");
    const ready = await get("/health/ready");
    assert.strictEqual(ready.status, 503);
    assert.strictEqual(ready.body.status, "unhealthy");
  }
};

/**
 * POST a JSON body with node:http and resolve as soon as the response
 * arrives. A server that answers 413 without reading a large body would
 * deadlock fetch (it waits to finish sending); this client does not.
 */
const postJson = (path: string, payload: unknown) =>
  new Promise<{ status: number; text: () => Promise<string>; json: () => Promise<any> }>((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const url = new URL(path, app.url);
    const req = http.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": body.length, Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          req.destroy();
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, text: async () => text, json: async () => JSON.parse(text) });
        });
      }
    );
    req.on("error", (error) => {
      // The server may close the socket after an early 413; that is fine once a response arrived.
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET" && (error as NodeJS.ErrnoException).code !== "EPIPE") reject(error);
    });
    req.end(body);
  });

describe("REQ-082: meeting notes up to 50,000 characters of any script", () => {
  const summarize = (text: string) => postJson("/api/ai/summarize-meeting", { workspaceId: WS, text });

  test("50,000 Tamil characters (~150 KB) are accepted and reach the LLM", async () => {
    const before = llmCalls;
    const res = await summarize("த".repeat(50_000));
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body).slice(0, 200));
    assert.strictEqual(llmCalls, before + 1);
  });

  test("50,000 control characters (~300 KB as JSON escapes) are not rejected for size", async () => {
    const res = await summarize("\u0001".repeat(50_000));
    await res.text();
    assert.notStrictEqual(res.status, 413);
  });

  test("50,001 characters get the schema's 400; a 400 KB body gets 413", async () => {
    const tooMany = await summarize("a".repeat(50_001));
    await tooMany.text();
    assert.strictEqual(tooMany.status, 400);
    const huge = await summarize("த".repeat(140_000));
    await huge.text();
    assert.strictEqual(huge.status, 413);
  });

  test("other routes keep the 100 KB limit (a 120 KB /query body is 413)", async () => {
    const res = await postJson("/api/ai/query", { workspaceId: WS, query: "q", padding: "x".repeat(120_000) });
    assert.strictEqual(res.status, 413);
  });
});
