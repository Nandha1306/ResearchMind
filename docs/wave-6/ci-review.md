# Wave 6: CI/CD and infrastructure review (Agent 3, read-only)

Date: 2026-11-15. Branch `fix/wave-5-stabilization`, HEAD `8b4a304`. Waves 1 to 5 are uncommitted in the working tree.
Scope: `.github/workflows/ci.yml`, the npm workspace scripts, `package-lock.json`, `docker-compose*.yml`, `tests/` (helpers, skip logic, compose runtime suite), and the CI parts of `docs/`.

This review changed no file other than this one. No git writes were made, no `.env` file was read, and nothing connected to 27017 or 6379. The only infrastructure used was this agent's own throwaway containers (`rm-stab-a3-mongo` on 127.0.0.1:5980 with authentication, `rm-stab-a3-redis` on 127.0.0.1:5981 with `requirepass`). Both were removed afterwards (`docker rm -f -v`). Afterwards neither held any data: only `admin,config,local` were left, and the Redis keyspace was empty.

---

## 1. Summary

- **Verdict:** the current workflow is a reasonable starting point, but it is not yet a Wave 6 gate. It runs on PRs into `develop` and `main` and installs with `npm ci`. It typechecks the six services, builds the frontend and runs `npm test` against Mongo and Redis.
- **What it is missing:**
  - lint and the suppressions ratchet;
  - a typecheck of the tests;
  - the per-service builds;
  - npm audit and coverage;
  - a no-skip gate;
  - authenticated test infrastructure;
  - least-privilege permissions, concurrency and timeouts;
  - pinned actions and a Node pin;
  - the compose runtime suite.
- **CI has never run on the code being stabilized.** 93 files are untracked, including test helpers, `frontend/eslint-suppressions.json` and `docker-compose.tools.yml`. The first PR run will be the first Linux run of about 650 tests.
- **Authenticated Mongo and Redis need no code change, only the right URI shape. This was verified:**
  - Integration suites plus `service-listen`: **147/147 pass, 0 skipped, exit 0**.
  - Redis- and Mongo-backed timing files: **23/23 pass, 0 skipped**.
  - Both runs were against Mongo with root auth and Redis with `requirepass`.
  - `?authSource=admin` is **mandatory**. Two tests rewrite the database path of `TEST_MONGO_URI`. Without `authSource=admin`, `service-listen.test.ts` fails with `MongoDB Connection Failed: Authentication failed` (1 fail, exit 1).
- **The planned Wave 6 gate is feasible with existing tooling.** That covers tsc, ESLint 10 bulk suppressions, `node:test` TAP and coverage through tsx, npm audit, and docker on `ubuntu-latest`. It needs these small additions:
  - `tests/tsconfig.json` (2 type errors to fix);
  - `.nvmrc` and `engines`;
  - two small CI scripts (TAP skip gate, suppressions ratchet);
  - a hardened `TEST_*` guard in the two helpers;
  - the workflow rewrite in section 6.
- **Compose runtime suite: integrate it as a separate, required job.** See section 5.

### Commands run (actual results)

| Check | Command (summary) | Result |
|---|---|---|
| Workflow parse | js-yaml load of `ci.yml` | parses; `on` = push/PR to `develop`,`main`; `permissions`, `concurrency`, `timeout-minutes` all absent |
| Lint at current cap | `npx eslint . --max-warnings 4` (frontend) | exit 0; 0 errors, 3 warnings |
| Lint at ratcheted cap | `npx eslint . --max-warnings 3` (frontend) | **exit 0**; 0 errors, 3 warnings (both `react-hooks/exhaustive-deps` in `TaskDetailModal.tsx:156,167`, plus 1 `react-hooks/incompatible-library` in `RegisterForm.tsx:110`) |
| ESLint unused-suppression behaviour | read `node_modules/eslint/lib/cli.js:497-506` (eslint 10.5.0) | unused suppressions log "There are suppressions left that do not occur anymore" and **return 2** unless `--pass-on-unpruned-suppressions` |
| Tests typecheck (ad hoc, no tsconfig exists) | `tsc --noEmit --strict --module preserve --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --types node` over `tests/*.ts tests/helpers/*.ts` | exit 2, **2 errors**: `client-auth-refresh.test.ts(341,69)` TS2353 `skipAuthRefresh`; `document-lifecycle.integration.test.ts(642,35)` TS2322 Buffer→BlobPart. (With `nodenext` the same files give 197 errors, mostly TS2835 extension rules, so `nodenext` is the wrong setting.) |
| Case sensitivity | Node script: 880 relative imports in 308 files (`tests`, `services`, `packages`, `frontend/src`), each segment matched case-exactly | 0 mismatches, 0 unresolved |
| Case-colliding paths | `git ls-files \| sort -f \| uniq -di` | none |
| Line endings in the index | `git ls-files --eol` | 314 `i/lf`, 4 `i/none`, 1 `i/-text`, 0 `i/crlf`. Working tree: 104 crlf / 197 lf (autocrlf=true). No `.gitattributes` |
| Lockfile | `sha256sum package-lock.json` | `6be5280b…0f12`, identical to the Wave 4 hash for which a plain `npm ci` (no flags) exited 0 (922 packages). No `.npmrc` in the root, frontend or services |
| Linux native optional deps in the lock | Node script over `packages` | present: `@rolldown/binding-linux-x64-gnu`, `lightningcss-linux-x64-gnu` (×2), `@tailwindcss/oxide-linux-x64-gnu`, `@esbuild/linux-x64` |
| Authenticated Mongo URI shapes | driver probes against `rm-stab-a3-mongo` | `/?authSource=admin` OK; `/` (no path) OK; anonymous → code 13 Unauthorized; **path rewritten to `/rmtest_x` without authSource → code 18 AuthenticationFailed**; path + `authSource=admin` OK; mongoose `dbName` option with or without authSource OK |
| Integration suites, authenticated infra | `npx tsx --test tests/*.integration.test.ts tests/service-listen.test.ts` with explicit `TEST_MONGO_URI`/`TEST_REDIS_URL` (credentials, `authSource=admin`, Redis db 7) and dead `MONGO_URI`/`REDIS_URL` defaults | exit 0; **tests 147, pass 147, fail 0, skipped 0**, 227 s |
| Timing files needing Redis/Mongo, authenticated infra | `npx tsx --test --test-concurrency=1` on `docx-upload-limits.timing.ts`, `gateway-rate-limit.timing.ts`, `gateway-trust-proxy.timing.ts` | exit 0; **tests 23, pass 23, fail 0, skipped 0**, 111 s. The Redis outage proxy forwards AUTH transparently |
| Negative: no authSource | `service-listen.test.ts` with `TEST_MONGO_URI=mongodb://user:pw@127.0.0.1:5980/` | exit 1; 1 fail: `workspace-service did not start … Authentication failed` |
| Mongo health-check timing | in-container `mongosh` ping loop right after `docker run` | succeeded on the **first** attempt. The official image's init phase runs a temporary mongod, so an in-container ping does not prove the final, authenticated server is listening |
| tsx and multiple reporters | `tsx --test --test-reporter=tap … --test-reporter=spec …` on the skip fixture | works; TAP shows `# skipped 1` and `# SKIP TEST_MONGO_URI is not set…` |
| tsx and coverage | `tsx --test --experimental-test-coverage --test-coverage-include='tests/helpers/**'` | works; per-file TS line ranges reported (source maps honoured) |
| Prior compose runtime durations | `scratchpad/stab/rt*.log`, `review-rt*.log` | 12 tests; green runs took 108 s, 120 s and 149 s (Windows, images cached). Two earlier runs failed (0/12 and 9/12) before fixes |
| Tools | `actionlint`, `yamllint`, `c8` | not installed, so the YAML was reviewed by hand (no download, per brief) |

