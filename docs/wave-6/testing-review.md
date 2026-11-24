# Wave 6 testing and reliability review (Agent 2, read-only)

Date: 2026-11-15. Repository state: branch `fix/wave-5-stabilization`, HEAD `8b4a304`, Waves 1 to 5 uncommitted in the working tree.
Scope: the test suite in `tests/`, the `npm test` scripts, `docs/testing.md`, `.github/workflows/ci.yml` (test part only), and the Wave 4 and Wave 5 carry-overs (roadmap §28 and §29, review-wave4.md, review-wave5.md).

This file is the only file written. No source, test, package or env file was changed.

## 0. Environment and safety

**Environment used for every run.** These are the Wave 5 final-run variables from impl-log.md (w5-npmtest3.log):
- `TEST_MONGO_URI=mongodb://127.0.0.1:27095` (rm-stab-mongo)
- `TEST_REDIS_URL=redis://127.0.0.1:6395` (rm-stab-redis)
- `REDIS_URL=redis://127.0.0.1:6599` (closed port)
- `MONGO_URI=mongodb://127.0.0.1:27095/rm_w6a2_unused`

Two deviations:
- **Redis database 3.** The timing-stability runs after run 1 and the load runs used `TEST_REDIS_URL=redis://127.0.0.1:6395/3`. Another agent was running Redis-backed tests against database 0 of the same server at the same time (see W6-TEST-02). The final `npm test` used the exact Wave 5 value (database 0).
- **Spawned services.** Services I started myself (the probe auth app and the compose suite) used ports 5970 to 5974.

**Pre-run check for default connection strings.** I grepped `tests/` and `tests/helpers/` for `27017`, `6379`, `localhost`, and `MONGO_URI`/`REDIS_URL` fallbacks.
- **Service fallbacks.** The services fall back to `redis://127.0.0.1:6379` in five places:
  - `ai-service/src/config/redis.ts:12` and `redis-worker.ts:13`
  - `api-gateway/src/middlewares/rate-limit.middleware.ts:41`
  - `document-service/src/config/redis.ts:16`
- **Test files that load those modules.** Every one sets `REDIS_URL` itself, either to `redis://127.0.0.1:6599` or to the disposable test Redis.
- **Files without `REDIS_URL`.** Some test files never set `REDIS_URL`. None of them imports a module that creates a Redis client: I traced the imports of `jwt-hardening`, `request-body-guards`, `rag-context-isolation`, `upload-and-model-validation`, `document-extraction-errors`, `upload-temp-sweep`, `legacy-data-hygiene` and `helpers/gateway.ts`.
- **Child processes.** Every child process gets an explicit `REDIS_URL` and an explicit `MONGO_URI` (dead port 6598 or the disposable server).
- **Test helpers.**
  - `helpers/test-redis.ts:20-24` refuses port 6379 outside CI.
  - `helpers/compose.ts` `cleanChildEnv()` strips `MONGO_*`, `REDIS_*`, `ME_CONFIG_*` and `COMPOSE_*`.
- **Result.** With this environment no test can reach 27017 or 6379, so every test was eligible to run.
  - The real containers on 27017, 6379 and 8081 were not contacted, stopped or modified.
  - Two related low findings are W6-TEST-12 and W6-TEST-19.

**Machine.** Windows 11, Node v22.14.0, npm 10.9.2, 12 logical CPUs (i5-12450H), 17 GB RAM.

## 1. Final `npm test` (task 7)

Command (Git Bash, cwd `D:\ReserchMind`), 19:24:17 to 19:28:37:
```
TEST_MONGO_URI=mongodb://127.0.0.1:27095 TEST_REDIS_URL=redis://127.0.0.1:6395 REDIS_URL=redis://127.0.0.1:6599 MONGO_URI=mongodb://127.0.0.1:27095/rm_w6a2_unused npm test
```

| Stage | tests | suites | pass | fail | cancelled | skipped | duration |
|---|---|---|---|---|---|---|---|
| `test:unit` (`tsx --test tests/*.test.ts`) | 587 | 136 | 586 | 0 | 0 | 1 | 168.1 s |
| `test:timing` (`--test-concurrency=1 tests/*.timing.ts`) | 47 | 13 | 47 | 0 | 0 | 0 | 88.7 s |

- **Exit code:** 0.
- **The skip:** the opt-in compose runtime suite (`(skipped: set TEST_COMPOSE_RUNTIME=1 …) # SKIP`).
- **Login timing:** medians were 198.6 ms (wrong password) and 197.3 ms (unknown e-mail).
- **Match with Wave 5:** the counts are identical to Wave 5 (587/586/0/1 and 47/47).

## 2. Inventory (task 1)

**Files and counts:**
- 63 unit-stage files (`tests/*.test.ts`) and 6 timing files (`tests/*.timing.ts`).
- Helpers: `compose`, `docx-fixtures`, `gateway`, `infra`, `test-env`, `test-mongo`, `test-redis`.
- Fixture: `fixtures/infra-skip.fixture.ts`.
- Runtime counts: 587 unit tests and 47 timing tests.

