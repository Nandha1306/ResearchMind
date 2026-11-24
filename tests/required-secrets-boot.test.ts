import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { freePort } from "./helpers/spawn-service";

/*
 * Startup requirements added in Wave 5 (real src/server.ts processes):
 *  - SEC-018: auth-service and workspace-service refuse to start without
 *    INTERNAL_SERVICE_TOKEN (member names and the e-mail rule depend on it);
 *  - SEC-019 (b): auth-service refuses to start when JWT_ACCESS_SECRET and
 *    JWT_REFRESH_SECRET are equal (a refresh token would verify as an access
 *    token).
 * Each refusal exits 1, names the variable(s) and never prints a value. The
 * checks run before MongoDB is contacted (MONGO_URI points at a closed port).
 */

const ROOT = path.resolve(__dirname, "..");
const LOADER = pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
const secret = () => crypto.randomBytes(32).toString("hex");

const boot = async (service: string, overrides: Record<string, string | undefined>) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rm-boot-"));
  const env: NodeJS.ProcessEnv = {
    // Wave 6 (W6-TEST-11): an ephemeral port instead of the fixed 5933.
    PORT: String(await freePort()),
    MONGO_URI: "mongodb://127.0.0.1:6598/rmtest_boot",
    REDIS_URL: "redis://127.0.0.1:6599",
    JWT_ACCESS_SECRET: secret(),
    JWT_REFRESH_SECRET: secret(),
    INTERNAL_SERVICE_TOKEN: secret(),
    ...overrides,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  for (const name of ["PATH", "SystemRoot", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name];
  const child = spawn(process.execPath, ["--import", LOADER, path.join(ROOT, "services", service, "src", "server.ts")], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  // Generous: the refusal itself is immediate, but loading the service through
  // the tsx loader took ~19 s in a full parallel `npm test` run. A process that
  // never exits still fails (code null).
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 90_000);
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  try {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* temp dir left behind: not part of the assertion */
  }
  return { code, output, env };
};

describe("Wave 5 startup requirements (SEC-018, SEC-019 b)", () => {
  for (const service of ["auth-service", "workspace-service"]) {
    test(`${service} exits 1 without INTERNAL_SERVICE_TOKEN, naming the variable only`, async () => {
      const { code, output, env } = await boot(service, { INTERNAL_SERVICE_TOKEN: undefined });
      assert.strictEqual(code, 1, output);
      assert.match(output, /INTERNAL_SERVICE_TOKEN/);
      assert.ok(!output.includes(env.JWT_ACCESS_SECRET!), "a secret value was printed");
    });
  }

  test("auth-service exits 1 when JWT_ACCESS_SECRET equals JWT_REFRESH_SECRET, naming both variables only", async () => {
    const same = secret();
    const { code, output } = await boot("auth-service", { JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same });
    assert.strictEqual(code, 1, output);
    assert.match(output, /JWT_ACCESS_SECRET/);
    assert.match(output, /JWT_REFRESH_SECRET/);
    assert.ok(!output.includes(same), "the secret value was printed");
  });
});

/*
 * Wave 6 (W6-SEC-06, A-15): task-service serves POST /internal/workspaces/
 * :id/members/:userId/unassign for workspace-service, so it now refuses to
 * start without INTERNAL_SERVICE_TOKEN (before, member removal silently left
 * the removed member's tasks assigned). The .env.example value is the
 * <placeholder> form, which is refused too.
 */
describe("Wave 6 startup requirement: task-service INTERNAL_SERVICE_TOKEN (W6-SEC-06)", () => {
  test("task-service exits 1 without INTERNAL_SERVICE_TOKEN, naming the variable only", async () => {
    const { code, output, env } = await boot("task-service", { INTERNAL_SERVICE_TOKEN: undefined });
    assert.strictEqual(code, 1, output);
    assert.match(output, /INTERNAL_SERVICE_TOKEN/);
    assert.ok(!output.includes(env.JWT_ACCESS_SECRET!), "a secret value was printed");
  });

  test("task-service exits 1 with the .env.example placeholder value", async () => {
    const example = fs.readFileSync(path.join(ROOT, "services", "task-service", ".env.example"), "utf8");
    const placeholder = /^INTERNAL_SERVICE_TOKEN=(<[^>\r\n]+>)\s*$/m.exec(example)?.[1];
    assert.ok(placeholder, "task-service/.env.example must set INTERNAL_SERVICE_TOKEN to a <placeholder>");
    const { code, output } = await boot("task-service", { INTERNAL_SERVICE_TOKEN: placeholder });
    assert.strictEqual(code, 1, output);
    assert.match(output, /INTERNAL_SERVICE_TOKEN is still set to a placeholder/);
  });
});