The full `npm test` was not run (Agent 2 owns it). `npm audit` was not re-run. Audit numbers below come from the Wave 4 JSON (`scratchpad/stab/w4-audit-after-*.json`, 2026-11-13).

---

## 2. Audit of the current workflow (`.github/workflows/ci.yml`, working tree)

**Diff vs HEAD:** Wave 2 added the `redis:7` service (`ci.yml:25-36`) and `TEST_REDIS_URL: redis://127.0.0.1:6379/7` (`ci.yml:69`). Nothing else changed.

| Aspect | Current state | Assessment |
|---|---|---|
| Triggers | `push` and `pull_request` to `develop`, `main` (`ci.yml:3-7`) | PRs into `develop` are covered. No `workflow_dispatch`. The stabilization branch only runs once a PR is opened |
| Permissions | none declared | the token gets the repository default, which may be read/write. Not least privilege |
| Concurrency | none | superseded PR pushes keep running |
| Timeouts | none | default 360 min per job; a hung test (e.g. a leaked handle) burns 6 h |
| Node | `node-version: '22'` (`ci.yml:47`), floating | no `.nvmrc`, no `engines` anywhere (checked root, frontend, every service and package). Local is 22.14.0 / npm 10.9.2 |
| Caching | `cache: 'npm'` (`~/.npm`, keyed on the lockfile) | adequate |
| Install | `npm ci` (`ci.yml:51`) | correct. No `.npmrc`, so no `legacy-peer-deps` |
| Job graph | one job, `typecheck-and-test` | the first failing step hides every later signal (lint, tests, build) |
| Typecheck | 6 × `npx tsc --noEmit -p services/<svc>` (`ci.yml:53-60`) | good. Default shell is `bash -e`, so the first failure stops the step. Tests are not typechecked |
| Frontend | `npm run build --workspace=frontend` = `tsc -b && vite build` | good |
| Tests | `npm test` = `test:unit && test:timing` (`package.json:16-18`) | `&&` propagates a failure. No skip or count gate. 1 expected skip (compose runtime) |
| Service containers | `mongo:7` on `27017:27017`, `redis:7` on `6379:6379`; no auth; in-container ping health checks | unauthenticated; default ports; published on all runner interfaces; Mongo health check can pass during init (section 1) |
| Test env | `TEST_MONGO_URI: mongodb://localhost:27017`, `TEST_REDIS_URL: redis://127.0.0.1:6379/7` | `localhost` vs `127.0.0.1` is inconsistent. `MONGO_URI`/`REDIS_URL` not set explicitly, so services spawned without them would fall back to `redis://127.0.0.1:6379` (`services/*/src/config/redis*.ts`, `rate-limit.middleware.ts:41`), i.e. the CI Redis |
| Failure masking | no `continue-on-error`, no `\|\| true`, no pipes | none today. But `pipefail` is off (default shell), so any future pipe would mask failures |
| Secrets | none used | good: fork PRs work, and nothing to leak |
| Action pinning | `actions/checkout@v4`, `actions/setup-node@v4` (mutable major tags) | not SHA-pinned; no Dependabot for `github-actions` |
| Checkout credentials | default `persist-credentials: true` | the token stays in `.git/config` for every later step |
| Artifacts | none | failures leave no TAP/log/coverage to inspect |
| Lint, audit, coverage, service builds, compose runtime | absent | all are planned Wave 6 gates |

---

## 3. Findings

Severity: High = would let a broken or insecure change pass the gate, or blocks the gate entirely; Medium = weakens the gate or its reliability; Low = hygiene; Info.
Disposition: **in-scope** (Wave 6 implementation), **out-of-scope** (later wave or deferred), **user action** (needs the repository owner or GitHub settings).

### W6-CI-01: CI has never run on the stabilized code; 93 untracked files must be committed (High, user action)
- **Evidence:**
  - `git status --short --untracked-files=all` lists 93 `??` entries. Among them:
    - `frontend/eslint-suppressions.json`, `docker-compose.tools.yml`, `docker/mongo/provision-service-users.js`;
    - `tests/helpers/{infra,compose,gateway,test-redis,docx-fixtures}.ts`, `tests/fixtures/infra-skip.fixture.ts`;
    - about 40 test files and about 30 source files.
  - Roadmap §28.1 ARC-005: "CI has never been green … no PR run".