| Category | Files (examples) | Infrastructure |
|---|---|---|
| Pure unit / static | `auth-flow`, `jwt-hardening`, `lifecycle`, `error-middleware`, `retrieval-filters`, `rag-context-isolation`, `embedding-job-processing`, `dependency-resolution`, `docs-consistency`, `repo-hygiene`, `provision-service-users` (vm), 14 client/frontend files (`client-*`, `frontend-*`, `ai-answer-markdown`, `document-url-guard`) | none (in-process stubs, ephemeral ports) |
| Integration, MongoDB (15 unit-stage files) | `ai-service-health`, `ai-session-privacy`, `document-file-stream`, `document-lifecycle`, `embedding-pointer-jobs`, `legacy-data-hygiene`, `login-throttle`, `refresh-expiry`, `refresh-rotation`, `retrieval-live-documents`, `service-listen` (one suite), `task-workflows`, `workspace-join`, `workspace-member-hydration`, `workspace-owner-permissions` | `TEST_MONGO_URI`; one random `rmtest_<label>_<hex>` db per file, dropped in `after` |
| Integration, Redis | `embedding-pointer-jobs` (db 8, hard-coded), `gateway-rate-limit.timing` (db from URL), `gateway-trust-proxy.timing` (db 10, hard-coded) | `TEST_REDIS_URL`; SCAN+DEL of named patterns, never FLUSH |
| Security process tests (spawn real services) | `required-secrets-boot` (5933), `gateway-cors` (5936), `gateway-trust-proxy.timing` (5931), `service-listen`, `api-docs-flag`, `docx-upload-limits.timing`, `skip-visibility` | child processes |
| Docker | `compose-security` (`docker compose config`, required under CI), `compose-security.runtime` (opt-in, starts containers) | Docker CLI / Engine |
| Timing (serialised) | `docx-extraction-limits`, `docx-upload-limits` (Mongo), `gateway-rate-limit` (Redis), `gateway-trust-proxy` (Redis), `gateway-upstream-timeout`, `login-timing` (Mongo) | as listed |
| Build-heavy | `frontend-bundle` (real Vite build to a temp dir), `client-csp` (real `vite preview` on 5932) | none |

**Finding IDs.** Every `SEC-001` to `SEC-025` and `RT-001` to `RT-011` id named in impl-log.md appears in at least one test file (grep of the ids in `tests/`).

## 3. Timing and lockout stability (task 3)

All runs used the environment in §0. The login-timing statistic printed by the test is shown as "k / u": the median wrong-password time (k) and the median unknown-e-mail time (u), in ms.

### 3.1 Runs

| # | What | Concurrency | Result |
|---|---|---|---|
| L1-L5 | `tests/login-timing.timing.ts` alone ×5 | none of mine | 5/5 pass (2/2 each). k / u: 198.9/203.3, 193.4/192.9, 163.6/163.8, 222.2/213.5, 190.6/176.1 |
| T1-T5 | `tests/login-throttle.integration.test.ts` alone ×5 | none of mine | 5/5 pass (8/8 each), 23.0-25.1 s |
| S1 | timing stage | **another agent's integration batch, and a subset of the timing stage, were running at the same time** | **exit 1: 47 tests, 44 pass, 3 fail**: "the 180,000-paragraph bomb: 413 in < 1 s …" (docx-upload-limits), "concurrency: 40 simultaneous AI queries, exactly 30 forwarded and 10 refused" and "RT-001: Redis goes down: fail open in < 1 s, one log line for the outage" (gateway-rate-limit). Login: 302.1/284.6 (pass). Failure messages were not captured (filtered output) |
| S2-S4 | timing stage ×3 (Redis db 3) | 0 other test processes at start (S3, S4) | 3/3 exit 0, 47/47; 147.9 s, 92.5 s, 89.0 s; login 210.1/212.6, 196.9/193.4, 194.5/194.9 |
| S5 | timing stage **while the unit stage ran** (my own load) | unit stage in parallel | **exit 1: 47, 45 pass, 2 fail**: `docx-extraction-limits` "a large legitimate DOCX (5,000 paragraphs) extracts in < 3 s" (`expected true, actual false`); `docx-upload-limits` "the 180,000-paragraph bomb …" (`event loop blocked 337 ms`, limit 200). Login 212.0/205.6 (pass). The concurrent unit stage: 587/586/0/1, exit 0 |
| S6 | timing stage inside the final `npm test` | none | 47/47, login 198.6/197.3 |
| U1-U3 | unit stage (S5 load run, probe load run, final `npm test`) | U1 and U2 with extra load | 3/3: 587 tests, 586 pass, 0 fail, 1 skipped (login-throttle passed every time) |

**Totals:**
- **login-timing:** 11/11 pass (5 alone, 6 in timing-stage runs, 2 of them under load).
- **login-throttle:** 8/8 pass (5 alone, 3 in unit-stage runs, 2 of them under load).
- **Timing stage:** 4/6 runs green; both failures were under concurrent CPU load.

### 3.2 Paired-statistic probe (login timing)

