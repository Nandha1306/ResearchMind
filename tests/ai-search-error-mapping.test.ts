import assert from "node:assert";
import { test, describe, before, after } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * RT-011: POST /api/ai/search answered a provider failure (Voyage/Pinecone)
 * with a generic 500. It now answers 502 with the same message the answer
 * stream uses, and logs a redacted description (RT-007). REAL ai routes with
 * a membership stub; the query embedder is replaced to fail. No provider call.
 */

setTestSecrets();
process.env.REDIS_URL = "redis://127.0.0.1:6599";
process.env.VOYAGE_API_KEY ||= "test-voyage-key";
process.env.PINECONE_API_KEY ||= "test-pinecone-key";
process.env.PINECONE_INDEX ||= "test-index";
process.env.XAI_API_KEY ||= "gsk_test_key_for_unit_tests";

const WS = "665f1c2b9d3e4a00cccc0111";
const USER = "665f1c2b9d3e4a00dddd0111";
const token = jwt.sign({ userId: USER }, process.env.JWT_ACCESS_SECRET!, { algorithm: "HS256", expiresIn: "5m" });

let aiApp: { url: string; close: () => Promise<void> };
let workspaceStub: { url: string; close: () => Promise<void> };
let voyage: typeof import("../services/ai-service/src/config/voyage");
let originalEmbed: any;

before(async () => {
  workspaceStub = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { isMember: true, isOwner: false } }));
  });
  process.env.WORKSPACE_SERVICE_URL = workspaceStub.url;
  voyage = await import("../services/ai-service/src/config/voyage");
  originalEmbed = voyage.voyageQueryEmbeddings.embedQuery;
  const { default: aiRoutes } = await import("../services/ai-service/src/routes/ai.routes");
  const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
  const mini = express();
  mini.use(express.json());
  mini.use("/api/ai", aiRoutes);
  mini.use(errorMiddleware);
  aiApp = await listen(mini);
});

after(async () => {
  voyage.voyageQueryEmbeddings.embedQuery = originalEmbed;
  await aiApp?.close();
  await workspaceStub?.close();
});

const search = (body: unknown) =>
  fetch(`${aiApp.url}/api/ai/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe("RT-011: semantic search maps provider failures", () => {
  test("a provider 401 (with a key in its message) gives 502 with the stream's message; the log has no key", async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => lines.push(args.map(String).join(" ")));
    voyage.voyageQueryEmbeddings.embedQuery = async () => {
      throw Object.assign(new Error("Request failed 401 api_key=pa-STUBKEY123456"), { status: 401 });
    };
    const res = await search({ workspaceId: WS, query: "anything" });
    const body = await res.json();
    assert.strictEqual(res.status, 502);
    assert.strictEqual(body.message, "Could not search this workspace's documents right now. Please try again.");
    assert.ok(!lines.join("\n").includes("pa-STUBKEY123456"), lines.join("\n"));
  });

  test("a provider timeout also gives 502", async (t) => {
    t.mock.method(console, "error", () => {});
    voyage.voyageQueryEmbeddings.embedQuery = async () => {
      throw Object.assign(new Error("Voyage query embedding timed out after 15000 ms"), { name: "ProviderTimeoutError" });
    };
    const res = await search({ workspaceId: WS, query: "anything" });
    await res.text();
    assert.strictEqual(res.status, 502);
  });

  test("an invalid body is still 400", async () => {
    const res = await search({ workspaceId: WS, query: "   " });
    await res.text();
    assert.strictEqual(res.status, 400);
  });
});