- **Root cause:** Waves 1 to 5 are uncommitted. Untracked files are not part of any commit unless they are added explicitly.
- **Recommendation:** commit with `git add -A`, and check that `git status --porcelain` is empty except for `.env*` files and the scratch file. Push the branch and open a PR into `develop`.
  - Expect the first run to be the first Linux run. Section 3.17 lists what was checked statically.
  - Gate: in the test job, add `git status --porcelain --untracked-files=all` after the tests. Any output fails the step. That catches tests that write into the repository, and generated files.

### W6-CI-02: no lint gate; the warning cap is loose; nothing stops new suppressions (High, in-scope)
- **Evidence:**
  - `ci.yml` has no lint step.
  - `frontend/package.json:9` `"lint": "eslint . --max-warnings 4"`. Actual: 3 warnings, and `--max-warnings 3` gives exit 0 (run above).
  - `frontend/eslint-suppressions.json` holds 30 suppressed errors in 12 files and is **untracked**.
  - ESLint 10.5.0 already fails on *stale* suppressions (`cli.js:497-506`, returns 2).
- **Root cause:**
  - Lint was a local gate only (ISS-051), and `package.json` was frozen in Wave 5 (L2).
  - ESLint fails on stale entries, but it does not stop someone from running `--suppress-all` or `--suppress-rule` and committing a *bigger* baseline.
- **Recommendation:**
  1. Set `--max-warnings 3` in `frontend/package.json`.
  2. Add a CI lint step: `npm run lint`. It must not pass `--pass-on-unpruned-suppressions` or `--suppress-*`.
  3. Add a ratchet script, `scripts/ci/check-eslint-suppressions.mjs`:
     - Load the base version with `git show origin/<base>:frontend/eslint-suppressions.json` (needs `fetch-depth: 0`, or a `git fetch origin <base> --depth=1`).
     - Fail if any file/rule `count` is higher than in the base, or if any file/rule pair is new.
     - On `push`, compare with `HEAD^`.
  4. Commit the suppressions file first (W6-CI-01).

### W6-CI-03: tests are never typechecked (High, in-scope)
- **Evidence:**
  - There is no `tests/tsconfig.json` and no root tsconfig; tsx strips types.
  - The ad-hoc strict check (above) found 2 real errors:
    - `client-auth-refresh.test.ts:341`: `skipAuthRefresh` is not in `AxiosRequestConfig`. The module augmentation lives in the frontend and is not visible to the tests.
    - `document-lifecycle.integration.test.ts:642`: Buffer → BlobPart.
- **Root cause:** never configured (roadmap §29.5 carry-over).
- **Recommendation:**
  - Add `tests/tsconfig.json` with `noEmit`, `strict`, `module: preserve`, `moduleResolution: bundler`, `allowImportingTsExtensions`, `skipLibCheck`, `types: ["node"]`, `esModuleInterop`, `resolveJsonModule`, and `include: ["**/*.ts"]`.
  - Fix the 2 errors without weakening any assertion: import the frontend axios augmentation, or cast at the call site; and wrap the Buffer as `new Uint8Array(buf)`.
  - CI step: `npx tsc -p tests`.
  - Note: `nodenext` produced 197 errors, so do not choose it.

### W6-CI-04: no no-skip gate; the CI guards check only that the variables are present (Medium, in-scope)
- **Evidence:**
  - `tests/helpers/test-mongo.ts:18-20` and `test-redis.ts:17-19` throw when `CI` is set but `TEST_*` is not. This works, and `skip-visibility.test.ts:41-44` proves it for Mongo.
  - These are the only defences. Other skip paths exist:
    - `service-listen.test.ts:146`: `t.skip` when there is no non-loopback IPv4;
    - `repo-hygiene.test.ts:16,22`: skip when git is missing;
    - `compose-security.test.ts:82-86`: skip without docker, except under CI;
    - the compose runtime suite: 1 skip unless `TEST_COMPOSE_RUNTIME=1`.
  - `npm test` reports `# skipped N` but nothing asserts on it.
- **Root cause:** skip visibility (ARC-006) was implemented, but skip *enforcement* was not.
- **Recommendation:**
  - Run both stages with two reporters: `--test-reporter=spec --test-reporter-destination=stdout --test-reporter=tap --test-reporter-destination=reports/<stage>.tap`. Verified to work through tsx.
  - Add `scripts/ci/check-tap.mjs <file> --allow-skip "<regex>" --min-tests N`. It fails on:
    - `# fail` > 0, `# cancelled` > 0 or `# todo` > 0;
    - `# tests` below the floor;
    - any `# SKIP` whose reason does not match the allowlist.
  - Allowlist for the main test job: only `set TEST_COMPOSE_RUNTIME=1`. For the compose job: none.
  - Floors: Wave 5 counts were unit 587 and timing 47. Set the floors to the counts of the first green Linux run, and raise them as tests are added.
  - Also fail on `.only(` or `only: true` in `tests/` (grep).

### W6-CI-05: CI infrastructure is unauthenticated, on default ports, published on all interfaces; the test guards are weak (Medium, in-scope)
- **Evidence:**
  - `ci.yml:16-36`: no `MONGO_INITDB_*`, no `--requirepass`, `ports: 27017:27017` / `6379:6379`.
  - `test-redis.ts:20-25`: the port-6379 refusal is **disabled when `CI` is set**.
  - `test-mongo.ts` has **no target guard at all**: any URI is accepted, including port 27017, remote hosts and `mongodb+srv`.
  - `docs/testing.md:106` documents "Port 6379 is refused outside CI".
