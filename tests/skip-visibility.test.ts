import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";

/*
 * ARC-006: a suite skipped for missing infrastructure must show up in the
 * test summary (`# skipped N`), and no test may skip a whole suite through a
 * bare `describe(name, { skip })` again (the runner does not count suites).
 */

const ROOT = path.resolve(__dirname, "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "infra-skip.fixture.ts");

const runFixture = (extraEnv: Record<string, string>) => {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env.TEST_MONGO_URI;
  delete env.TEST_REDIS_URL;
  // Wave 6 (A-5): the child never inherits a real-server connection string.
  env.REDIS_URL = "redis://127.0.0.1:6399";
  env.MONGO_URI = "mongodb://127.0.0.1:6598/rmtest_unused";
  // Otherwise the child reports to this runner instead of printing TAP.
  delete env.NODE_TEST_CONTEXT;
  if (!("CI" in extraEnv)) delete env.CI;
  return spawnSync(process.execPath, [TSX_CLI, "--test", "--test-reporter=tap", FIXTURE], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
};

describe("ARC-006: skipped infrastructure suites are visible", () => {
  test("without TEST_MONGO_URI the suite is reported as skipped (# skipped >= 1), exit 0", () => {
    const result = runFixture({});
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^# skipped [1-9]\d*$/m);
    assert.match(result.stdout, /# SKIP TEST_MONGO_URI is not set/);
    assert.doesNotMatch(result.stdout, /must not run/);
  });

  test("under CI a missing TEST_MONGO_URI fails the run instead", () => {
    const result = runFixture({ CI: "true" });
    assert.notStrictEqual(result.status, 0);
  });

  test("no test file skips a whole suite with a bare describe(..., { skip })", () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(path.join(ROOT, "tests"))) {
      if (!/\.(test|timing)\.ts$/.test(name) || name === "skip-visibility.test.ts") continue;
      const text = fs.readFileSync(path.join(ROOT, "tests", name), "utf8");
      if (/\bdescribe\(\s*[^\n]*,\s*\{\s*skip\b/.test(text)) offenders.push(name);
    }
    assert.deepStrictEqual(offenders, [], "use infraDescribe(name, skipReason, fn) from tests/helpers/infra.ts");
  });

  /*
   * Wave 6 (W6-TEST-01, A-18): a timing test may only be skipped for missing
   * infrastructure, through infraDescribe. No t.skip, { skip }, todo or early
   * environment-based escape in a *.timing.ts file: a noisy machine makes a
   * latency test FAIL with context (helpers/noise.ts), never pass or skip.
   */
  test("no timing file can skip or todo a test itself (infraDescribe only)", () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(path.join(ROOT, "tests"))) {
      if (!name.endsWith(".timing.ts")) continue;
      const text = fs.readFileSync(path.join(ROOT, "tests", name), "utf8");
      if (/\.skip\(|\{\s*skip\b|\bskip\s*:|\.todo\(|\btodo\s*:/.test(text)) offenders.push(name);
    }
    assert.deepStrictEqual(offenders, []);
  });

  test("the noise helper only measures: no skip, no threshold, no environment switch", () => {
    const text = fs.readFileSync(path.join(ROOT, "tests", "helpers", "noise.ts"), "utf8");
    assert.doesNotMatch(text, /skip|todo|process\.env/);
  });
});