The probe reproduces the test's measurement in-process: the real auth app on 127.0.0.1:5970 and a throwaway database `rmtest_w6a2probe_*`, dropped afterwards. It was fed to `node --import tsx/dist/loader.mjs -` over stdin, so no file was written.
- **Rounds:** each round is the test's own procedure: 2 warm-ups, then 15 interleaved (known, unknown) pairs.
- **Statistics per round:**
  - the current statistic: `u_med >= 0.6·k_med` and `u_med <= 1.6·k_med + 20`;
  - the Wave 4 proposal: `r = median(u_i/k_i)`, with `0.6 <= r <= 1.6 + 20/k_med`.

| Condition | Rounds | k_med range (ms) | ratio of medians | median paired ratio | single-pair ratio extremes | current fails | paired fails |
|---|---|---|---|---|---|---|---|
| idle | 12 | 188.1-207.2 | 0.984-1.014 | 0.976-1.016 | 0.68 / 1.55 | 0 | 0 |
| unit stage running | 12 | 187.6-666.0 (rounds 1-4: 505-666, about 3× slower) | 0.966-1.094 | 0.826-1.025 | 0.51 / 3.03 | 0 | 0 |

**Historical medians (k / u)** from all 16 logged full runs in the scratch folder, including the one failure:
- **Wave 4 d1 (failure):** 75.7 / 151.3. It failed the upper bound: 151.3 > 1.6·75.7 + 20 = 141.1.
- **Other notable run:** w3fix 106.7 / 140.5 (ratio 1.32).
- **All other runs:** ratios between 0.93 and 1.13.
- **Two time regimes:** absolute k values cluster around about 70 ms and about 200 ms.

**Interpretation:**
- Both statistics have a wide margin today. The vulnerability the test guards against gives a ratio of about 0.1 (about 20 ms against about 200 ms), so neither statistic loses power.
- In 24 rounds the paired statistic was **not measurably more stable** than the ratio of medians. Under load its round-1 value (0.826) was further from 1 than the ratio of medians (1.066), because single pairs vary from 0.51 to 3.03 while one sample shifts between regimes.
- The one historical failure looks like such a regime switch inside one series.
- So the paired median alone is not a sufficient fix. The design in W6-TEST-03 targets the actual noise source.

## 4. Findings

Severity: High / Medium / Low / Info. "In scope" means suitable for the Wave 6 test and CI work, which allows no product features. Line numbers refer to the current working tree.

### W6-TEST-01 (Medium): the timing stage fails under concurrent CPU load
- **Evidence:**
  - **S5, my own unit-stage load:** 2 fails.
    - `docx-extraction-limits.timing.ts` "5,000 paragraphs … < 3 s";
    - `docx-upload-limits.timing.ts:169` "event loop blocked 337 ms" (threshold `< 200`).
  - **S1, another agent's tests running:** 3 fails, including the same bomb test.
  - **No other load:** 4/4 runs green (S2, S3, S4, S6).
  - **Latency thresholds:** `docx-extraction-limits.timing.ts:102-219` (`elapsed < 1000/1500/2000`, `maxLagMs < 200`), `docx-upload-limits.timing.ts:168-206`, `gateway-upstream-timeout.timing.ts:73` (`>= 900 && < 2500`).
- **Root cause:** the thresholds are absolute wall-clock and event-loop numbers. The stage serialises its own files (`--test-concurrency=1`) but cannot protect itself from other processes. The design accepts this (docs/testing.md §3).
- **Recommendation (do not weaken the thresholds; they encode the SEC-002 property):**
  - **CI:** run `npm run test:timing` as its own CI step after `test:unit`, as it is now, and never in parallel with another job on the same runner.
  - **Failure messages:** print the measured value; the bomb test already does.
  - **Load guard:** before each latency-sensitive file, record a 1 s event-loop-lag baseline. When the baseline is already above 50 ms, fail with "environment too noisy (baseline X ms)" instead of a misleading SEC-002 failure. This is a reporting change, not a pass.
  - **Local runs:** document "run nothing else while the timing stage runs".
- **Scope:** in scope (test harness and docs).

### W6-TEST-02 (Medium): shared-Redis key collisions between concurrent test runs
- **Evidence:**
  - **Patterns deleted:** `gateway-rate-limit.timing.ts:60,80,116,119,144-240` deletes `rl:*`, `rl:login:*` and `rl:auth-api:*` in the database named by `TEST_REDIS_URL`.
  - **Hard-coded database indices:**
    - `embedding-pointer-jobs.integration.test.ts:56-57` hard-codes `/8`, deletes the fixed queue key `researchmind:embedding:jobs` (`services/ai-service/src/workers/embedding.worker.ts:19`) and `rl:*` (line 101);
    - `gateway-trust-proxy.timing.ts:132-133` hard-codes `/10`.
  - Both ignore the database index in `TEST_REDIS_URL`.
  - **Coincidence with S1:** run S1 failed two `gateway-rate-limit` assertions ("exactly 30 forwarded", "RT-001 … one log line") while another agent's process ran `docx-upload-limits`, `gateway-rate-limit` and `gateway-trust-proxy` (process started 19:07:33) against the same Redis server.
  - **Isolated reruns:** the same tests passed in S2 to S6, including the heavy-load run S5.
  - **Causality (probable, not proven):** two gateways counting under one `rl:` namespace for 127.0.0.1, plus the other run's `rl:*` deletion, explain both failures.