- **Root cause:** the CI services were written before SEC-001 and SEC-014 hardened the real compose stack, and the guard was relaxed so that CI could use 6379.
- **Recommendation:**
  - **Infrastructure:**
    - Mongo with root auth and Redis with `requirepass`, using per-run generated, masked credentials. No repository secrets: they guard nothing and are unavailable to fork PRs.
    - Bind to loopback on non-default ports (`127.0.0.1:27018`, `127.0.0.1:6380`).
    - `TEST_MONGO_URI=mongodb://ci_root:<pw>@127.0.0.1:27018/?authSource=admin`
    - `TEST_REDIS_URL=redis://:<pw>@127.0.0.1:6380/7`
    - Set `MONGO_URI`/`REDIS_URL` explicitly to dead ports (`mongodb://127.0.0.1:6598/rmtest_unused`, `redis://127.0.0.1:6399`). Any code path that forgets its own URL then fails instead of reaching the CI Redis.
  - **Guards in `test-mongo.ts` and `test-redis.ts`, applied always, not only outside CI.** Refuse:
    - non-loopback hosts (`127.0.0.1`, `::1`, `localhost` only), unless `TEST_ALLOW_NON_LOOPBACK=1`;
    - ports 27017 and 6379;
    - `mongodb+srv:`;
    - a Mongo URI with credentials but no `authSource`;
    - a Redis URL without an explicit database index 1-15.
  - Optional canary: before the first test, refuse a Mongo server that lists any database other than `admin`, `config`, `local` and `rmtest_*`. A real database is then never touched, even when the port is non-default.
  - Keep `skip-visibility.test.ts` green: the fixture deletes `TEST_*`, so a guard that runs only when the variable is set does not change its outcome.
  - Update `docs/testing.md` §2 and §4 accordingly.

### W6-CI-06: `authSource=admin` is mandatory but not documented as such for CI, and not validated (Medium, in-scope)
- **Evidence:**
  - `service-listen.test.ts:153-157` and `docx-upload-limits.timing.ts:269-274` do `new URL(TEST_MONGO_URI); url.pathname = "/rmtest_…"` and pass the result as `MONGO_URI` to a spawned service.
  - The driver then authenticates against that database.
  - Verified: code 18 AuthenticationFailed, and the `service-listen` run failed (exit 1).
  - `docs/testing.md:104` mentions `?authSource=admin` only for the compose database.
- **Root cause:** the URI's database path doubles as the default auth source.
- **Recommendation:** the guard from W6-CI-05 fails fast with a clear message when credentials are present without `authSource`. Document the exact CI URI shape.
  - Passwords must be URL-safe. Hex is the simplest choice; otherwise `encodeURIComponent` them.

### W6-CI-07: the service-container health checks do not prove readiness (Medium, in-scope)
- **Evidence:**
  - `ci.yml:21` checks Mongo with an in-container `mongosh` ping. Locally the equivalent ping succeeded on the first attempt, while the image's init phase (a temporary mongod) was still running.
  - `ci.yml:33` checks Redis with `redis-cli ping`. With `requirepass` that returns `NOAUTH`, but the exit status is still 0, so it "passes" without proving AUTH works.
  - GitHub service containers cannot override the container command, so `redis-server --requirepass` is impossible as a service container.
- **Root cause:** the probes run inside the container and are not authenticated.
- **Recommendation:**
  - Start both with `docker run` steps, loopback-bound with generated credentials (section 6). Mongo can stay a service container, but then its credentials must be static values known before the job starts.
  - Add a host-side readiness step: an authenticated `ping` through the published port, using the repository's own drivers (`node -e` with `mongodb` and `ioredis`), retried for up to 60 s.
  - Add an assertion that unauthenticated access is refused:
    - Redis `PING` returns `NOAUTH`;
    - Mongo `listDatabases` without credentials returns code 13.
  - That proves the auth path the tests rely on.

### W6-CI-08: least privilege, concurrency, timeouts and action pinning are missing (Medium, in-scope; repository setting = user action)
- **Evidence:** no `permissions:`, `concurrency:` or `timeout-minutes:` (parse result above). `@v4` tags. Default `persist-credentials`.
- **Recommendation:**
  - Set `permissions: contents: read` at workflow level.
  - Use `concurrency: { group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`.
  - Set `timeout-minutes` on every job (sizes in section 6).
  - Pin `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` to full commit SHAs with a version comment.
  - Add `.github/dependabot.yml` for `github-actions` (and optionally `npm`, grouped, weekly).
  - Pass `persist-credentials: false` to checkout. Fetch the base ref explicitly where the suppressions ratchet needs it.
  - Never use `pull_request_target`.
  - **User action:**
    - Settings → Actions: default workflow permissions "read repository contents"; require approval for workflows from first-time or outside contributors.
    - Branch protection on `develop` and `main`: require a PR, require the status checks `static`, `build`, `test`, `compose-runtime` and `audit` with "up to date" required; block force-push and deletion.

### W6-CI-09: Node and npm are not pinned (Medium, in-scope)
- **Evidence:**
  - `ci.yml:47` `'22'`.
  - No `.nvmrc`; no `engines` in any `package.json` (checked).
  - `docs/onboarding.md:12` admits "nothing enforces this".
  - `pdfjs-dist`, `openai` and `concurrently` need Node ≥ 22 (`ci.yml:45-46`).
- **Recommendation:**
  - Add `.nvmrc` with `22` (or an exact `22.x.y` if reproducibility matters more than patch updates).
  - Root `package.json`: `"engines": { "node": ">=22.12 <23", "npm": ">=10.9 <11" }`, and optionally `"packageManager": "npm@10.9.2"`.
  - setup-node: `node-version-file: .nvmrc`.
  - Print `node -v` and `npm -v` in the log.
  - Do not set `engine-strict`, because a dependency's own `engines` could then break installs.

### W6-CI-10: `npm ci` on Linux: feasible; drift and re-resolution risks remain (Low, in-scope)
- **Evidence:**
  - No `.npmrc`.
  - The lock hash is unchanged since the Wave 4 run where a plain `npm ci` exited 0 (922 packages) and a plain `npm install --package-lock-only` was a no-op. This was on Windows, per impl-log and `review-wave4-deps.md:85-91`.
  - The lock contains the linux-x64-gnu bindings for rolldown, lightningcss, @tailwindcss/oxide and esbuild.
  - The `--legacy-peer-deps` need comes from `@langchain/community` → `@browserbasehq/stagehand` → `openai ^4` (`review-wave4-deps.md:95`). It affects re-resolution only (`npm install`, `npm audit fix`), not `npm ci`.
