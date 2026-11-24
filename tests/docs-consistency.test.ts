import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";

/*
 * ISS-031 (documentation residuals) and ARC-012 (README SSE row), plus the
 * Wave 5 behaviour changes the reference docs must describe. Static and
 * deliberately phrase-based: each assertion pins one concrete inaccuracy that
 * was found (absent) or one fact that must be documented (present). It reads
 * files only; it is not a style linter.
 */

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const lines = (rel: string) => read(rel).split(/\r?\n/);

const README = "ResearchMind_readme.md";
const API = "docs/reference/api.md";
const ADR = "docs/adr/0004-rag-pipeline-grok-sse-pinecone.md";
const ARCH = "docs/architecture/system-architecture.md";
const TESTING = "docs/testing.md";
const ENV = "docs/reference/environment-variables.md";
const SECURITY = "docs/architecture/security.md";
const IMPLEMENTED = "implemented.md";

describe("ISS-031 / ARC-012: residual inaccuracies are corrected", () => {
  test("1. README: the SSE status row cites the client-disconnect test (ARC-012)", () => {
    const row = lines(README).find((l) => /SSE stream pass-through/.test(l)) ?? "";
    assert.match(row, /disconnect/);
    assert.match(row, /ai-stream-disconnect\.test\.ts/);
  });

  test("2. api.md: no stale 'generation continuing after a disconnect' item", () => {
    assert.doesNotMatch(read(API), /Generation continuing after a disconnect/);
  });

  test("3-6. ADR-0004: superseded body claims are marked inline (the record stays historical)", () => {
    const body = lines(ADR);
    for (const pattern of [/API Gateway verifies JWT authentication and validates workspace membership/, /constructs structured context with `\[Source N\]`/, /API Gateway\/Workspace Membership level/, /33-phase end-to-end/]) {
      const hits = body.filter((l) => pattern.test(l) && !l.trimStart().startsWith(">"));
      assert.ok(hits.length > 0, `${pattern} (kept as history)`);
      for (const line of hits) assert.match(line, /superseded/i, line);
    }
  });

  test("7-8. system-architecture.md: no auth-service Redis client", () => {
    const arch = read(ARCH);
    assert.doesNotMatch(arch, /auth-service `redisClient`/);
    assert.doesNotMatch(arch, /Redis connect in background/);
  });

  test("9. auth-service README: redis is no longer described as still declared", () => {
    assert.doesNotMatch(read("services/auth-service/README.md"), /still declared in `package\.json`/);
  });

  test("10. README: list routes have `meta` paging (only error codes are absent)", () => {
    assert.doesNotMatch(read(README), /or `meta` pagination yet/);
  });

  test("11. README: the Q&A prompt is described with nonce-tagged source blocks, not [Source N] labels", () => {
    assert.doesNotMatch(read(README), /retrieved chunks \(with `\[Source N\]` labels\)/);
  });

  test("12. testing.md: frontend lint is not marked as failing", () => {
    const lint = lines(TESTING).find((l) => /^# Frontend lint/.test(l)) ?? "";
    assert.ok(lint, "lint line present");
    assert.doesNotMatch(lint, /fails/);
  });

  test("13. testing.md: the CI section lists the Redis service", () => {
    const testing = read(TESTING);
    const ci = testing.slice(testing.indexOf("## 4. Continuous integration"));
    assert.match(ci, /redis:7/);
    assert.match(ci, /TEST_REDIS_URL/);
    assert.doesNotMatch(ci, /Not in CI:[^\n]*Redis/);
  });

  test("14. README: CI is described with MongoDB AND Redis service containers", () => {
    for (const line of lines(README).filter((l) => /with a MongoDB service container/.test(l))) {
      assert.match(line, /Redis/, line.slice(0, 120));
    }
  });

  test("15. implemented.md: no stale voyage-4 / 'nothing detects that' claims", () => {
    const text = read(IMPLEMENTED);
    assert.doesNotMatch(text, /`\.env\.example` and docs say `voyage-4`/);
    assert.doesNotMatch(text, /`\.env\.example` and docs `voyage-4`/);
    assert.doesNotMatch(text, /leaves old vectors incompatible, and nothing detects that/);
  });

  test("16. implemented.md: the ARC-009 dead files and verifyPineconeIndex are no longer listed as present", () => {
    const text = read(IMPLEMENTED);
    assert.doesNotMatch(text, /`components\/workspace\/InviteTeamStep\.tsx`/);
    assert.doesNotMatch(text, /`generateGrokResponse`, `verifyPineconeIndex`/);
  });
});

describe("Wave 5: the reference docs describe the new behaviour", () => {
  test("environment variables: CORS_ORIGIN (gateway), API_DOCS_ENABLED, UPLOAD_TMP_DIR, required INTERNAL_SERVICE_TOKEN, distinct JWT secrets", () => {
    const env = read(ENV);
    for (const name of ["CORS_ORIGIN", "API_DOCS_ENABLED", "UPLOAD_TMP_DIR"]) assert.match(env, new RegExp(name), name);
    assert.match(env, /INTERNAL_SERVICE_TOKEN[^\n]*(required|refuses to start)/i);
    assert.match(env, /JWT_REFRESH_SECRET[^\n]*(differ|different|distinct)/i);
  });

  test("api.md: JSON 404 for unknown routes, /health/ready, private paged AI sessions, search 502, the auth limiter", () => {
    const api = read(API);
    assert.match(api, /Route not found/);
    assert.match(api, /\/health\/ready/);
    assert.match(api, /sessions[^\n]*(only the caller's|your own|private)/i);
    assert.match(api, /authApiRateLimiter|60 requests per minute/);
  });

  test("security.md: no reference to the deleted document.schema.ts; TRUST_PROXY note for the auth limiters", () => {
    const security = read(SECURITY);
    assert.doesNotMatch(security, /schemas\/document\.schema\.ts/);
    assert.match(security, /TRUST_PROXY/);
    assert.match(security, /bcrypt[^\n]*10/i);
  });
});