- **Root cause:** fixed key names and fixed database indices. The isolation unit is the Redis server, not the run.
- **Recommendation:**
  - derive every Redis database from `TEST_REDIS_URL` (for example base, base+1, base+2) instead of literal 8 and 10, and document "one test run per Redis database range";
  - if the limiter or queue prefix becomes configurable in a later wave, use a per-run prefix.
  - CI is unaffected: one run per job.
- **Scope:** in scope (tests and helpers).

### W6-TEST-03 (Low): login-timing statistic, carried over from Wave 4
- **Evidence:** §3. 11/11 passes in this review and 24/24 probe rounds pass with either statistic. The one historical failure is Wave 4 d1 (75.7 / 151.3, upper bound). Test: `tests/login-timing.timing.ts:67-79`.
- **Root cause:** the absolute bcrypt time switches between two regimes (about 70 ms and about 200 ms, CPU frequency and scheduling) during a 30-request series. A switch that lands unevenly on the two series skews the medians. A paired median of single-pair ratios is also sensitive to this: single pairs ranged 0.51 to 3.03 under load.
- **Recommendation (statistically sound, non-weakening):**
  1. **Pairing.** Use ABBA pairing: alternate which request of a pair goes first, which cancels drift and order effects. Use the median of the per-pair ratios with the **same thresholds** (0.6 and 1.6 + 20/k_med).
  2. **Sample size.** Raise the pairs from 15 to 31. The cost is about 6 s more.
  3. **Pre-registered retry rule.** Only on failure, measure up to two more independent series and fail when 2 of 3 fail.
     - Power is unchanged for the real defect: at a true ratio of about 0.1 every series fails.
     - The false-alarm rate drops from about p to about 3p².
  4. **Deterministic guard.** Add a structural test: spy on `comparePasswordForUnknownUser` (or `bcrypt.compare`) and assert it is awaited exactly once for an unknown e-mail. This is the actual security property; keep the cost-equality test that already exists.
- **Scope:** in scope.

### W6-TEST-04 (Low): login-throttle "lock ends" still depends on wall-clock time
- **Evidence:**
  - **Test:** `login-throttle.integration.test.ts:113-124`, with `LOCK_MS=1000` (line 119) and a fixed `setTimeout(1200)` (line 123).
  - **Lock start:** the lock starts at `now`, taken in `recordLoginFailure` after the third failure's bcrypt (`services/auth-service/src/services/login-throttle.ts`, `new Date(now + lockMs)`).
  - **Lock check:** the fourth request's `assertLoginAllowed` must run within 1000 ms of that.
  - **Load data:** under full load a single sign-in took up to 779 ms (w5-evidence.md §run 2).
  - **Results:** 8/8 passes here. The Wave 5 window change (1000 → 30 000 ms) fixed the observed failure and kept every assertion (also confirmed in review-wave5.md item 9a); window expiry keeps its own test at 1000 ms (lines 127-135).
- **Root cause:** a residual margin of a few hundred ms between the lock being written and the 429 check.
- **Recommendation:**
  - set `LOCK_MS` to 5000;
  - after the 429, read `lockedUntil` from the `LoginThrottle` record and wait until `Date.now() > lockedUntil + 100` instead of a fixed 1200 ms;
  - keep the 401, 401, 401, 429, 200 assertions. Alternatively, inject a clock into the throttle.
- **Scope:** in scope.

### W6-TEST-05 (Info): required-secrets-boot kill timer of 90 s
- **Evidence:** `required-secrets-boot.test.ts:50-54`.
  - The services exit 1 right after loading. The timer only bounds a hang (code `null`, which still fails).
  - The assertions are unchanged (exit code 1, the variable named, no value printed).
  - Passed in 3/3 unit-stage runs.
- **Recommendation:** keep it. Optionally log the measured exit time so slow loading stays visible. Not weakening.