- **Expected:** a plain `npm ci` works on ubuntu-latest. It is **not verified on Linux** here, because no Linux Node image was available and pulling one was not allowed.
- **Recommendation:**
  - CI must only ever run `npm ci`. Never use `npm install` or `npm audit fix` in CI.
  - After install, add `git diff --exit-code -- package-lock.json` and `npm ls --depth=0` (Linux, so the drive-letter crash does not apply).
    - `npm ls --all` exits 1 because of 4 known missing optional peers, so use `--depth=0` or an allowlist.
  - Document that a dependency change is made with `npm install --legacy-peer-deps` locally, and then must pass a plain `npm ci` in CI.

### W6-CI-11: no npm audit gate (Medium, in-scope)
- **Evidence:** no audit step. Wave 4 results (2026-11-13):
  - `--omit=dev`: 4 low;
  - full: 20 (0 critical, 2 high: `shadcn` and its nested `zod`, dev-only, fix = semver-major).
- **Root cause:** never added. Advisory data also changes independently of the code.
- **Recommendation:**
  - **Blocking:** `npm audit --omit=dev --audit-level=moderate`. It passes today (4 low).
  - **Ratchet for the full tree:** `npm audit --json`, compared by a small script with a committed `ci/npm-audit-baseline.json`, which lists the allowed advisory IDs with a reason and a review date. Fail on any high or critical advisory not in the baseline.
  - To keep unrelated PRs from going red when a new advisory is published, run the full-tree ratchet as blocking only when `package-lock.json` changes, and nightly (`schedule`) otherwise.
  - Upload the JSON as an artifact.

### W6-CI-12: no coverage (Low/Medium, in-scope)
- **Evidence:** none configured. `--experimental-test-coverage` works through tsx and maps to TS lines (verified).
- **Caveats:**
  - Code running in spawned service processes (`service-listen`, `docx-upload-limits`, `required-secrets-boot`, gateway timing) is not counted.
  - Files that no test loads are invisible, so percentages are overstated.
- **Recommendation:**
  - Unit stage: add `--experimental-test-coverage --test-coverage-include='services/*/src/**' --test-coverage-include='packages/**' --test-coverage-include='frontend/src/**' --test-coverage-exclude='tests/**'` and `--test-reporter=lcov --test-reporter-destination=reports/lcov.info`.
  - Report-only in Wave 6, uploaded as an artifact. Then ratchet with `--test-coverage-lines=<floor(first green)>` (Node 22.8+ supports the threshold flags).
  - Add a report of never-loaded source files (git ls-files minus `SF:` entries).

### W6-CI-13: per-service builds are not in CI (Medium, in-scope)
- **Evidence:**
  - `ci.yml` runs `tsc --noEmit` only.
  - Each service's `build` is `tsc` with `rootDir: ../..` and `start` = `node dist/services/<svc>/src/server.js`.
  - The output layout and emitted JS are never exercised.
- **Recommendation:**
  - Build job: `npm run build -w <svc>` for the 6 services, then the frontend build.
  - Dist smoke: `test -f services/<svc>/dist/services/<svc>/src/server.js`, plus `node -e` requiring a pure module from dist, without starting servers.
  - Never use `--workspaces` blanket commands: `notification-service` is a placeholder whose `test` script exits 1 and which has no tsconfig.

### W6-CI-14: the compose runtime suite never runs anywhere automatically (Medium, in-scope); see section 5 for the decision
- **Evidence:**
  - `compose-security.runtime.test.ts:39-42`: opt-in through `TEST_COMPOSE_RUNTIME=1`.
  - In `npm test` it is the 1 reported skip (roadmap §29.4).

### W6-CI-15: the single-job layout and shell defaults hide failures (Low, in-scope)
- **Evidence:**
  - One job.
  - `run:` without `shell:` runs `bash -e {0}` with no `pipefail`. The design's gates use pipes (`… | xargs`) and `tee`.
- **Recommendation:**
  - Split into parallel jobs (section 6) so that lint, typecheck, build, tests and audit each report.
  - Set `defaults: run: shell: bash`, which GitHub runs as `bash --noprofile --norc -eo pipefail {0}`.
  - Upload artifacts with `if: always()`.

### W6-CI-16: cleanup on failure (Low, in-scope)
- **Evidence:**
  - Hosted runners are ephemeral, so leftovers die with the VM.
  - The compose suite's own teardown (`after` plus a `process.once("exit")` `down -v`, `compose-security.runtime.test.ts:191-200,220`) covers normal and failed test runs. It does not cover a job cancelled or timed out by Actions, which kills the process.
  - `docker compose down` cannot be run by a later step without the generated env file: every variable is `${VAR:?…}`, so interpolation fails.
- **Recommendation:**
  - Final `if: always()` steps remove by label or name, not by compose:
    - `docker ps -aq --filter label=com.docker.compose.project=rmcitest | xargs -r docker rm -fv`
    - the same pattern for `docker network ls -q` and `docker volume ls -q`
    - `docker rm -fv ci-mongo ci-redis`
  - This matters for self-hosted runners and for re-runs on the same VM. It is cheap insurance on hosted runners.

### W6-CI-17: Linux compatibility of tests written on Windows (Low; static checks clean, dynamic run pending)
- **Static evidence (above):**
  - 0 case mismatches over 880 relative imports;
  - no case-colliding paths;
  - the index is all LF;
  - `spawn(process.execPath, [tsx cli.mjs, …])` is used, not `.cmd` shims;
  - temp folders come from `os.tmpdir()`;
  - `windowsHide` is ignored on Linux;
  - CRLF appears only in the RESP protocol helper (correct);
  - path normalisation (`replace(/\\/g, "/")`) is used where module IDs are compared (`frontend-bundle.test.ts:38`).
