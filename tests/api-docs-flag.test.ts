import assert from "node:assert";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, describe } from "node:test";

/*
 * SEC-016: Swagger UI (/api-docs) is served only when API_DOCS_ENABLED=true
 * (gateway, document-service, task-service); it used to be public. The flag
 * is read when the app module loads, so each case runs in its own child
 * process (real app modules, no infrastructure: Redis on a dead port).
 */

const ROOT = path.resolve(__dirname, "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const SCRIPT = `
const crypto = require("node:crypto");
for (const k of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "INTERNAL_SERVICE_TOKEN"]) process.env[k] ||= crypto.randomBytes(32).toString("hex");
process.env.REDIS_URL = "redis://127.0.0.1:6599";
const target = process.argv[process.argv.length - 1];
(async () => {
  const app = require(target).default;
  const server = app.listen(0, "127.0.0.1", async () => {
    const res = await fetch("http://127.0.0.1:" + server.address().port + "/api-docs/");
    console.log("STATUS=" + res.status);
    process.exit(0);
  });
})();
`;

const statusOf = (appFile: string, flag: string | undefined) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.API_DOCS_ENABLED;
  delete env.NODE_TEST_CONTEXT;
  if (flag !== undefined) env.API_DOCS_ENABLED = flag;
  // Wave 6 (A-5, W6-TEST-12): dead-port connection strings and a temp working
  // directory, so the child can neither reach a real server nor load a .env.
  env.REDIS_URL = "redis://127.0.0.1:6599";
  env.MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rm-apidocs-"));
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(process.execPath, [TSX_CLI, "-e", SCRIPT, path.join(ROOT, appFile)], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  const match = /STATUS=(\d+)/.exec(result.stdout ?? "");
  assert.ok(match, `no status: ${result.stdout}\n${result.stderr}`);
  return Number(match![1]);
};

describe("SEC-016: /api-docs is opt-in (API_DOCS_ENABLED=true)", () => {
  for (const appFile of [
    "services/api-gateway/src/app.ts",
    "services/document-service/src/app.ts",
    "services/task-service/src/app.ts",
  ]) {
    test(`${appFile}: 404 when unset or not "true"; served when "true"`, () => {
      assert.strictEqual(statusOf(appFile, undefined), 404);
      assert.strictEqual(statusOf(appFile, "1"), 404);
      assert.strictEqual(statusOf(appFile, "true"), 200);
    });
  }
});
