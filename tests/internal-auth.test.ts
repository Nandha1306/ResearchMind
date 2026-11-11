import assert from "node:assert";
import crypto from "node:crypto";
import { test, describe, before, after } from "node:test";
import express from "express";
import { setTestSecrets, listen } from "./helpers/test-env";

/*
 * Service-to-service authentication (packages/shared/auth/internal-auth.middleware.ts).
 * The internal API must fail closed unless a real shared secret is configured:
 * a copied .env.example placeholder or a weak value must never act as a
 * working, publicly known token.
 */

setTestSecrets();

let app: { url: string; close: () => Promise<void> };
const original = process.env.INTERNAL_SERVICE_TOKEN;

before(async () => {
  const { requireInternalServiceToken } = await import("../packages/shared/auth/internal-auth.middleware");
  const { errorMiddleware } = await import("../packages/shared/errors/error.middleware");
  const mini = express();
  mini.get("/internal/ping", requireInternalServiceToken, (_req, res) => res.json({ ok: true }));
  mini.use(errorMiddleware);
  app = await listen(mini);
});

after(async () => {
  process.env.INTERNAL_SERVICE_TOKEN = original;
  await app?.close();
});

const call = (token?: string) =>
  fetch(`${app.url}/internal/ping`, { headers: token ? { "X-Internal-Token": token } : {} });

describe("requireInternalServiceToken", () => {
  test("a real shared secret works; a wrong or missing token is 401", async () => {
    const secret = crypto.randomBytes(32).toString("hex");
    process.env.INTERNAL_SERVICE_TOKEN = secret;
    assert.strictEqual((await call(secret)).status, 200);
    assert.strictEqual((await call("wrong")).status, 401);
    assert.strictEqual((await call()).status, 401);
  });

  test("an unusable configured token (placeholder, weak, short) never authenticates -- even when presented", async () => {
    for (const configured of [
      "<generate-with-openssl-rand-hex-48>",
      "changeme",
      "short-but-not-a-placeholder",
      "",
    ]) {
      process.env.INTERNAL_SERVICE_TOKEN = configured;
      assert.strictEqual((await call(configured || "x")).status, 401, JSON.stringify(configured));
    }
  });
});