- **Behavioural differences to expect on Linux:**
  - **Signals:**
    - On Linux, `child.kill("SIGTERM")` delivers a real SIGTERM, so services run their graceful shutdown. On Windows it is a hard kill.
    - Tests already wait up to 5 s and then send SIGKILL (`service-listen.test.ts:190-197`, `docx-upload-limits.timing.ts:316-321`).
    - Shutdown output or exit-code assertions, if any, could differ.
  - **LAN checks:**
    - `service-listen` and the compose runtime "LAN" test use the runner's eth0 address. On Linux a loopback-bound listener refuses it, which is the expected result.
    - The runner has a non-loopback IPv4, so `service-listen.test.ts:146` will not skip.
  - **Timing:**
    - `login-timing.timing.ts` flaked once on Windows under load (roadmap §28.3).
    - Private-repo runners have 2 vCPU; public-repo runners have 4.
    - Keep the timing stage serialized (`--test-concurrency=1`) and in its own step. Do not add automatic retries, which would hide real regressions.
  - **Line endings:** there is no `.gitattributes`. A contributor without `core.autocrlf` could commit CRLF into `docker/mongo/provision-service-users.js` or a shell script. Add `* text=auto eol=lf` (with `*.png binary` etc.).
- **Recommendation:** treat the first PR run as the Linux verification and record its counts. Add `.gitattributes`.

### W6-CI-18: root tests import packages the root does not declare (Low, in-scope; carry-over D3)
- **Evidence:** roadmap §28.5 D3 (axios, express, react and others imported from `tests/`, resolved through hoisting).
- **Risk:** a lockfile re-layout could break test resolution in CI only.
- **Recommendation:** declare them as root `devDependencies` in the same lockfile batch. Then verify with a plain `npm ci` and `npm install --package-lock-only`, which must be a no-op.

### W6-CI-19: CI-related documentation drift (Low, in-scope)
- **Evidence:**
  - `docs/onboarding.md:245`: lint "reports 42 pre-existing problems; it is not a CI gate". Actual: 0 errors, 3 warnings.
  - `ResearchMind_readme.md:47`: "239 tests … Frontend lint is not clean (42 pre-existing problems) and is not run in CI".
  - `docs/reference/environment-variables.md:169`: "CI … sets only `TEST_MONGO_URI` … (`ci.yml:54-58`)". `TEST_REDIS_URL` has been set since Wave 2, and the line numbers are stale.
  - `docs/testing.md:165-167` describes the old workflow.
  - `tests/docs-consistency.test.ts:72-77` pins `testing.md` §4 to contain `redis:7` and `TEST_REDIS_URL`.
- **Recommendation:** update these together with the workflow. Keep the `redis:7` image tag (or update the test in the same change) so the docs test stays meaningful.

### W6-CI-20: images are not pinned (Low, in-scope)
- **Evidence:** `mongo:7` and `redis:7` (floating majors) in CI and compose. `mongo-express:1.0.2` is pinned on purpose (`docker-compose.tools.yml`).
- **Recommendation:** pin CI images to a minor (`mongo:7.0`, `redis:7.4`), or to a digest updated by Dependabot (`docker` ecosystem). Keep compose and CI on the same versions.

### W6-CI-21: `@types/node` ^25 with a Node 22 runtime (Info, out-of-scope)
- **Evidence:** every service's `package.json` has `@types/node ^25.9.x`; the frontend has ^24.
- **Risk:** typecheck could accept Node 23-25-only APIs that fail at runtime on 22.
- **Recommendation:** align to `@types/node ^22` in the next dependency batch, not in Wave 6, because it needs a lockfile change.

### W6-CI-22: placeholder workspaces (Info, out-of-scope)
- **Evidence:**
  - `services/notification-service` has 0-byte sources, no tsconfig, and a `test` script that exits 1.
  - `packages/shared-types` and `packages/shared-utils` are empty.
- **Recommendation:** CI enumerates the six services explicitly (already true). Removal belongs to S15 or ARC-009 follow-up.

---

## 4. Running the suites against authenticated Mongo and Redis

**What works unchanged (verified, section 1):**
- The helpers pass the URI to mongoose and ioredis untouched.
  - `connectTestDatabase` sets the database through the `dbName` option, and cleanup drops it through a second connection with the same URI. The root user may drop any database.
  - The Redis tests set the database index with `url.pathname = "/8"` or `"/10"`. Credentials survive the `URL` round trip.
- `createRedisProxy` is a raw TCP proxy, so AUTH passes through it, including the outage simulations.
- No leftovers after the runs: only `admin`, `config` and `local` remain, and the Redis keyspace is empty.

**What is required:**
- `TEST_MONGO_URI` **must** carry `?authSource=admin` (or the database the user lives in). `service-listen` and `docx-upload-limits` rewrite the path and otherwise fail with AuthenticationFailed.
- `TEST_REDIS_URL` format: `redis://:<password>@127.0.0.1:<port>/<db>`. ioredis takes the password from the URL. Use an ACL user (`redis://user:pw@…`) only if `--user` ACLs are configured.
- Use URL-safe passwords (hex).
- A root user is the simplest CI choice. A least-privilege test user is possible, but it would need `readWriteAnyDatabase`, `dbAdminAnyDatabase` and `listDatabases` for the canary. That is not worth it for a throwaway VM.

**Code and helper changes (in-scope, small):**
1. `tests/helpers/test-mongo.ts` and `tests/helpers/test-redis.ts`: the target guards from W6-CI-05 and W6-CI-06, applied always (including CI), plus the optional "server holds only `rmtest_*` databases" canary.
2. The CI workflow sets `MONGO_URI` and `REDIS_URL` to dead ports explicitly.
3. Docs: the URI shapes in `docs/testing.md` §2 and §4, and `docs/reference/environment-variables.md` §4.

No product code change is needed. All six services already take credentials from `MONGO_URI`/`REDIS_URL`; the compose runtime suite proves this for auth-service and document-service with per-service users.

---

## 5. Docker Compose runtime suite: recommendation **INTEGRATE** as a separate, required job

**What it covers** (`tests/compose-security.runtime.test.ts`, 12 tests). This is the only *runtime* evidence for SEC-001, SEC-014 and RT-009. Static `compose config` tests cannot see these properties:
- every published port is bound to 127.0.0.1, and LAN addresses are refused;
- Redis gives `NOAUTH`/`WRONGPASS` and has `protected-mode yes`;
- default and anonymous Mongo access is rejected;
- each service user is limited to its own database;
- the provisioning script is idempotent and fails closed without printing passwords;
- mongo-express requires basic auth;
- auth-service and document-service boot with their own users and authenticated Redis.

