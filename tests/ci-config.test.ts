import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { parse } from "yaml";

/*
 * Wave 6 (WP-8; W6-SEC-07, W6-CI-02..20, W6-TEST-07/08/17; scope amendments
 * A-4, A-6, A-8, A-16, A-17, A-21, A-22): static checks of
 * .github/workflows/ci.yml. GitHub Actions itself is NOT run by this test.
 *
 * Failure masking rule (A-8): no step may use continue-on-error, "|| true" or
 * "|| :". Only the steps named in REPORT_OR_CLEANUP may tolerate a non-zero
 * exit, and they must do it with `set +e` ... `exit 0`.
 */

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");
const raw = fs.readFileSync(WORKFLOW, "utf8");
const wf = parse(raw) as any;

const REQUIRED_JOBS = ["static", "build", "test", "compose-runtime", "audit"];
const REPORT_OR_CLEANUP = new Set([
  "Full dependency tree (report only)",
  "Remove disposable databases",
  "Remove the throwaway compose project (by label)",
]);
/** Actions whose SHA could not be verified would be listed here (A-16 fallback); none are. */
const UNPINNED_RESIDUAL: string[] = [];
const PINNED: Record<string, { sha: string; tag: string }> = {
  "actions/checkout": { sha: "11d5960a326750d5838078e36cf38b85af677262", tag: "v4.4.0" },
  "actions/setup-node": { sha: "49933ea5288caeca8642d1e84afbd3f7d6820020", tag: "v4.4.0" },
  "actions/upload-artifact": { sha: "ea165f8d65b6e75b540449e92b4886f43607fa02", tag: "v4.6.2" },
};

/** Every npm install spelling (install, i, in, …, isntall, add) and audit fix. */
const NPM_INSTALL_FAMILY = /\bnpm\s+(install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add)\b|audit\s+fix/;

/**
 * The shell-level text of a `run:` script: per line, everything from an
 * unquoted `#` (start of a word) is a comment, and quoted strings are blanked.
 * Quotes never span lines here, so apostrophes in comments cannot hide code
 * (W6-R6-10).
 */
const shellText = (run: string): string =>
  run
    .split("\n")
    .map((line) => {
      let out = "";
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          if (c === "\\" && quote === '"') {
            i++;
            continue;
          }
          if (c === quote) {
            quote = null;
            out += c;
          }
          continue;
        }
        if (c === "'" || c === '"') {
          quote = c;
          out += c;
          continue;
        }
        if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
        out += c;
      }
      return out;
    })
    .join("\n");

const jobs = Object.entries<any>(wf.jobs ?? {});
const allSteps = jobs.flatMap(([job, j]) => (j.steps ?? []).map((s: any) => ({ job, ...s })));
const runOf = (job: string, name: string): string => {
  const step = (wf.jobs[job].steps ?? []).find((s: any) => s.name === name);
  assert.ok(step, `${job}: step "${name}" missing`);
  return String(step.run ?? "");
};

describe("CI workflow: triggers, permissions, shell, timeouts", () => {
  test("runs on pull requests into develop (and main), on push, never on pull_request_target", () => {
    const on = wf.on ?? wf[true as any];
    assert.ok(on.pull_request?.branches?.includes("develop"));
    assert.ok(on.pull_request?.branches?.includes("main"));
    assert.ok(on.push);
    assert.strictEqual(on.pull_request_target, undefined);
    assert.doesNotMatch(raw, /pull_request_target/);
  });

  test("the token is read-only at workflow level and no job widens it", () => {
    assert.deepStrictEqual(wf.permissions, { contents: "read" });
    for (const [name, job] of jobs) assert.strictEqual(job.permissions, undefined, `${name} sets its own permissions`);
  });

  test("no repository secrets are used", () => {
    assert.doesNotMatch(raw, /secrets\./);
  });

  test("bash (-eo pipefail) is the default shell, every job has a timeout, superseded PR runs are cancelled", () => {
    assert.strictEqual(wf.defaults?.run?.shell, "bash");
    for (const [name, job] of jobs) assert.ok(Number(job["timeout-minutes"]) > 0, `${name} has no timeout-minutes`);
    assert.ok(wf.concurrency?.group);
  });

  test("the five required jobs exist", () => {
    assert.deepStrictEqual(REQUIRED_JOBS.filter((j) => !wf.jobs?.[j]), []);
  });
});