### W6-TEST-06 (Medium): D3, root tests import packages that the root does not declare
- **Evidence:** all bare imports in `tests/**/*.ts`, checked against the root `package.json`, which declares mongoose, winston, zod, tsx, `@types/*` and concurrently. The table shows where each package is declared and what version resolves from the root `node_modules` (`npm ls` was run from `D:\`).

| Package | Test files | Declared by | Resolves at root |
|---|---|---|---|
| jsonwebtoken | 24 | all 6 services | 9.0.3 (hoisted) |
| express | 19 | all 6 services | 5.2.1 (hoisted) |
| ioredis | 5 | ai, gateway, document | 6.0.0 (hoisted) |
| jszip | 3 (`document-lifecycle`, `docx-extraction-limits`, `helpers/docx-fixtures`) | **nobody** | 3.10.1, only as `document-service → mammoth → jszip` |
| mongodb | 2 (`compose-security.runtime`, type in `legacy-data-hygiene`) | **nobody** | 7.8.0, only as `mongoose → mongodb` |
| axios | 1 (`client-auth-refresh`) | frontend | 1.21.1 (hoisted in Wave 4) |
| react, react-dom/server, react-markdown | 1 (`ai-answer-markdown`) | frontend | 19.2.7 / 10.1.0 |
| typescript | 1 (`frontend-config`) | frontend + services | 6.0.3 |
| @pinecone-database/pinecone | 1 (`upload-and-model-validation`) | ai-service | 5.1.2 |
| vite | `frontend-bundle.test.ts:43`, `client-csp` (`viteEntry`) by **hard-coded path** `frontend/node_modules/vite/...` | frontend | not at root; nested (D2) |
| tsx internals | `node_modules/tsx/dist/loader.mjs` and `cli.mjs` paths in 9 files | root (tsx) | 4.23.15 |

- **Root cause:** npm workspace hoisting.
  - jszip and mongodb resolve only transitively.
  - The vite path breaks if D2 (`npm dedupe`) hoists vite.
  - The tsx `dist/` paths are internal to the package.
- **Recommendation:**
  - in the dependency batch, declare jszip, mongodb, express, jsonwebtoken, ioredis, axios, react, react-dom, react-markdown, typescript and `@pinecone-database/pinecone` as root devDependencies, pinned to the versions that resolve today, so the lockfile placement does not change;
  - resolve vite through `createRequire(frontend/package.json)` instead of a literal path;
  - optionally use `tsx/esm`;
  - extend `dependency-resolution.test.ts` with a rule that every bare import in `tests/` is declared at the root.
- **Scope:** in scope for the Wave 6 dependency batch (needs package.json and lockfile edits).

### W6-TEST-07 (Medium): the compose runtime suite is not in CI (decision: integrate)
- **What it covers** (`tests/compose-security.runtime.test.ts`, 12 tests), the runtime parts of SEC-001, SEC-014 and RT-009:
  - localhost-only bindings, refused on LAN addresses;
  - Redis NOAUTH and WRONGPASS checks;
  - MongoDB default and anonymous logins refused;
  - each service user limited to its own database;
  - the provisioning script is idempotent, fails closed and prints no password;
  - mongo-express basic auth;
  - auth-service and document-service started from source with their own credentials.
- **Run here:** `TEST_COMPOSE_RUNTIME=1 TEST_COMPOSE_PORT_BASE=5970 node node_modules/tsx/dist/cli.mjs --test tests/compose-security.runtime.test.ts`.
  - **Result:** **12/12 pass, 105.8 s, exit 0**.
  - **History:** the suite was last run in Wave 1 (12/12, 149 s). Waves 2 to 5 changed both services it boots, and it still passes.
  - **Resources** (`docker stats` 75 s in): mongodb 173 MiB, mongo-express 40 MiB, redis 3.4 MiB; CPU below 7 %.
  - **Images:** mongo:7, redis:7 and mongo-express:1.0.2 were already present locally; a cold runner must pull them.
  - **Cleanup** after the run, checked:
    - `docker ps -a`, `docker volume ls` and `docker network ls` show nothing named rmstabtest;
    - no `rm-compose-rt-*` temp dir;
    - ports 5970-5974 are closed.
  - **Teardown design:** `down -v --remove-orphans` in `after()`, with a `process.once("exit")` fallback.
- **Gap while it is not in CI:**
  - a regression in `docker-compose.yml`, `docker-compose.tools.yml` or `docker/mongo/provision-service-users.js` would only be caught at the `docker compose config` level (`compose-security.test.ts`);
  - published-port exposure, authentication behaviour and per-service database isolation would not be caught.
- **CI compatibility (ubuntu-latest):**
  - Docker Engine and Compose v2 are preinstalled;
  - ports 5940-5944 are free on a fresh runner;
  - the runner has a non-loopback eth0 IPv4 address, so the LAN test runs instead of skipping;
  - the suite strips `MONGO_*` and `REDIS_*` from child environments and never loads `.env`.
  - The job's own `mongo` and `redis` service containers are not needed for this suite.
- **Recommendation (integrate):** add a separate CI job `compose-runtime`:
  - same triggers, `runs-on: ubuntu-latest`, `timeout-minutes: 20`;
  - steps: `npm ci`, then `TEST_COMPOSE_RUNTIME=1 npx tsx --test tests/compose-security.runtime.test.ts`;
  - a final `if: always()` safety step `docker compose -p rmstabtest down -v --remove-orphans` (no env file needed);
  - run it in parallel with `typecheck-and-test`;
  - optional: cache the images with `docker pull` in a separate step for clearer timing.
  - Expected cost: about 2 min for the suite, plus `npm ci` and image pulls.
- **Scope:** in scope (CI file). Agent 3 owns the workflow edits.

### W6-TEST-08 (Medium): no coverage measurement
- **Evidence:**
  - Nothing in `package.json`, `ci.yml` or `docs/testing.md` measures coverage (docs/testing.md §6: "No coverage reporting").
  - **Feasibility check:**
    - Command: `node --import …/tsx/dist/loader.mjs --enable-source-maps --test --experimental-test-coverage tests/jwt-hardening.test.ts`.
    - Result: 11/11 pass, and a per-file table mapped to TypeScript sources: `access-token.ts` 100 % lines, 91.67 % branches; "all files" 84.10 / 78.22 / 64.86.
    - So the built-in Node 22 coverage works with tsx and needs no new dependency.
- **Limitation:** code run in spawned child processes (the real `server.ts` tests) is not counted unless `NODE_V8_COVERAGE` is set for the children.
- **Recommendation:** add a non-gating `test:coverage` script for the unit stage, with `--test-coverage-include=services/**/src/** --test-coverage-include=packages/**`, and upload the summary as a CI artifact. Decide thresholds only after a baseline exists. Do not gate merges on coverage in Wave 6.
- **Scope:** in scope (script plus CI step), as non-gating.

### W6-TEST-09 (Medium): missing regression tests for the Wave 4 and Wave 5 carry-overs
- **L1, history redaction above 200 sources:**
  - **Code:** `services/ai-service/src/controllers/query.controller.ts:189-196` (cap 100 sessions) and `services/document-service/src/controllers/document.controller.ts:277,295` (`MAX_LIVE_CHECK_IDS = 200` → 400 → fail-closed redaction of the whole page).
  - **Today:** no test crosses 200. `ai-session-privacy.integration.test.ts` covers paging, and `retrieval-live-documents` covers liveness.
  - **Needed, with the fix:**
    - **below 200:** 200 distinct cited ids on one page; deleted ones are redacted and live ones kept;
    - **above 200:** 201 and more (for example 100 sessions × 3 sources); after batching, live sources are kept and deleted ones redacted, with the same result as two smaller pages;
    - **document-service down:** still fail-closed;
    - **request size:** assert that every liveness request carries at most 200 ids.
- **L3, log inspection:**
  - **Code:** `packages/shared/errors/error.middleware.ts:53` (`console.error(err)` for an AppError with status 500 or above) and `:99` (Mongo-unavailable branch logs the raw `err?.message`).
  - **Today:** `error-middleware.test.ts` never captures `console.error` (grep finds no mock). Only the catch-all path is covered, indirectly (`provider-error-redaction.test.ts:44-45` mocks console).
  - **Needed:** with `t.mock.method(console, "error")`, throw:
    - an `AppError(…, 503)` carrying a token-like message and an attached `config.headers.authorization`;
    - a Mongo server-selection error whose message contains a URI with credentials;
    - a provider-style error.
  - **Assertion:** the logs contain the `describeErrorForLog` form and none of the secret strings.
- **Wave 4 carry-over 2:** no test asserts the clean startup message for `TRUST_PROXY=::0.0.0.0/96`. Add it to the parser and real-gateway cases in `gateway-trust-proxy.timing.ts` (port: see W6-TEST-11).
- **Scope:** in scope, delivered together with each fix (failing test first).

### W6-TEST-10 (Low): tests are never typechecked
- **Evidence:** there is no `tests/tsconfig.json` (roadmap §28 and §29: "Tests typecheck NOT RUN"), and tsx strips types without checking.
- **Ad-hoc check** (no file written): `tsc --noEmit --allowImportingTsExtensions --skipLibCheck --esModuleInterop --resolveJsonModule --module preserve --moduleResolution bundler --target es2022 --jsx react-jsx --strict --types node tests/*.ts tests/helpers/*.ts tests/fixtures/*.ts` → exit 2, **2 errors**:
  - `tests/client-auth-refresh.test.ts(341,69)` TS2353: `skipAuthRefresh` is unknown on `AxiosRequestConfig`. The axios augmentation is in `frontend/src/api/axios.ts:19`, which this test does not load.
  - `tests/document-lifecycle.integration.test.ts(642,35)` TS2322: `string | Buffer` is not assignable to `BlobPart`.
- **Other attempts:** `nodenext` and `node10` attempts produced only configuration noise (extension and deprecation errors), so `bundler` resolution is the workable setting.
- **Recommendation:**
  - add `tests/tsconfig.json` with these options, fix the 2 errors, and run `tsc -p tests` in CI;
  - for the first error, import the augmentation or pass the typed config.
- **Scope:** in scope.

### W6-TEST-11 (Low): hard-coded ports in another agent's and developer range
- **Evidence:**
  - `gateway-trust-proxy.timing.ts:93` (5931);
  - `client-csp.test.ts:89-104` (5932, a real `vite preview` server that is fetched);
  - `required-secrets-boot.test.ts:28` (5933);
  - `gateway-cors.test.ts:112` (5936);
  - `compose-security.runtime.test.ts:45` (default 5940-5944).
- **Impact:**
  - **Refusal tests:** 5931, 5933 and 5936 exit before binding, so a collision mostly costs nothing.
  - **5932:** a collision gives `EADDRINUSE`, or a fetch from someone else's server (false result).
  - **Parallel worktrees:** two worktrees running `npm test` at the same time collide.
  - **CI:** unaffected.
- **Recommendation:**
  - use port 0 or the existing `freePort()` pattern (`docx-upload-limits.timing.ts` already does this) and pass the chosen port;
  - for the compose suite, document `TEST_COMPOSE_PORT_BASE`; it is already supported.
- **Scope:** in scope.

### W6-TEST-12 (Low): two spawn tests load the root `.env` into the real gateway
- **Evidence:**
  - `gateway-cors.test.ts:119` and `gateway-trust-proxy.timing.ts:100` spawn `services/api-gateway/src/server.ts` with `cwd: root`;
  - `server.ts:1-2` calls `dotenv.config()`, which reads `<cwd>/.env`, the user's real root `.env`.
  - Today the variables that matter are passed explicitly (`REDIS_URL` dead port, `JWT_ACCESS_SECRET`, `CORS_ORIGIN`, `TRUST_PROXY`), dotenv does not override them, and the gateway refuses to start. So nothing reaches the real Redis.
  - Every other spawn test uses a temp cwd (`service-listen`, `required-secrets-boot`, `docx-upload-limits`, the compose suite).
- **Root cause:** inconsistent spawn helper.
- **Recommendation:** use a temp cwd, or one shared `spawnService()` helper that always uses a temp cwd, a minimal environment and the loader by URL.
- **Scope:** in scope.

### W6-TEST-13 (Low): Windows and Linux differences in child-process handling; leftovers after interrupted runs
- **Evidence:**
  - `docx-upload-limits.timing.ts:289-293` still starts document-service through `tsx/dist/cli.mjs`, a two-process chain. This is the pattern behind the Wave 4 EBUSY failure in `service-listen` (impl-log.md Wave 4 run 2); the other spawns were moved to `--import loader.mjs`.
  - On Windows, `child.kill("SIGTERM")` is a hard `TerminateProcess`. Graceful-exit paths in children are therefore only exercised on Linux (CI). The in-process `lifecycle.test.ts` covers the shutdown logic itself.
- **Observed here:**
  - no orphaned `server.ts` process after any of my runs (process list checked);
  - no temp dir or database left by the final run;
  - leftovers exist from **interrupted** runs: `%TEMP%\rm-doc-file-*`, `rm-doc-it-*`, `rm-pointer-jobs-*` and `rm-retrieval-*` (2026-11-13 18:10, 11-14 00:52 and 08:31), and `rm-extract-*` (11-11). None is from this review.
  - Leftovers dated today: see W6-TEST-16.
- **Recommendation:**
  - spawn through `--import loader.mjs`, as the other tests do;
  - add a `tests/helpers` startup sweep that warns about `rmtest_*` databases and `rm-*` temp dirs older than one hour (report only, never delete by default).
- **Scope:** in scope.

### W6-TEST-14 (Info): latency assertions inside the parallel unit stage
- **Evidence:**
  - `ai-timeouts-and-heartbeat.test.ts:69` (`< 500` ms), `:83`, `:99`;
  - `embedding-job-processing.test.ts:444` (`< 1000`);
  - `workspace-membership.test.ts:106` (`< 1500`);
  - `workspace-member-hydration.test.ts:111` (`2500 ≤ ms < 4500`);
  - `ai-validation-and-stream.test.ts:307` (`< 5000`) and the ARC-012 `< 1 s` case;
  - `embedding-pointer-jobs.integration.test.ts:354`.
- **Results:** all passed in 3/3 unit-stage runs, two of them with extra load (§3.1).
- **Recommendation:** watch them on the first CI runs (fewer vCPUs). Move them to the timing stage only if CI shows flakes.

### W6-TEST-15 (Low): docs/testing.md is stale
- **Evidence:**
  - §3 (line 93) still says "**456 + 46 tests** run as of Wave 4"; the current counts are 587 + 47.
  - "251 tests" without `TEST_MONGO_URI` (line 86) has not been re-measured since Wave 4.
  - §6 says "AI session listing [has] no route-level tests", but `ai-session-privacy.integration.test.ts` now covers it.
  - §6 says "31 baselined errors, 4 warnings"; line 18 says 3 warnings, and the baseline is 30 (impl-log.md Wave 5 ARC-009).
- **Recommendation:** update the counts and gaps when the Wave 6 test changes land, and pin the counts in one place.
- **Scope:** in scope (docs).

### W6-TEST-16 (Info): unattributed leftovers from today, not removed
- **What:** MongoDB 27095 holds `rmtest_docxlimits_59556457`, with one empty `documents` collection, created by `docx-upload-limits.timing.ts:76`. `%TEMP%\rm-docx-upload-iupsyj` was created 19:07:55.8 +05:30.
- **Attribution:**
  - Another agent's process ran `docx-upload-limits.timing.ts` first in its list (test process created 19:07:45). The timing fits its `before()` hook.
  - My own timing run 2 was stopped about 19:08:01, but at that time it was in `docx-extraction-limits.timing.ts`, which runs first.
  - So these are most likely not mine.
- **Action:** under the rule "never drop anything you did not create", I left both in place. The lead should drop them after asking the agents.

### W6-TEST-17 (Info): skip visibility
- **Evidence:** `skip-visibility.test.ts` passed in every run. The final run reports exactly one skip, with its reason. The CI step sets `CI`, so missing Mongo or Redis fails instead of skipping (`helpers/test-mongo.ts:18-20`, `helpers/test-redis.ts:17-19`).
- **Recommendation:** once W6-TEST-07 lands, make the main CI job assert `skipped == 1` (the opt-in suite that runs in its own job), so a new silent skip turns the build red.
- **Scope:** in scope (CI).

### W6-TEST-18 (Info): no weakened assertions found in Waves 1 to 5
- **Command:** `git diff -U0 HEAD -- tests`. 12 modified files, +1164 / −69 lines. Every removed line was inspected:
  - **Suite-level `{ skip: mongoSkip }` replaced by `infraDescribe`:** document-lifecycle, task-workflows, refresh-rotation, workspace-join. This is an ARC-006 visibility improvement.
  - **`auth-flow` fixtures:** `"user-1"`, `"u-9"` and similar became 24-hex constants; the assertions are identical (R4).
  - **`document-lifecycle`:** the `POST /api/documents` forged-field tests were replaced.
    - The route was removed by design; the replacement test at line 294 asserts 404 for members and non-members and that nothing is stored.
    - The forged-field check moved to the upload route (line 312 onwards).
    - `cloudinaryUrl.startsWith("https://res.cloudinary.com/")` became `cloudinaryUrl === undefined` (line 700): the URL is no longer exposed, so the check is stronger.
  - **`embedding-job-processing`:** stored failure reasons are now the fixed texts (`Indexing failed`), still exact matches (RT-007).
  - **`upload-and-model-validation`:** "junk before `%PDF-`" flipped from accepted to rejected (SEC-020, stronger).
  - **Other modified files:** `ai-validation-and-stream` and `error-middleware` have refactors only.
- **New test files:** 57 test and helper files are untracked, so there is no HEAD diff for them. For their in-wave rewrites I relied on impl-log.md and review-wave4.md / review-wave5.md (login-throttle window, boot timer, client-csp, frontend-config, gateway-health). I re-read the two timing-related ones (§3, W6-TEST-04 and W6-TEST-05) and agree they do not weaken coverage.

### W6-TEST-19 (Low): the Mongo test helper has no real-server guard; the Redis helper has one
- **Evidence:** `helpers/test-redis.ts:20-24` refuses port 6379 outside CI. `helpers/test-mongo.ts` accepts any `TEST_MONGO_URI`, including `mongodb://localhost:27017`, the developer's real server, now running.
- **Data risk:** limited, because tests drop only their own `rmtest_*` databases.
- **Recommendation:** refuse port 27017 (and an empty port) outside CI, matching the Redis helper; the documented disposable ports keep working.
- **Scope:** in scope.

## 5. Recommended Wave 6 testing scope

Priority order. Everything except item 1 is a test, helper, CI or docs change.
1. **Dependency batch (D3, W6-TEST-06).** Declare the root test imports as pinned devDependencies. Resolve vite through `createRequire`. Add a root-imports rule to `dependency-resolution.test.ts`.
2. **CI (with Agent 3):**
   - a separate `compose-runtime` job (W6-TEST-07);
   - `tsc -p tests` (W6-TEST-10);
   - a non-gating coverage report (W6-TEST-08);
   - a `skipped == 1` assertion (W6-TEST-17);
   - keep `test:timing` as its own serialised step (W6-TEST-01).
3. **Carry-over regression tests, written failing first with each fix:**
   - L1, at and above 200 sources;
   - L3, log inspection of the AppError 5xx, Mongo-unavailable and provider branches;
   - the `TRUST_PROXY=::0.0.0.0/96` clean message (W6-TEST-09).
4. **Determinism without weakening:**
   - login-timing: ABBA pairs, 31 pairs, the 2-of-3 rule, and a spy test (W6-TEST-03);
   - throttle lock: wait on `lockedUntil` with `LOCK_MS` 5000 (W6-TEST-04);
   - a noisy-environment guard for the SEC-002 timing tests (W6-TEST-01).
5. **Isolation:**
   - Redis databases derived from `TEST_REDIS_URL` (W6-TEST-02);
   - ephemeral ports (W6-TEST-11);
   - a temp cwd for every spawn and the `--import` loader for `docx-upload-limits` (W6-TEST-12, W6-TEST-13);
   - a guard against Mongo port 27017 (W6-TEST-19);
   - a report-only leftover warning.
6. **Docs:** refresh docs/testing.md counts and gaps (W6-TEST-15).

**Out of scope:** browser E2E (an accepted exception, recorded), live-provider tests, and load tests.

## 6. Cleanup and rule notes

**Clean after my runs:**
- MongoDB 27095: only admin, config and local, plus the unattributed `rmtest_docxlimits_59556457` (W6-TEST-16). Both `rmtest_w6a2probe_*` databases were dropped (confirmed in the output).
- Redis 6395: databases 0, 3, 7, 8 and 10 are empty.
- No rmstabtest container, volume or network.
- Ports 5930-5999 not listening.
- No node test process left.
- No `rm-*` temp dir from my runs.

**Rule deviations, all corrected:**
- Two read-only shell commands contained `$(...)`, against rule 22: a version lookup and a test count. They had no side effects.
- One command briefly redirected output to `/tmp/null`. I deleted that file immediately.
- I stopped my first background loop with TaskStop during timing run 2 so that I could capture failure details. I then checked for leftovers (§6, W6-TEST-16).