**Fit with `ubuntu-latest`:**
- Docker Engine and Compose v2 are preinstalled.
- The override uses the `!reset` tag (Compose ≥ 2.24), and `start_interval` needs Engine ≥ 25. Both are satisfied on current runners. Locally this ran on Compose 2.39 / Engine 28.4.
- The suite's safety rules hold in CI unchanged:
  - explicit `-p` with a project name matching `rm*test*`;
  - a generated env file in the OS temp directory (the root `.env` does not exist in CI anyway);
  - `container_name: !reset null`;
  - refusal of 27017, 6379 and 8081 and of busy ports;
  - a cleaned child environment.

**Reliability and runtime:**
- Green local runs took 108–149 s with cached images. In CI, add the pulls: `mongo:7` (about 1.2 GB uncompressed locally), `redis:7` and `mongo-express:1.0.2`. That is roughly 1–2 min on hosted runners, so expect 4–6 min in total.
- Docker Hub availability and pull limits are the main external risk. Pre-pull in a separate step with a retry (`for i in 1 2 3; do docker pull … && break; sleep 10; done`), so a registry hiccup shows as an infrastructure failure rather than a test failure.
- Resource use: one mongod, one redis, mongo-express and two Node services. That fits in 7 GB / 2 vCPU.
- History: two early local runs failed (0/12 and 9/12) before the Wave 1 fixes; the three runs since are green.

**How to integrate:**
- A separate job, `compose-runtime`, running in parallel with `test`, with no service containers:
  - `TEST_COMPOSE_RUNTIME=1`
  - `TEST_COMPOSE_PROJECT=rmcitest`
  - `TEST_COMPOSE_PORT_BASE=15940`
- Run only that file, with a TAP reporter. The skip gate requires 0 skips and at least 12 tests.
- Add the label-based `if: always()` cleanup from W6-CI-16, with a `timeout-minutes: 20` job timeout.
- Make it a required check. If it proves flaky in the first week, keep it required but run it nightly instead, and record why. Do **not** silently mark it `continue-on-error`.
- In the main `test` job the file stays in the `tests/*.test.ts` glob as the one allow-listed skip.

**Why not defer:**
- Deferring leaves SEC-001 and SEC-014 verified only by manual opt-in runs on the developer's machine. Those runs sit next to the real `researchmind-*` containers, which is the riskier place to run them.
- The coverage gap would be exactly the security properties that the host remediation (a user action) depends on.

---

## 6. Proposed workflow design (text only; `ci.yml` was not changed)