describe("CI workflow: actions and checkout", () => {
  test("every action is pinned to a full commit SHA with its tag in a comment (or listed as a residual)", () => {
    const uses = [...raw.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(#\s*(\S+))?/gm)];
    assert.ok(uses.length >= 10);
    for (const [, ref, , comment] of uses) {
      const [action, version] = ref.split("@");
      if (UNPINNED_RESIDUAL.includes(action)) continue;
      assert.match(version, /^[0-9a-f]{40}$/, `${ref} is not pinned to a commit SHA`);
      assert.deepStrictEqual({ sha: version, tag: comment }, PINNED[action], `${action}: unexpected pin`);
    }
  });

  test("every checkout uses persist-credentials: false; setup-node reads .nvmrc", () => {
    const checkouts = allSteps.filter((s) => String(s.uses ?? "").startsWith("actions/checkout@"));
    assert.strictEqual(checkouts.length, REQUIRED_JOBS.length);
    for (const s of checkouts) assert.strictEqual(s.with?.["persist-credentials"], false, s.job);
    const setups = allSteps.filter((s) => String(s.uses ?? "").startsWith("actions/setup-node@"));
    for (const s of setups) assert.strictEqual(s.with?.["node-version-file"], ".nvmrc", s.job);
    assert.match(fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim(), /^22\.\d+\.\d+$/);
  });
});

describe("CI workflow: no masked failures (A-8)", () => {
  test("no continue-on-error anywhere", () => {
    assert.doesNotMatch(raw, /continue-on-error/);
  });

  test('no masking construct (||, set +e / +o errexit / +o pipefail, ! cmd, cmd &, if npm/npx/node) outside the named report/cleanup steps', () => {
    for (const s of allSteps) {
      const run = String(s.run ?? "");
      // Stage E (W6-R6-01) and round 2 (W6-R6-10): comments are removed and
      // quoted strings are blanked line by line (they are literal for the
      // shell, e.g. the JavaScript inside `node -e '…'`); the remaining
      // shell-level text must not contain any masking construct.
      const shellLevel = shellText(run);
      if (REPORT_OR_CLEANUP.has(s.name)) continue;
      const where = `${s.job}/${s.name}`;
      assert.doesNotMatch(shellLevel, /\|\|/, `${where} masks a failure with ||`);
      assert.doesNotMatch(shellLevel, /\bset\s+(\+e\b|\+o\s+(errexit|pipefail)\b|\+[a-z]*e[a-z]*\b)/, `${where} turns off errexit/pipefail`);
      assert.doesNotMatch(shellLevel, /(^|[;&|({]|\bthen\b|\bdo\b|\belse\b)\s*!\s/m, `${where} negates a command with !`);
      assert.doesNotMatch(shellLevel, /(?<![&>|])&(?![&>\d])/, `${where} runs a command in the background with &`);
      assert.doesNotMatch(shellLevel, /\b(if|while|until|elif)\s+!?\s*(npm|npx|node)\b/, `${where} wraps a gate command in if/while/until`);
    }
    for (const name of REPORT_OR_CLEANUP) {
      const step = allSteps.find((s) => s.name === name);
      assert.ok(step, `${name} missing`);
      assert.match(String(step.run), /set \+e[\s\S]*exit 0\s*$/);
    }
  });

  test("set +e appears only in the named report/cleanup steps", () => {
    for (const s of allSteps) {
      if (/set\s+\+e\b|set\s+\+o\s+errexit/.test(String(s.run ?? ""))) {
        assert.ok(REPORT_OR_CLEANUP.has(s.name), `${s.job}/${s.name} uses set +e but is not a report/cleanup step`);
      }
    }
  });

  test("no step overrides the shell; no required job has a job-level if (W6-R6-10)", () => {
    for (const s of allSteps) assert.strictEqual(s.shell, undefined, `${s.job}/${s.name} sets shell: ${s.shell}`);
    for (const name of REQUIRED_JOBS) assert.strictEqual(wf.jobs[name].if, undefined, `job ${name} has if: ${wf.jobs[name].if}`);
  });

  test("gate, stage, scan and tree-clean steps run unconditionally or exactly on !cancelled() (W6-R6-01)", () => {
    const gated = allSteps.filter(
      (s) => /gate|stage/i.test(String(s.name)) || ["Reports contain no credentials", "Tests left the tree clean", "Report contains no credentials"].includes(s.name)
    );
    assert.ok(gated.length >= 7, `only ${gated.length} gate/stage steps found`);
    for (const s of gated) {
      assert.ok(s.if === undefined || s.if === "${{ !cancelled() }}", `${s.job}/${s.name} has if: ${s.if}`);
    }
  });

  test("every artifact upload runs only after a successful credential scan in the same job (W6-R5-04)", () => {
    for (const [jobName, job] of jobs) {
      const steps: any[] = job.steps ?? [];
      steps.forEach((s, i) => {
        if (!String(s.uses ?? "").startsWith("actions/upload-artifact@")) return;
        const m = /^\$\{\{ always\(\) && steps\.([a-z0-9-]+)\.outcome == 'success' \}\}$/.exec(String(s.if ?? ""));
        assert.ok(m, `${jobName}/${s.name}: if must be "\${{ always() && steps.<scan>.outcome == 'success' }}", got ${s.if}`);
        const scanIndex = steps.findIndex((x) => x.id === m![1]);
        assert.ok(scanIndex >= 0 && scanIndex < i, `${jobName}/${s.name}: scan step ${m![1]} must come before the upload`);
        assert.match(String(steps[scanIndex].run), /node scripts\/ci\/scan-reports\.mjs /, `${jobName}: step ${m![1]} is not a credential scan`);
        const scanned = String(steps[scanIndex].run).replace(/^.*scan-reports\.mjs\s+/s, "").trim();
        assert.ok(scanned.split(/\s+/).includes(String(s.with?.path).replace(/\/$/, "")), `${jobName}: the scan does not cover ${s.with?.path}`);
      });
    }
  });

  test("no set -x / bash -x (credentials could be echoed)", () => {
    assert.doesNotMatch(raw, /set -x|bash -x|set -o xtrace/);
  });
});

describe("CI workflow: static and build jobs (W6-CI-02/03/10/13, A-21)", () => {
  test("static: npm ci, lockfile unchanged, npm ls --depth=0, typechecks (6 services, frontend, tests), lint, ratchet, no .only", () => {
    const steps = (wf.jobs.static.steps as any[]).map((s) => String(s.run ?? ""));
    const all = steps.join("\n");
    assert.match(all, /^npm ci$/m);
    assert.match(all, /git diff --exit-code -- package-lock\.json/);
    assert.match(all, /npm ls --depth=0/);
    assert.match(all, /for s in api-gateway auth-service workspace-service document-service task-service ai-service; do/);
    assert.match(all, /npx tsc --noEmit -p "services\/\$s"/);
    assert.match(all, /npx tsc -b frontend/);
    assert.match(all, /npm run typecheck:tests/);
    assert.match(all, /npm run lint/);
    assert.match(all, /tests\/lint-ratchet\.test\.ts/);
    assert.match(runOf("static", "No focused tests"), /grep -RnE/);
    // Wave 6 Stage E (W6-R6-09): the only npm install allowed is the exact
    // lock-only drift check (asserted below); no other install, no audit fix.
    const occurrences = all.split("npm install --package-lock-only --ignore-scripts").length - 1;
    assert.strictEqual(occurrences, 1, "exactly one lock-only drift check");
    assert.doesNotMatch(all.replace("npm install --package-lock-only --ignore-scripts", ""), NPM_INSTALL_FAMILY);
    // Round 2 (W6-R6-10): no other job installs either (npm i / npm add are installs too).
    const elsewhere = allSteps
      .filter((s) => s.job !== "static")
      .map((s) => shellText(String(s.run ?? "")))
      .join("\n");
    assert.doesNotMatch(elsewhere, NPM_INSTALL_FAMILY);
  });

  test("static: a real lockfile drift check (lock-only install, then git diff) (W6-R6-09)", () => {
    const run = runOf("static", "Lockfile is npm's stable output (lock-only install changes nothing)");
    assert.match(run, /^npm install --package-lock-only --ignore-scripts$/m);
    assert.match(run, /^git diff --exit-code -- package-lock\.json$/m);
    assert.ok(run.indexOf("npm install --package-lock-only") < run.indexOf("git diff --exit-code"));
  });

  test("build: all six services with a dist entry-point check, then the frontend", () => {
    const run = runOf("build", "Build services and check the dist entry points");
    assert.match(run, /npm run build -w "\$s"/);
    assert.match(run, /test -f "services\/\$s\/dist\/services\/\$s\/src\/server\.js"/);
    assert.match(runOf("build", "Build frontend"), /npm run build -w frontend/);
  });
});

describe("CI workflow: test job (A-4, A-5, A-6, A-7, A-16, D-7)", () => {
  const job = () => wf.jobs.test;

  test("databases run with docker run on loopback, non-default ports, pinned minor images; no service containers", () => {
    assert.strictEqual(job().services, undefined);
    const start = runOf("test", "Start disposable MongoDB (root auth) and Redis (password), loopback only");
    assert.match(start, /-p 127\.0\.0\.1:27018:27017/);
    assert.match(start, /-p 127\.0\.0\.1:6380:6379/);
    assert.doesNotMatch(start, /-p (0\.0\.0\.0:)?(27017|6379):/);
    assert.match(start, /\bmongo:7\.0\b/);
    assert.match(start, /\bredis:7\.4\b/);
  });

  test("the test job pre-pulls its images with retries before starting them (W6-R6-05)", () => {
    const steps = (wf.jobs.test.steps as any[]).map((s) => String(s.name));
    const pull = steps.indexOf("Pre-pull images (retry)");
    const start = steps.indexOf("Start disposable MongoDB (root auth) and Redis (password), loopback only");
    assert.ok(pull >= 0 && pull < start, "pre-pull step missing or after the start step");
    const run = runOf("test", "Pre-pull images (retry)");
    assert.match(run, /for img in mongo:7\.0 redis:7\.4; do/);
    assert.match(run, /for i in 1 2 3; do/);
    assert.match(run, /exit 1/);
  });

  test("compose and CI use the same pinned images", () => {
    const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
    assert.match(compose, /image: mongo:7\.0\b/);
    assert.match(compose, /image: redis:7\.4\b/);
  });

  test("credentials: CSPRNG, masked before any use, passed by -e VAR only, never literal", () => {
    const start = runOf("test", "Start disposable MongoDB (root auth) and Redis (password), loopback only");
    const lines = start.split("\n").map((l) => l.trim());
    const firstMask = lines.findIndex((l) => l.startsWith('echo "::add-mask::'));
    const firstUse = lines.findIndex((l) => /docker run|GITHUB_ENV|export /.test(l));
    assert.ok(firstMask >= 0 && firstMask < firstUse, "::add-mask:: must come before any use");
    assert.match(start, /MONGO_INITDB_ROOT_PASSWORD="\$\(openssl rand -hex 32\)"/);
    assert.match(start, /REDIS_PASSWORD="\$\(openssl rand -hex 32\)"/);
    assert.match(start, /-e MONGO_INITDB_ROOT_PASSWORD(\s|$)/);
    assert.match(start, /-e REDIS_PASSWORD(\s|$)/);
    assert.doesNotMatch(start, /-e [A-Z_]*PASSWORD=/, "a password value on the docker command line");
    assert.match(start, /authSource=admin/);
    assert.match(start, /TEST_REDIS_URL=redis:\/\/:\$\{REDIS_PASSWORD\}@127\.0\.0\.1:6380\/7/);
    const withoutPins = raw.split("\n").filter((l) => !/^\s*(-\s*)?uses:/.test(l)).join("\n");
    assert.ok(!/[0-9a-f]{32,}/.test(withoutPins), "a literal hex secret in the workflow");
  });

  test("dead-port MONGO_URI / REDIS_URL defaults; readiness = authenticated ping and anonymous refusal", () => {
    assert.match(job().env.MONGO_URI, /^mongodb:\/\/127\.0\.0\.1:6598\//);
    assert.match(job().env.REDIS_URL, /^redis:\/\/127\.0\.0\.1:6399$/);
    assert.match(runOf("test", "Wait for authenticated access (anonymous access must be refused)"), /scripts\/ci\/wait-infra\.cjs/);
    const wait = fs.readFileSync(path.join(ROOT, "scripts", "ci", "wait-infra.cjs"), "utf8");
    assert.match(wait, /code === 13/);
    assert.match(wait, /NOAUTH/);
  });

  test("unit stage with coverage (report only), then the serialized timing stage without coverage", () => {
    const unit = runOf("test", "Unit stage (coverage report, TAP)");
    assert.match(unit, /--experimental-test-coverage/);
    assert.match(unit, /--test-reporter=tap --test-reporter-destination=reports\/unit\.tap/);
    assert.match(unit, /--test-reporter=lcov --test-reporter-destination=reports\/lcov\.info/);
    assert.match(unit, /'tests\/\*\.test\.ts'/);
    assert.doesNotMatch(unit, /--test-coverage-(lines|branches|functions)=/, "coverage must not gate (D-6)");
    const timing = runOf("test", "Timing stage (serialized, no coverage)");
    assert.match(timing, /--test-concurrency=1/);
    assert.match(timing, /'tests\/\*\.timing\.ts'/);
    assert.doesNotMatch(timing, /coverage/);
  });

  test("skip/count gates: unit exactly 1 skip with the compose-runtime reason only; timing 0 skips; floors set", () => {
    const unitGate = runOf("test", "Unit gate (0 fail, exactly 1 allowed skip, count floor)");
    assert.match(unitGate, /--skips 1 --allow-skip "set TEST_COMPOSE_RUNTIME=1"$/);
    assert.strictEqual((unitGate.match(/--allow-skip/g) ?? []).length, 1);
    const timingGate = runOf("test", "Timing gate (0 fail, 0 skip, count floor)");
    assert.match(timingGate, /--skips 0$/);
    assert.doesNotMatch(timingGate, /--allow-skip/);
    assert.ok(Number(job().env.UNIT_MIN_TESTS) > 600);
    assert.ok(Number(job().env.TIMING_MIN_TESTS) > 40);
    const runtimeSource = fs.readFileSync(path.join(ROOT, "tests", "compose-security.runtime.test.ts"), "utf8");
    assert.match(runtimeSource, /"set TEST_COMPOSE_RUNTIME=1 /, "the allowed reason must match the suite's own text");
  });

  test("reports are scanned for credentials; the tree must be clean; artifacts and cleanup always run", () => {
    assert.match(runOf("test", "Reports contain no credentials"), /scan-reports\.mjs reports/);
    assert.match(runOf("test", "Tests left the tree clean"), /git status --porcelain --untracked-files=all -- \. ':!reports'/);
    const upload = (wf.jobs.test.steps as any[]).find((s) => s.name === "Upload test reports");
    assert.strictEqual(upload.with.path, "reports/");
    assert.match(String(upload.if), /always\(\)/);
    const cleanup = (wf.jobs.test.steps as any[]).find((s) => s.name === "Remove disposable databases");
    assert.match(String(cleanup.if), /always\(\)/);
    assert.match(String(cleanup.run), /docker rm -fv ci-mongo ci-redis/);
  });
});

describe("scripts/ci/check-tap.mjs refuses missing or invalid floors (W6-R6-04)", () => {
  const TAP = ["TAP version 13", "ok 1 - a", "1..1", "# tests 1", "# suites 0", "# pass 1", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0", ""].join("\n");
  const run = (args: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-checktap-"));
    try {
      const file = path.join(dir, "r.tap");
      fs.writeFileSync(file, TAP);
      return spawnSync(process.execPath, [path.join(ROOT, "scripts", "ci", "check-tap.mjs"), file, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, REDIS_URL: "redis://127.0.0.1:6399", MONGO_URI: "mongodb://127.0.0.1:6598/rmtest_unused" },
      }).status;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  test("a valid floor and skip count pass", () => {
    assert.strictEqual(run(["--min-tests", "1", "--skips", "0"]), 0);
  });
  for (const [label, args] of [
    ["empty --min-tests", ["--min-tests", "", "--skips", "0"]],
    ["--min-tests 0", ["--min-tests", "0", "--skips", "0"]],
    ["negative --min-tests", ["--min-tests", "-5", "--skips", "0"]],
    ["non-numeric --min-tests", ["--min-tests", "1e2", "--skips", "0"]],
    ["missing --min-tests", ["--skips", "0"]],
    ["empty --skips", ["--min-tests", "1", "--skips", ""]],
    ["non-numeric --skips", ["--min-tests", "1", "--skips", "x"]],
  ] as const) {
    test(`${label}: usage error (exit 2)`, () => {
      assert.strictEqual(run([...args]), 2);
    });
  }
});

describe("CI workflow: compose-runtime and audit jobs (D-5, D-6, A-17, A-22)", () => {
  test("compose-runtime: rmcitest / 15940, env file in RUNNER_TEMP, compose >= 2.24, 0 skips and >= 12 tests, label cleanup", () => {
    const job = wf.jobs["compose-runtime"];
    assert.strictEqual(job.env.TEST_COMPOSE_RUNTIME, "1");
    assert.strictEqual(job.env.TEST_COMPOSE_PROJECT, "rmcitest");
    assert.strictEqual(job.env.TEST_COMPOSE_PORT_BASE, "15940");
    const suiteStep = job.steps.find((s: { name?: string }) => s.name === "Compose runtime suite");
    assert.ok(suiteStep, "Compose runtime suite step missing");
    assert.strictEqual(suiteStep.env?.TMPDIR, "${{ runner.temp }}");
    assert.ok(Number(job["timeout-minutes"]) <= 20);
    assert.match(runOf("compose-runtime", "Docker Compose is at least 2.24 (the override uses !reset)"), /b < 24/);
    assert.match(runOf("compose-runtime", "Compose gate (0 fail, 0 skip, at least 12 tests)"), /--min-tests 12 --skips 0$/);
    const cleanup = runOf("compose-runtime", "Remove the throwaway compose project (by label)");
    assert.match(cleanup, /label=com\.docker\.compose\.project=rmcitest/);
    for (const kind of ["ps -aq", "network ls -q", "volume ls -q"]) assert.ok(cleanup.includes(`docker ${kind} --filter "$label"`), kind);
    // The runtime suite must keep not importing the Mongo/Redis test helpers (their CI guards would throw).
    const runtimeSource = fs.readFileSync(path.join(ROOT, "tests", "compose-security.runtime.test.ts"), "utf8");
    assert.doesNotMatch(runtimeSource, /helpers\/test-(mongo|redis)/);
  });

  test("compose LAN check cannot pass silently without a LAN IPv4: it fails under CI and is a counted skip elsewhere (W6-R6-02)", () => {
    const source = fs.readFileSync(path.join(ROOT, "tests", "compose-security.runtime.test.ts"), "utf8");
    const start = source.indexOf('test("published ports are not reachable on the host\'s LAN addresses"');
    assert.ok(start >= 0, "LAN test missing");
    const body = source.slice(start, source.indexOf("\n  });", start));
    const noLan = body.slice(body.indexOf("if (lanAddresses.length === 0)"));
    assert.match(noLan, /if \(process\.env\.CI\) assert\.fail\(/, "must fail under CI");
    assert.match(noLan, /t\.skip\("no non-loopback IPv4 interface/, "must record a skip (counted by the compose gate)");
    assert.doesNotMatch(noLan.slice(0, noLan.indexOf("}") + 1), /t\.diagnostic\(/, "a diagnostic alone lets the test pass");
  });

  test("audit: production tree gates at moderate from the lockfile; the full tree is a report", () => {
    const steps = (wf.jobs.audit.steps as any[]).map((s) => String(s.run ?? ""));
    assert.ok(steps.includes("npm audit --omit=dev --audit-level=moderate"));
    assert.doesNotMatch(steps.join("\n"), /npm ci|npm install/, "audit runs from package-lock.json alone");
    assert.match(runOf("audit", "Full dependency tree (report only)"), /npm audit --json > npm-audit-full\.json/);
  });
});

/*
 * GitHub only allows some expression contexts at each level of a workflow
 * (docs: "Contexts" -> "Context availability"). A context used where it is not
 * available makes the WHOLE workflow file invalid: GitHub then reports a
 * failed run after 0 s and no job runs. That is what happened on the first
 * push (runner.temp in jobs.compose-runtime.env). YAML parsing alone does not
 * catch it, so check the levels the workflow uses.
 */
describe("CI workflow: expression contexts are available where they are used", () => {
  const contextsIn = (value: unknown): string[] => {
    const found: string[] = [];
    for (const m of String(value ?? "").matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      const body = m[1].replace(/'[^']*'/g, "");
      for (const c of body.matchAll(/(?<![\w.-])([a-z_]+)(?=\.|\()/g)) found.push(c[1]);
    }
    return found;
  };
  // Functions that may appear in expressions (not contexts).
  const FUNCTIONS = new Set(["always", "cancelled", "success", "failure", "contains", "startsWith", "endsWith", "format", "join", "toJSON", "fromJSON", "hashFiles"]);
  const check = (where: string, value: unknown, allowed: string[]) => {
    for (const c of contextsIn(value)) {
      if (FUNCTIONS.has(c)) continue;
      assert.ok(allowed.includes(c), `${where} uses the "${c}" context, which GitHub does not allow there (allowed: ${allowed.join(", ")})`);
    }
  };

  test("workflow-level env and concurrency use only github/inputs/vars/secrets", () => {
    for (const [k, v] of Object.entries(wf.env ?? {})) check(`env.${k}`, v, ["github", "secrets", "inputs", "vars"]);
    for (const [k, v] of Object.entries(wf.concurrency ?? {})) check(`concurrency.${k}`, v, ["github", "inputs", "vars"]);
  });

  test("job-level env, if, runs-on and timeout-minutes do not use runner, steps, env or job", () => {
    const JOB_LEVEL = ["github", "needs", "strategy", "matrix", "vars", "secrets", "inputs"];
    for (const [name, job] of Object.entries<any>(wf.jobs)) {
      for (const [k, v] of Object.entries(job.env ?? {})) check(`jobs.${name}.env.${k}`, v, JOB_LEVEL);
      check(`jobs.${name}.if`, job.if, ["github", "needs", "vars", "inputs"]);
      check(`jobs.${name}.runs-on`, job["runs-on"], JOB_LEVEL);
      check(`jobs.${name}.timeout-minutes`, job["timeout-minutes"], JOB_LEVEL);
    }
  });

  test("step-level env and if use only contexts available to steps", () => {
    const STEP_LEVEL = ["github", "needs", "strategy", "matrix", "job", "runner", "env", "vars", "secrets", "steps", "inputs"];
    for (const [name, job] of Object.entries<any>(wf.jobs)) {
      for (const step of job.steps ?? []) {
        const id = `jobs.${name}.steps["${step.name ?? step.uses}"]`;
        for (const [k, v] of Object.entries(step.env ?? {})) check(`${id}.env.${k}`, v, STEP_LEVEL);
        check(`${id}.if`, step.if, STEP_LEVEL);
        for (const [k, v] of Object.entries(step.with ?? {})) check(`${id}.with.${k}`, v, STEP_LEVEL);
      }
    }
  });
});