**Prerequisite files (in-scope for the implementation agent):**
- `.nvmrc`
- root `engines`
- `tests/tsconfig.json`
- `scripts/ci/check-tap.mjs`
- `scripts/ci/check-eslint-suppressions.mjs`
- `scripts/ci/audit-ratchet.mjs` with `ci/npm-audit-baseline.json`
- `scripts/ci/wait-infra.cjs` (authenticated ping and refusal checks using the repository's `mongodb` and `ioredis`)
- `.gitattributes`
- `.github/dependabot.yml`
- `--max-warnings 3`

```yaml
name: ResearchMind CI

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop, main]
  workflow_dispatch:
  schedule:
    - cron: "17 3 * * *"          # nightly: full audit ratchet + compose runtime on develop

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

defaults:
  run:
    shell: bash                    # -eo pipefail

env:
  npm_config_fund: "false"
  npm_config_audit: "false"        # audit runs in its own job

jobs:
  static:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<sha> # v4.x
        with: { persist-credentials: false, fetch-depth: 0 }   # base ref for the suppressions ratchet
      - uses: actions/setup-node@<sha> # v4.x
        with: { node-version-file: .nvmrc, cache: npm }
      - run: node -v && npm -v
      - run: npm ci
      - name: Lockfile unchanged by install
        run: git diff --exit-code -- package-lock.json
      - run: npm ls --depth=0
      - name: Typecheck services
        run: |
          for s in api-gateway auth-service workspace-service document-service task-service ai-service; do
            npx tsc --noEmit -p "services/$s"
          done
      - name: Typecheck frontend
        run: npx tsc -b frontend
      - name: Typecheck tests
        run: npx tsc -p tests
      - name: Lint (max-warnings 3; unused suppressions fail)
        run: npm run lint
      - name: Suppressions may only shrink
        run: node scripts/ci/check-eslint-suppressions.mjs "origin/${{ github.base_ref || 'develop' }}"
      - name: No focused tests
        run: "! grep -RnE '\\.only\\(|only: *true' tests"

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - name: Build services + dist smoke
        run: |
          for s in api-gateway auth-service workspace-service document-service task-service ai-service; do
            npm run build -w "$s"
            test -f "services/$s/dist/services/$s/src/server.js"
          done
      - run: npm run build -w frontend

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      MONGO_URI: mongodb://127.0.0.1:6598/rmtest_unused     # dead: nothing may rely on defaults
      REDIS_URL: redis://127.0.0.1:6399                     # dead
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - name: Start disposable Mongo (auth) and Redis (password), loopback only
        run: |
          MPW=$(openssl rand -hex 24); RPW=$(openssl rand -hex 24)
          echo "::add-mask::$MPW"; echo "::add-mask::$RPW"
          docker run -d --name ci-mongo -p 127.0.0.1:27018:27017 \
            -e MONGO_INITDB_ROOT_USERNAME=ci_root -e MONGO_INITDB_ROOT_PASSWORD="$MPW" mongo:7
          docker run -d --name ci-redis -p 127.0.0.1:6380:6379 \
            redis:7 redis-server --requirepass "$RPW" --save "" --appendonly no --protected-mode yes
          echo "TEST_MONGO_URI=mongodb://ci_root:$MPW@127.0.0.1:27018/?authSource=admin" >> "$GITHUB_ENV"
          echo "TEST_REDIS_URL=redis://:$RPW@127.0.0.1:6380/7" >> "$GITHUB_ENV"
      - name: Wait until authenticated ping works and anonymous access is refused
        run: node scripts/ci/wait-infra.cjs --timeout 90
      - name: Unit stage (with coverage)
        run: |
          mkdir -p reports
          npx tsx --test \
            --experimental-test-coverage \
            --test-coverage-include='services/*/src/**' --test-coverage-include='packages/**' \
            --test-coverage-include='frontend/src/**' --test-coverage-exclude='tests/**' \
            --test-reporter=spec --test-reporter-destination=stdout \
            --test-reporter=tap  --test-reporter-destination=reports/unit.tap \
            --test-reporter=lcov --test-reporter-destination=reports/lcov.info \
            'tests/*.test.ts'
      - name: Unit gate (no unexpected skips, count floor)
        if: always()
        run: node scripts/ci/check-tap.mjs reports/unit.tap --min-tests <first-green-count> --allow-skip 'set TEST_COMPOSE_RUNTIME=1'
      - name: Timing stage (serialized)
        run: |
          npx tsx --test --test-concurrency=1 \
            --test-reporter=spec --test-reporter-destination=stdout \
            --test-reporter=tap  --test-reporter-destination=reports/timing.tap \
            'tests/*.timing.ts'
      - name: Timing gate (zero skips)
        if: always()
        run: node scripts/ci/check-tap.mjs reports/timing.tap --min-tests <first-green-count>
      - name: Tests left the tree clean
        run: test -z "$(git status --porcelain --untracked-files=all -- . ':!reports')"
      - uses: actions/upload-artifact@<sha>
        if: always()
        with: { name: test-reports, path: reports/, retention-days: 14 }
      - name: Remove disposable infrastructure
        if: always()
        run: docker rm -fv ci-mongo ci-redis || true

  compose-runtime:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      TEST_COMPOSE_RUNTIME: "1"
      TEST_COMPOSE_PROJECT: rmcitest
      TEST_COMPOSE_PORT_BASE: "15940"
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - name: Pre-pull images (retry)
        run: |
          for img in mongo:7 redis:7 mongo-express:1.0.2; do
            for i in 1 2 3; do docker pull -q "$img" && break; sleep 10; done
          done
      - name: Compose runtime suite
        run: |
          mkdir -p reports
          npx tsx --test \
            --test-reporter=spec --test-reporter-destination=stdout \
            --test-reporter=tap  --test-reporter-destination=reports/compose.tap \
            tests/compose-security.runtime.test.ts
      - name: Compose gate (zero skips, >= 12 tests)
        if: always()
        run: node scripts/ci/check-tap.mjs reports/compose.tap --min-tests 12
      - uses: actions/upload-artifact@<sha>
        if: always()
        with: { name: compose-reports, path: reports/, retention-days: 14 }
      - name: Remove the throwaway project (label based; compose down needs the generated env file)
        if: always()
        run: |
          L=label=com.docker.compose.project=rmcitest
          docker ps -aq --filter "$L" | xargs -r docker rm -fv
          docker network ls -q --filter "$L" | xargs -r docker network rm
          docker volume ls -q --filter "$L" | xargs -r docker volume rm

  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .nvmrc }
      - name: Production dependencies (blocking)
        run: npm audit --omit=dev --audit-level=moderate
      - name: Full tree ratchet (new high/critical advisories fail)
        run: |
          npm audit --json > audit.json || true     # exit code judged by the ratchet, not by npm
          node scripts/ci/audit-ratchet.mjs audit.json ci/npm-audit-baseline.json
      - uses: actions/upload-artifact@<sha>
        if: always()
        with: { name: npm-audit, path: audit.json, retention-days: 14 }
```

**Notes on the design:**
- `|| true` appears in exactly two places, and both are deliberate:
  - `npm audit --json`: the ratchet script decides the result.
  - The best-effort `docker rm` cleanup.
  - Neither can mask a test or a gate.
- The full-audit ratchet depends on live advisory data. If it turns red on PRs that did not touch the lockfile, guard the step with a `paths`-filter output (`package-lock.json`) and rely on the nightly schedule.
- `tsx --test` with several `--test-reporter` and coverage flags was verified locally (section 1). The exact lcov output path should be checked on the first run.
- `npm ci` runs once per job (four times; the npm cache makes this about 1 min each). Caching `node_modules` between jobs is possible but adds cache-key risk; keep it simple first.
- **Required checks (user action):** `static`, `build`, `test`, `compose-runtime`, `audit`.

---

## 7. Disposition summary

| ID | Severity | Disposition |
|---|---|---|
| W6-CI-01 | High | User action (commit including untracked files, open the PR into `develop`) + in-scope tree-clean gate |
| W6-CI-02 | High | In-scope |
| W6-CI-03 | High | In-scope |
| W6-CI-04 | Medium | In-scope |
| W6-CI-05 | Medium | In-scope |
| W6-CI-06 | Medium | In-scope |
| W6-CI-07 | Medium | In-scope |
| W6-CI-08 | Medium | In-scope (workflow); user action (repo Actions settings, branch protection, required checks) |
| W6-CI-09 | Medium | In-scope |
| W6-CI-10 | Low | In-scope (checks); Linux `npm ci` verified only by the first PR run |
| W6-CI-11 | Medium | In-scope |
| W6-CI-12 | Low/Medium | In-scope (report-only first) |
| W6-CI-13 | Medium | In-scope |
| W6-CI-14 | Medium | In-scope (integrate, section 5) |
| W6-CI-15 | Low | In-scope |
| W6-CI-16 | Low | In-scope |
| W6-CI-17 | Low | In-scope (`.gitattributes`); dynamic Linux check = first PR run |
| W6-CI-18 | Low | In-scope (with a lockfile check) |
| W6-CI-19 | Low | In-scope (docs) |
| W6-CI-20 | Low | In-scope |
| W6-CI-21 | Info | Out-of-scope (dependency batch) |
| W6-CI-22 | Info | Out-of-scope (S15 / ARC-009 follow-up) |

**Not verifiable from this machine** (to be closed by the first green Actions run):
- plain `npm ci` on Linux;
- the full suite on Linux (signals, timing on 2 or 4 vCPU);
- the compose job's duration with cold image pulls;
- `127.0.0.1:` host-IP publishing and masking behaviour in Actions logs.
