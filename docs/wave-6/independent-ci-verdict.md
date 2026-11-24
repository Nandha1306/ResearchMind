# Wave 6: independent CI and regression verdict (Agent 6)

Reviewer: Agent 6, the independent CI and regression reviewer. I did not plan or implement Wave 6. Every result below comes from commands I ran myself on 2026-11-15 between 22:00 and 22:41 (+05:30). I treated `w6-evidence.md` only as a list of claims to check.
Repository: `D:\ReserchMind`, branch `fix/wave-5-stabilization`, HEAD `8b4a304`. Waves 1 to 6 are uncommitted in the working tree.
Environment: Windows 11, Node 22.14.0, npm 10.9.2, Docker Compose 2.39.2.
Rules followed: `stab/w6-rules.md`. I made no git writes and did not read or touch any `.env` file. Their mtimes still match the values recorded at the start of Wave 6. I did not connect to 27017 or 6379. My own artifacts are scratch logs under `stab/w6r6/`.

## Current verdict (final recheck, round 2, 2026-11-24 afternoon): **PASS**

W6-R6-10 is closed: all of B1–B8 and every earlier mutation now fail the CI-config test (36 tests), and the real `ci.yml` passes 36/36.

What I verified:
- Counts equal the new floors: unit 794 tests, 793 pass, 1 skip; timing 57 tests.
- `check-tap` fails at 795 and at 58.
- tsc, lint (a 4th warning fails it), all builds, YAML parse and a clean `npm ci` all pass.
- The lockfile hash and the manifests are unchanged.
- The roadmap §1–29 hash is unchanged.

One timing test failed in the full run under host memory and CPU pressure. It passed 3/3 when rerun alone, and the full timing stage rerun gave 57/57. This is recorded honestly in the "Final recheck (round 2)" section.

Two new Low, non-blocking hardening items are open: W6-R6-11 and W6-R6-12.

**GitHub Actions has still not run this workflow.**

## Earlier verdict (re-review, 2026-11-24 morning): **PASS**

All nine first-review findings, W6-R6-01 to W6-R6-09, are verified closed. The Stage E corrections pass every check I re-ran:
- full `npm test`: unit 783 tests, 782 pass, 1 skip; timing 55/55;
- the CI floors equal these counts;
- the CI-config test, 34/34;
- tsc, lint, builds and a clean `npm ci`;
- the lockfile hash is unchanged at `a0c8f16a…8953`.

One new finding is open: W6-R6-10, Low and non-blocking. The CI-config test still misses a handful of deliberate bypass constructs. Details are in the "Re-review" section at the end.

**GitHub Actions has still not run this workflow.**

The first review's text below is kept unchanged.

## First-review verdict (2026-11-15): **PASS WITH CORRECTIONS**

All gates that can be reproduced locally pass on the commit-equivalent tree:
- full `npm test` with the disposable env;
- the CI-equivalent unit and timing stages, with their gates, against new authenticated databases;
- the compose runtime suite: 12/12 tests, 0 skipped, fully cleaned up;
- clean `npm ci` and `npm ci --omit=dev`;
- all typechecks, all seven builds and lint;
- both audit gates.

Wave 6 changed exactly 57 lockfile entries: 49 removed, 2 flag-only, 6 workspace manifests, 0 added and 0 version changes.

The findings are 4 Low and 5 Info. None of them blocks. The Low ones are:
- a gap in the CI-config test's detection of masked failures;
- a wrong documentation claim about the compose LAN check, with a small test-design gap behind it;
- stale CI lines in the README;
- a floor that defaults to 0 in `check-tap.mjs` when its value is empty.

Each has an exact correction below.

**GitHub Actions has NOT run this workflow.** Nothing was pushed and no PR exists. The following stay unverified until the first real run:
- Linux runner behaviour: signals, timing thresholds on 2 to 4 vCPUs, `npm ci` on linux-x64;
- secret masking in the Actions log;
- artifact upload;
- the `cache: npm` behaviour;
- runner Docker/Compose versions;
- the compose LAN check on a runner network.

## 1. Workflow and helper scripts (`.github/workflows/ci.yml`, `scripts/ci/*`)

| Check | Evidence | Result |
|---|---|---|
| Triggers | `on.pull_request.branches: [develop, main]`, `push: [develop, main]`, `workflow_dispatch`. No `pull_request_target` (ci.yml:8-13) | OK |
| Five jobs | `static` (20 min), `build` (20), `test` (45), `compose-runtime` (20), `audit` (10). Every job has `timeout-minutes` | OK |
| Shell / pipefail | `defaults.run.shell: bash`. GitHub then runs `bash --noprofile --norc -eo pipefail`, so each multi-line `run` stops at the first failing command | OK |
| Failure masking | `grep -n '\|\|' ci.yml` finds only the concurrency expression (line 20) and a JS `\|\|` inside `node -e` (line 229). No `continue-on-error`. `set +e` appears only in the three report/cleanup steps, and each ends with `exit 0` | OK |
| Gate conditions | The gate steps use `if: ${{ !cancelled() }}`, so they run even after a failed stage, and their own exit fails the job. Uploads and cleanups use `always()` | OK |
| Concurrency | The group is keyed by PR number or ref. Only superseded PR runs are cancelled | OK |
| Node / caching | `node-version-file: .nvmrc` (22.14.0) in all 5 jobs. `cache: npm` in 4 jobs; `audit` installs nothing | OK |
| Permissions and checkout | `permissions: contents: read`. `persist-credentials: false` on all 5 checkouts | OK |
| Action pins | I checked them independently with `git ls-remote https://github.com/actions/<name> refs/tags/<tag>`: checkout v4.4.0 = `11d5960a…7262`, setup-node v4.4.0 = `49933ea5…0020`, upload-artifact v4.6.2 = `ea165f8d…fa02`. All equal the pins | OK |
| Authenticated DBs | `mongo:7.0` with a root user and `redis:7.4` with `requirepass`, on `127.0.0.1:27018` / `127.0.0.1:6380`. Passwords come from `openssl rand -hex 32`, `::add-mask::` runs before any use, and values pass as `-e VAR` only. `TEST_MONGO_URI` has `?authSource=admin`; `TEST_REDIS_URL` uses base `/7`. `MONGO_URI` and `REDIS_URL` point at dead ports | OK |
| Readiness | `wait-infra.cjs` requires an authenticated Mongo ping, an anonymous `listDatabases` that fails with code 13, an authenticated Redis PONG, and an anonymous raw `PING` answered with `-NOAUTH`. Negative runs (mine): against the unauthenticated disposable servers it ran `mongo authenticated ping: OK` then `mongo anonymous access refused: FAILED`, **exit 1**; with nothing listening it reported `FAILED (MongoServerSelectionError)`, **exit 1** | OK |
| Skip/count gates | Unit: `--min-tests 752 --skips 1 --allow-skip "set TEST_COMPOSE_RUNTIME=1"`. Timing: `--min-tests 52 --skips 0`. Compose: `--min-tests 12 --skips 0`. `check-tap.mjs` requires fail, cancelled and todo to be 0, requires an exact skip count, and checks the reason prefix | OK (see W6-R6-04) |
| `check-tap.mjs` against real TAP | My unit TAP passed (exit 0) and my timing TAP passed (exit 0). Mutated copies of the real unit TAP (`stab/w6r6/gate/`) were all rejected with **exit 1**: `# fail 1`, `# todo 1`, `# cancelled 2`, `# skipped 2`, summary removed, a second skip with a different reason, `# tests 751` (below the floor). The real unit TAP also failed with `--skips 0` and without `--allow-skip` (exit 1). A missing file gave exit 1 and a missing `--min-tests` gave exit 2. **An empty `--min-tests ""` gave exit 0** (W6-R6-04) | OK with W6-R6-04 |
| Coverage | lcov comes from the same unit-stage run whose TAP is gated. It is report-only, with no threshold flags | OK |
| `scan-reports.mjs` | A probe file containing `mongodb://ci_root:<hex>@…` gave exit 1. Placeholder shapes (`<password>`, `***`) gave exit 0 | OK |
| Tree-clean | `git status --porcelain --untracked-files=all -- . ':!reports'`. Locally, after my `npm test`, the `CI=true` authenticated run and the compose run, the full status list was identical to the implementer's final snapshot (299 lines). The only later change is the security reviewer's new verdict file | OK |
| Lockfile / npm ls / no-.only | `git diff --exit-code -- package-lock.json` after `npm ci` (see W6-R6-09). `npm ls --depth=0`. `grep -RnE '\.only\(\|only: *true' tests` gave exit 1, meaning no match | OK |
| Audit gate | `npm audit --omit=dev --audit-level=moderate` runs from the lockfile with no install: exit 0 in a copy without `node_modules` (4 low). The full audit is report-only, `set +e … exit 0`: 19 issues (0 critical, 2 high, 12 moderate, 5 low), the same as the implementer's count | OK |
| Compose job | Checks compose >= 2.24 (`node -e` reads `process.argv[1]`, which is correct for `node -e`). Pre-pulls with 3 retries. `TMPDIR=${{ runner.temp }}`. Cleanup by label covers containers, networks and volumes, with `xargs -r` (GNU, present on ubuntu) | OK (see W6-R6-02) |
| Linux compatibility | 963 relative imports in 333 source/test/script files and the 4 `@/` alias imports all resolve with **exact case** (my script `stab/w6r6/casecheck*.cjs`: 0 problems). The index is all LF (`git ls-files --eol`: 314 `i/lf`, 0 `i/crlf`), and `.gitattributes` forces LF. Tests contain no Windows-only branches (the only `process.platform` use is in `helpers/noise.ts`, for the message text). No test needs an ignored file or a prebuilt `dist` (`client-csp` previews a temp folder; `frontend-bundle` builds into a temp folder). Quoted test globs are expanded by Node 22's runner. Lockfile linux-x64 binaries are present: `@rolldown/binding-linux-x64-gnu`, `lightningcss-linux-x64-gnu`, `@esbuild/linux-x64`, `@tailwindcss/oxide-linux-x64-gnu` | OK statically; the dynamic proof is the first run |

**CI-config test mutation (scratch copy of `ci.yml` and the test, run with `NODE_PATH` to the repo's `node_modules`).**

The baseline was 21/21. It detected:
- `npm run lint || true` (fail 1);
- `continue-on-error: true` on lint (fail 1);
- `develop` removed from the triggers (fail 1);
- a timing allow-skip (fail 2);
- the lint step removed (fail 1).

It did NOT detect these (all exit 0, W6-R6-01):
- `npm run lint || :` inside a block scalar;
- `npm run lint || echo …`;
- `npm run lint || exit 0`;
- `if: ${{ false }}` on the timing gate.

A plain-scalar `|| :` fails only because it is invalid YAML (YAMLParseError).

## 2. Full `npm test` (explicit disposable env)

Command: `npm test` from `D:\ReserchMind`, 22:04:10 to 22:11:13, **exit 0**. Log: `stab/w6r6/npmtest.log`.

Environment: `TEST_MONGO_URI=mongodb://127.0.0.1:27095`, `TEST_REDIS_URL=redis://127.0.0.1:6395/0`, `REDIS_URL=redis://127.0.0.1:6599` (dead), `MONGO_URI=mongodb://127.0.0.1:27095/rmw6r6_unused`, `CI` unset.

| Stage | tests | suites | pass | fail | cancelled | skipped | todo | duration |
|---|---|---|---|---|---|---|---|---|
| unit | **752** | 166 | **751** | 0 | 0 | **1** (compose runtime, reason `set TEST_COMPOSE_RUNTIME=1 …`) | 0 | 226.7 s |
| timing | **52** | 15 | **52** | 0 | 0 | 0 | 0 | 191.6 s |

- Login timing: median wrong password 205.6 ms, unknown e-mail 203.3 ms, paired ratio 1.005 over 31 ABBA pairs.
- System CPU load before the run: about 29 % (`Win32_Processor.LoadPercentage`).
- No timing test failed, so no isolated rerun was needed.
- The disposable infrastructure was clean before and after: Mongo databases `admin,config,local` only, and Redis dbs 0 to 2 held 0 keys.

## 3. Authenticated disposable databases (CI URI shapes)

Script: `stab/w6r6/authinfra.sh`, log `authinfra.log`.

Setup:
- New containers `rm-stab-r6-mongo` (`mongo:7.0`, root auth) and `rm-stab-r6-redis` (`redis:7.4 --requirepass --protected-mode yes`).
- Published only on `127.0.0.1:5995` and `127.0.0.1:5996` (`docker port` shows `127.0.0.1` only).
- Passwords from `openssl rand -hex 32`, passed as `-e VAR`, never printed.
- `TEST_MONGO_URI=mongodb://r6root:<gen>@127.0.0.1:5995/?authSource=admin`, `TEST_REDIS_URL=redis://:<gen>@127.0.0.1:5996/7`.
- Dead-port `MONGO_URI` / `REDIS_URL`, and **`CI=true`**.
- Exact CI flags (coverage, spec, TAP, lcov).

| Step | Result |
|---|---|
| `wait-infra.cjs --timeout 90` | all 4 checks OK, exit 0 |
| Independent probes | Mongo anonymous `listDatabases`: refused (code 13). Mongo wrong password: refused (code 18). Redis anonymous `PING`: `-NOAUTH`. `AUTH wrong`: `-WRONGPASS`. `AUTH default wrong`: `-WRONGPASS` |
| Unit stage + gate | exit 0. **752 / 751 / 1 skipped**. `check-tap --min-tests 752 --skips 1 --allow-skip …` exit 0 |
| Timing stage + gate | exit 0. **52 / 52 / 0 skipped**. `check-tap --min-tests 52 --skips 0` exit 0. Login 222.2 / 223.0 ms, paired 0.976 |
| `scan-reports.mjs` (5 files) | exit 0 |
| Coverage (report only) | 149 files. Lines 13,053/14,426 = 90.48 %, branches 2,165/2,623 = 82.54 %, functions 883/1,207 = 73.16 % (consistent with the claimed baseline) |
| Guard negative | URI without `authSource` → `refused: TEST_MONGO_URI: has credentials but no authSource …` (no URI printed) |
| Leftovers / removal | Databases on the authenticated server afterwards: `admin,config,local`. `docker rm -fv` exit 0; 0 `rm-stab-r6-*` containers remain |

## 4. Compose runtime suite (isolated)

Command: `TEST_COMPOSE_RUNTIME=1 TEST_COMPOSE_PROJECT=rmstabtest-r6 TEST_COMPOSE_PORT_BASE=5990 npx tsx --test … tests/compose-security.runtime.test.ts`.
- `TEMP`/`TMP` pointed at a scratch folder.
- Explicit dead-port `MONGO_URI`/`REDIS_URL` and disposable `TEST_*`.
- Run time 22:21:52 to 22:23:54.

Result: **exit 0, 12 tests, 12 pass, 0 skipped**. `check-tap --min-tests 12 --skips 0` exit 0; `scan-reports` exit 0. The LAN test executed its assertions here (no "LAN check not possible" diagnostic).

Cleanup afterwards:
- 0 containers, 0 volumes and 0 networks with label `com.docker.compose.project=rmstabtest-r6`;
- no listener on 5990 to 5999;
- the scratch temp folder was deleted.

## 5. Clean install and lockfile

All of this ran in a commit-equivalent scratch copy: the output of `git ls-files -co --exclude-standard`, with every `.env*` excluded. That is 419 files, created under `stab/w6r6/cc/` and deleted afterwards.

| Check | Result |
|---|---|
| `npm audit --omit=dev --audit-level=moderate` before any install | exit 0, 4 low (katex, micromark-extension-math, rehype-katex, remark-math) |
| `npm ci` (plain) | exit 0, "added 883 packages, and audited 893 packages". Lock sha256 unchanged `a0c8f16a…8953` |
| `npm install --package-lock-only` | exit 0, lock sha256 unchanged (no-op) |
| `npm ls --depth=0` (run from `D:\` with `--prefix <long path>`) | exit 0, 0 invalid/missing/extraneous (W6-R6-07 covers a short-path artifact) |
| Static and build steps in the fresh install | §6 |
| `npm ci --omit=dev` | exit 0, "added 507 packages, audited 517", 4 low. Lock unchanged. `typescript` absent. `express`, `mongoose`, `ioredis`, `jsonwebtoken`, `mammoth`, `multer`, `dotenv`, `zod`, `pdf-parse`, `helmet` resolve/`require` OK |
| Repo `npm ls --depth=0` (from `D:\`, `--prefix ReserchMind`) | exit 0, 0 problems |
| Lockfile vs Wave 5 baseline (`stab/w6-lock-before.json`, sha `6be5280b…0f12`, the same value recorded in `review-wave5.md`) | 49 removed (recharts tree, d3/@types/d3-*, @reduxjs/toolkit + nested immer, @hugeicons/*, react-is, frontend pdfjs-dist 6.2.108 + @napi-rs/canvas 1.0.6 and its binaries, @napi-rs/canvas-win32-arm64-msvc). **0 added**. **0 version/resolved/integrity changes**. 2 flag-only (`immer`, `use-sync-external-store`: `optional`, `peer`). 6 workspace manifests (root, frontend, ai/auth/document/task). Matches the claim exactly |
| Lockfile vs `git show HEAD:package-lock.json` (Waves 1 to 6 together) | 89 removed, 58 added, 284 changed. The 25 version changes are the Wave 4 audit batch and its re-resolutions, approved in Wave 4 (for example axios 1.18.0→1.21.1, follow-redirects 1.16.3, handlebars 4.7.10, proxy-addr 2.0.8). Wave 6 adds no version change to any existing production dependency |
| Registry and integrity | All 965 non-link entries resolve from `https://registry.npmjs.org/` and carry `integrity` (0 bad) |

## 6. TypeScript, builds, lint (fresh `npm ci` copy, exact CI commands)

| Command | Exit / output |
|---|---|
| `npx tsc --noEmit -p services/<svc>` × 6 | all exit 0, 0 lines |
| `npx tsc -b frontend` | exit 0, 0 lines |
| `npm run typecheck:tests` (`tsc -p tests`) | exit 0 |
| `npm run lint` (`eslint . --max-warnings 3`) | exit 0. 0 errors, 3 warnings (RegisterForm.tsx:110 incompatible-library; TaskDetailModal.tsx:156 and :167 exhaustive-deps) |
| **Lint failure propagation** | I added one probe file with a missing-dependency `useEffect` to the scratch copy's `frontend/src`. `npm run lint` gave **exit 1**, "✖ 4 problems (0 errors, 4 warnings) / ESLint found too many warnings (maximum: 3)", and npm propagated the non-zero exit. After I removed the probe: exit 0. In CI, `bash -e` turns this into a failed step |
| `npx tsx --test tests/lint-ratchet.test.ts` | exit 0, 3/3 |
| No focused tests | grep exit 1 (none) |
| `npm run build -w <svc>` × 6 + `test -f services/<svc>/dist/services/<svc>/src/server.js` | all exit 0, all dist checks exit 0 |
| `npm run build -w frontend` | exit 0. CSP meta present (grep exit 0). No `unpkg.com` in `dist`. Worker `pdf.worker.min-qwK7q_zL.mjs` reports `pdfjsVersion = 5.4.296` |

## 7. Test quality and regression

- **No test deleted or newly skipped.**
  - Test files: `git ls-files tests` (HEAD) minus the current tree = none deleted.
  - Test names: I parsed full test paths (suite > test) from the Wave 5 final log (`review5-npmtest.log`: 587 + 47) and from my run (752 + 52). Of 783 Wave 5 paths, exactly one is missing now. It is a rename for W6-TEST-11: "a real `vite preview` server (port 5932)" became "(ephemeral port)".
  - 201 paths are new.
  - The only SKIP in the whole run is the opt-in compose suite. 0 TODO, 0 not ok.
- **login-timing**: the two original median assertions are unchanged, `u >= 0.6·k` and `u <= 1.6·k + 20` (lines 98-99). These are the same thresholds Agent 2 quoted in `testing-review.md:100`. A paired-ratio assertion over 31 ABBA pairs was added with the same bounds (lines 100-101). There is no retry. A structural test was also added: exactly one awaited bcrypt compare, against the dummy hash, for an unknown e-mail. **Strengthened.**
- **login-throttle**: the lock test now uses `LOCK_MS=5000`. It adds a bound on the stored `lockedUntil`, a 429 immediately after the lock, a 429 after about 1.2 s, then a bounded wait for `lockedUntil` and a 200 (lines 112-152). The 401/401/401/429/200 sequence is kept. **Strengthened.**
- **docx/pdf timing tests**: the thresholds match the test names and the documented limits:
  - docx-extraction-limits: < 1000 ms, < 1500, < 2000, < 3000, lag < 200 ms;
  - docx-upload-limits: < 1000 / < 1500 ms, lag < 200 ms;
  - new pdf-extraction-limits: < 6000 / < 5000 ms, lag < 200 ms, timeout + 5 s.

  `noiseNote` appears only in failure messages. `skip-visibility.test.ts` statically forbids skip/todo in `*.timing.ts` and forbids `skip`, `todo` and `process.env` in `helpers/noise.ts`. Because these files are untracked, I could not diff them against Wave 5 text; the name-level comparison above shows no Wave 5 timing test lost.
- **ai-session-privacy / live-documents-batching (W5-L1)**: tests cover exactly 200 ids → 1 request; 450 ids → 200/200/50 with `workspaceId` on every request; de-duplication; fail-closed; a 300-source page keeps live sources; one failed chunk redacts every source.
- **gateway tests**: `gateway-config-refusal` (proxy-addr cross-check, one clean line), `gateway-header-strip` (all five prefixes), and ephemeral ports plus a temp cwd in `gateway-cors` / `gateway-trust-proxy`. All passed in both of my runs.
- **CI-config, dependency-resolution and lint-ratchet tests** pass. The CI-config gaps are in W6-R6-01.
- **Coverage of the Wave 6 fixes (spot check)**:

  | Work package | Tests |
  |---|---|
  | WP-1 | log-redaction, provider-error-redaction, error-middleware |
  | WP-2 | above |
  | WP-3/4 | gateway-config-refusal, gateway-header-strip, registration-bounds, token-lifetimes, required-secrets-boot |
  | WP-5 | `SEC-002-PDF (a)-(d)` suites, pdf-extraction-limits.timing |
  | WP-9 | infra-guard (`A-4` and `A-5 / R10` suites) |
  | WP-7/8 | dependency-resolution D3, ci-config, lint-ratchet |

## 8. Documentation

- `docs/testing.md` §4 matches the workflow on these points: jobs, triggers, pins, ports 27018/6380, base 7, gates, floors 752/52, audit counts, images, required checks. The exception is the LAN sentence (W6-R6-02). §2 counts match my run.
- `docs/reference/environment-variables.md` §4 (lines 157-175) matches the CI env exactly. It also documents the token-lifetime bounds and the task-service `INTERNAL_SERVICE_TOKEN` requirement.
- `docs/onboarding.md:12` (`.nvmrc`/engines), :242 (triggers) and :251 (lint gate) are accurate. The pre-PR list omits `typecheck:tests` (W6-R6-08).
- `ResearchMind_readme.md:47` is accurate. Lines 415, 1882, 2230 and 2315 are stale (W6-R6-03).
- **Roadmap**:
  - `git diff --numstat HEAD` = `267 0` (additions only). HEAD's 170,118-byte file is a byte-identical prefix of the current file (`cmp` reaches EOF on HEAD with no difference), so §1-27 are unchanged.
  - The first 1,947 lines / 218,004 bytes hash to `18990a05…8eea`, equal to the Wave 6 starting value. The Wave 5 review recorded "204 additions" = 1,947 − 1,743 lines, which is consistent. So §28-29 are unchanged.
  - §30 is appended at line 1949.

## 9. Findings

| ID | Sev | Location | Evidence | Exact correction required |
|---|---|---|---|---|
| W6-R6-01 | L | `tests/ci-config.test.ts:104` (also the header comment at :12-14, `docs/testing.md:185` and `w6-evidence.md:385`, which claim `\|\| :` is enforced) | The regex `/\|\|\s*(true\|:)\b/` cannot match `\|\| :` (`\b` after `:` needs a word character). Mutations in block-scalar `run:` (`npm run lint \|\| :`, `\|\| echo …`, `\|\| exit 0`) and `if: ${{ false }}` on the timing gate all left the test green (exit 0) | (a) Reject every `\|\|` in `run:` outside the `REPORT_OR_CLEANUP` steps. If needed, allow only the `node -e` JS case by asserting no shell-level `\|\|`, e.g. `/(^\|[;&\s])\|\|\s*(true\|:\|exit\b\|echo\b)/m` with `(?=\s\|$)` instead of `\b`. (b) Assert that every step whose name contains "gate" or "stage", plus "Reports contain no credentials" and "Tests left the tree clean", has `if` absent or exactly `${{ !cancelled() }}`. Add both mutations to the test's own negative cases |
| W6-R6-02 | L | `tests/compose-security.runtime.test.ts:300-302`; `docs/testing.md:189`; `docs/wave-6/w6-evidence.md:387` | Without a non-loopback IPv4 the test calls `t.diagnostic(...)` and `return`s, so it **passes** and no skip is recorded. The docs claim it "skips itself … which then fails this gate on purpose", which is false: the 0-skip gate would stay green while the SEC-001 LAN check never ran | In the test: `if (lanAddresses.length === 0) { if (process.env.CI) assert.fail("no non-loopback IPv4: LAN check impossible in CI"); t.skip("no non-loopback IPv4 interface"); return; }`, so a skip is counted and the compose gate (`--skips 0`) fails. Or correct both documents to state the real behaviour |
| W6-R6-03 | L | `ResearchMind_readme.md:415, 1882, 2230, 2315` | These lines still say "run tests (no lint or deploy step)", "(typecheck + frontend build + tests; no lint step)" and "runs `npm test` with MongoDB and Redis service containers. It has no lint …". The Wave 6 workflow has a lint gate, starts its databases with `docker run` (no service containers) and has 5 jobs (W6-CI-19 was fixed only at line 47) | Replace these with the line-47 wording: five jobs (`static`, `build`, `test`, `compose-runtime`, `audit`), lint gate `--max-warnings 3`, authenticated `mongo:7.0` / password `redis:7.4` via `docker run` on loopback, no deploy step. Keep `tests/docs-consistency.test.ts` item 14 consistent (it only checks lines mentioning "with a MongoDB service container") |
| W6-R6-04 | L | `scripts/ci/check-tap.mjs:27,30` | `Number("") === 0`, so `--min-tests "$UNIT_MIN_TESTS"` with an unset or misspelled variable silently gives floor 0. I demonstrated exit 0 with `--min-tests ""` | Validate `option("--min-tests")` as `/^\d+$/` and `> 0` (exit 2 otherwise). Same for `--skips` (`/^\d+$/`) |
| W6-R6-05 | Info | `ci.yml:138-143` | The `test` job pulls `mongo:7.0`/`redis:7.4` implicitly inside `docker run`, with no retry. The compose job has a 3-try pre-pull | Optionally add the same pre-pull-with-retry step before "Start disposable MongoDB…" |
| W6-R6-06 | Info | `ci.yml` action pins (v4 majors) | `actions/checkout`, `setup-node` and `upload-artifact` v4 run on the node20 action runtime, which GitHub is deprecating. They may warn or be forced onto a newer runtime | Track as a residual. Moving to the newer majors (with SHAs verified the same way) is a later, separate change |
| W6-R6-07 | Info | local tooling only | `npm ls --depth=0 --prefix C:\Users\NANDHA~1\…` (8.3 short path) reported every package as "extraneous" (exit 1). The same tree with the long path gave exit 0. This is an npm path-normalisation artifact, not a repository problem | None for CI. Use long paths locally (as the docs already advise for the drive-letter case) |
| W6-R6-08 | Info | `docs/onboarding.md:243-248` | The "run what CI runs" block lists `tsc` per service, the frontend build and `npm test`. It omits `npm run typecheck:tests` and `npm run lint` (lint is mentioned on the next line) | Add `npm run typecheck:tests` and `npm run lint` to the block |
| W6-R6-09 | Info | `ci.yml:52-53` | `git diff --exit-code -- package-lock.json` after `npm ci` can hardly fail, because `npm ci` never rewrites the lockfile. The meaningful drift check (`npm install --package-lock-only` is a no-op) was verified only locally (§5) | Optionally add `npm install --package-lock-only --ignore-scripts` before the diff step |

Also observed, harmless: Node prints `MaxListenersExceededWarning … [TestsStream]` when three reporters are attached (CI's unit stage). It does not affect results.

## 10. Residual risks (not verifiable locally)

1. **First GitHub Actions run.** This means Linux `npm ci` with the linux-x64 optional binaries, `bash -eo pipefail` semantics, `::add-mask::` actually masking the generated passwords and URIs in the log, artifact upload, and `cache: npm`. Nothing has run on GitHub. Branch protection with the five required checks is a user action.
2. **Timing stage on 2 to 4 vCPU runners.** The thresholds are absolute: 52 tests, floor 52, 0 skips allowed. The unit-stage latency tests listed in testing.md §6 are also at risk. Locally I saw 2 of 2 green runs. The implementer recorded 2 non-green runs under load. CPU noise on shared runners can turn a run red. That is intended (fail, never skip), but it may need re-runs.
3. **Compose job on the runner.** It needs Docker Compose ≥ 2.24 (checked by the job) and Docker Hub pulls. The LAN check depends on the runner's interfaces (W6-R6-02).
4. **Floors equal today's counts (752/52).** Any legitimate test removal needs a floor edit in `ci.yml`. That is by design and should be logged.
5. **Audit gate depends on the advisory database at run time.** A new moderate advisory in a production dependency will turn `audit` red without any code change. That is intended.

## 11. Cleanup and safety record

- Containers `rm-stab-r6-mongo` and `rm-stab-r6-redis` are removed (`docker rm -fv` exit 0, 0 left).
- The compose project `rmstabtest-r6` left 0 containers, volumes and networks.
- No listener remains on 5990 to 5999, and no `tsx`/node test processes of mine are running.
- The disposable infra is in its initial state: rm-stab-mongo has `admin,config,local` only; rm-stab-redis dbs 0 to 2 hold 0 keys.
- Scratch copies `stab/w6r6/cc`, `stab/w6r6/cicopy` and `stab/w6r6/composetmp` are deleted. Only small logs and scripts remain under `stab/w6r6/`.
- The working tree is unchanged by my runs. The only addition since the start is the security reviewer's `docs/wave-6/independent-security-verdict.md`, plus this file.
- Lockfile sha256 `a0c8f16a…8953` is unchanged.
- `.env` mtimes were checked as metadata only and are unchanged.
- I did not touch the researchmind-*, rate-limiter-gateway-*, fund-request-db-1 or sonarqube containers.

---

## Re-review (2026-11-24, after the Stage E corrections)

**Verdict: PASS.** W6-R6-01 to W6-R6-09 are closed. One new Low, non-blocking finding is open (W6-R6-10).

**GitHub Actions has still not run the workflow.** Everything below is local, on Windows, and the residual risks in §10 still apply.

### Context and environment

- A session restart interrupted the first re-review attempt on 2026-11-15 before it wrote anything. This re-review was redone from the start on 2026-11-24 between 13:16 and 13:45 (+05:30).
- The restart also wiped the old `stab/` scratch logs: the rules file, `impl-log.md` and my first-review logs. The rules were followed exactly as stated in the coordinator's brief. My re-review scratch is `stab/w6r6/`, re-created (875 KB of logs and scripts).
- Environment:
  - Node 22.14.0, npm 10.9.2, HEAD `8b4a304`.
  - Disposable `rm-stab-mongo` (127.0.0.1:27095) and `rm-stab-redis` (127.0.0.1:6395), Redis base db 0.
  - `REDIS_URL=redis://127.0.0.1:6599` (dead port), `MONGO_URI=…/rmw6r6_unused`, `CI` unset.
  - 27017 and 6379 were never used.
- No repository file changed after 2026-11-15 23:20: `find -newermt 2026-11-16`, excluding `node_modules`, `dist` and `.git`, found nothing. So I judged the Stage E state as the implementer left it.

### Status of the first-review findings

| ID | Claim | What I verified | Status |
|---|---|---|---|
| W6-R6-01 | CI-config test catches `\|\| :`, `\|\| echo`, `\|\| exit 0`, `if: false` on gates | New rule: no shell-level `\|\|` after stripping quoted strings, outside the three report/cleanup steps. Gate, stage, scan and tree-clean steps may only have no `if` or exactly `${{ !cancelled() }}`. Mutations on a scratch copy of `ci.yml` plus the real test (`NODE_PATH` to the repo's `node_modules`): the baseline passes 34/34 and **every requested mutation fails the test** (exit 1). See the mutation table below | **Closed** (residual bypasses are in W6-R6-10) |
| W6-R6-02 | LAN check cannot pass silently | `compose-security.runtime.test.ts:300-307` now calls `assert.fail` when `CI` is set, and otherwise `t.skip(...)` then `return`. I reproduced that exact branch with an empty interface list in a scratch `node:test` file. Without `CI`: 1 skipped, and `check-tap --skips 0` rejects it with exit 1 ("skipped is 1", "skip not allowed"). With `CI=true`: 1 fail, exit 1. `docs/testing.md:189` now describes this. The CI-config test asserts the branch shape | **Closed** |
| W6-R6-03 | README CI drift | `ResearchMind_readme.md:415, 1882, 2315` now describe the five jobs, the lint gate and `docker run` loopback databases. `grep -i "service container\|no lint"` over README, testing.md and onboarding.md finds 0 lines. README:47 states 783 + 55 | **Closed** |
| W6-R6-04 | `check-tap` floors | `--min-tests` must match `/^\d+$/` and be ≥ 1; `--skips` must match `/^\d+$/`. Against my real unit TAP: `""`, `0`, `-1`, `1e2`, `abc` each exit 2; an empty `--skips` exits 2; a valid call exits 0. The new CI-config cases (8) pass | **Closed** |
| W6-R6-05 | Test job pull retry | "Pre-pull images (retry)" (3 tries, 10 s apart, `exit 1` when exhausted) comes before the start step in the `test` job (ci.yml:137). The CI-config test checks the order | **Closed** |
| W6-R6-06, -07 | Recorded residuals | Both are listed in `w6-evidence.md` §19 | **Closed (accepted residuals)** |
| W6-R6-08 | Onboarding pre-PR list | `docs/onboarding.md:243-250` now includes `npm run typecheck:tests` and `npm run lint` | **Closed** |
| W6-R6-09 | Real drift check | New static step: `npm install --package-lock-only --ignore-scripts` then `git diff --exit-code -- package-lock.json` (ci.yml:55-59). In my fresh `npm ci` copy that lock-only command left the lock hash at `a0c8f16a…8953` (a no-op on Windows) | **Closed** (Linux behaviour is a first-run residual) |

### The one relaxed assertion (W6-R6-09)

The static-job test used to say "no `npm install` anywhere". It now:
- removes the single exact string `npm install --package-lock-only --ignore-scripts`;
- asserts that string occurs exactly once;
- forbids any other `npm install` or `audit fix`;
- checks, in a dedicated test, that the drift step runs the lock-only install before `git diff --exit-code`.

**Judgement: acceptable, and tight.** A lock-only install writes nothing to `node_modules`, and `--ignore-scripts` runs no lifecycle scripts. The mutations show the relaxation cannot be widened unnoticed:
- turning it into `npm install --ignore-scripts` (M7) fails 2 tests;
- adding a second lock-only command (M9) fails;
- `npm ci` → `npm install` (M8) fails;
- removing the step (M6) fails 2 tests.

The remaining gap is the `npm i` alias (B8), which the original assertion never covered either. It is folded into W6-R6-10.

Residual: on the first Linux run, npm could re-resolve platform-specific optional entries, and the check would then fail. That would be a correct, visible failure, not a silent pass. The lockfile already carries the linux-x64 entries (verified in the first review).

### Mutation results (scratch copy of `ci.yml` and `tests/ci-config.test.ts`; 34 tests)

| # | Mutation | Test result |
|---|---|---|
| M0 | none | exit 0, fail 0 |
| M1 | block-scalar `npm run lint \|\| :` | **exit 1** |
| M2 | `npm run lint \|\| echo lint ignored` | **exit 1** |
| M3 | `npm run lint \|\| exit 0` | **exit 1** |
| M4 | `if: ${{ false }}` on the timing gate | **exit 1** |
| M4b | `if: ${{ always() && false }}` on the unit gate | **exit 1** |
| M5 | test-report upload `if: ${{ always() }}` (scan condition removed) | **exit 1** |
| M5b | audit upload `if: ${{ always() }}` | **exit 1** |
| M6 | lock-only drift step removed | **exit 1** (2 tests) |
| M7 | drift step becomes `npm install --ignore-scripts` | **exit 1** (2 tests) |
| M8 | `npm ci` → `npm install` in `static` | **exit 1** |
| M9 | a second lock-only command in `static` | **exit 1** |
| B1 | comment lines with apostrophes around `npm run lint \|\| true` (`# don't …` / `# it's …`) | exit 0, **not detected** |
| B2 | `if npm run lint; then echo ok; fi` | exit 0, not detected |
| B3 | `set +o errexit` … `exit 0` | exit 0, not detected |
| B4 | step-level `shell: bash {0}` (drops `-eo pipefail`) | exit 0, not detected |
| B5 | job-level `if: ${{ false }}` on `test` | exit 0, not detected |
| B6 | `! npm run lint` | exit 0, not detected |
| B7 | `npm run lint &` | exit 0, not detected |
| B8 | `npm i --no-save left-pad` in `static` | exit 0, not detected |

### CI-side effects of the security corrections (W6-R5-*)

- **Uploads (W6-R5-04).** Each of the three uploads now runs only when `always() && steps.<scan>.outcome == 'success'`. The ids are `scan-unit`, `scan-compose`, and a new `scan-audit` that scans `npm-audit-full.json`. Each scan step comes before its upload and covers the uploaded path (asserted). M5 and M5b show the condition is enforced.
- **Infra guard and PDF sandbox (W6-R5-01/03).** The stricter port parsing still accepts the CI shapes (27018, 6380/7). The CI-config, infra-guard and full suites all pass. The new PDF limit tests raise the timing count to 55, which equals `TIMING_MIN_TESTS`.

### Commands and results

| Check | Command | Result |
|---|---|---|
| Full test | `npm test` (13:17:01–13:23:45) | **exit 0**. Unit **783 tests, 782 pass, 0 fail, 0 cancelled, 1 skipped**, 0 todo (200.2 s). Timing **55 tests, 55 pass, 0 skipped** (201.2 s). Login 199.0 / 198.0 ms, paired ratio 0.993. CPU load before: 38 %. No timing failure, so no isolated rerun was needed |
| Skips | TAP path parse | the only SKIP is the opt-in compose suite; 0 TODO, 0 not ok |
| CI gates on my TAP | `check-tap … --min-tests 783 --skips 1 --allow-skip …` and `--min-tests 55 --skips 0` | both exit 0. With floor 784: exit 1 |
| Count floors | ci.yml:123-124 | `UNIT_MIN_TESTS: "783"`, `TIMING_MIN_TESTS: "55"`: **equal to the actual counts**. docs/testing.md:102 and README:47 state the same |
| CI-config test | `npx tsx --test tests/ci-config.test.ts` | exit 0, 34/34 |
| YAML parse | `yaml` 2.9.0 `parse(ci.yml)` | OK |
| Clean install (commit-equivalent copy, 421 files, no `.env*`) | `npm ci` | exit 0, "added 883 packages, audited 893". Lock hash unchanged |
| Lock-only no-op | `npm install --package-lock-only --ignore-scripts` | exit 0, lock hash unchanged |
| Typecheck | `npx tsc --noEmit -p services/<svc>` ×6, `npx tsc -b frontend`, `npm run typecheck:tests` | all exit 0, 0 output lines |
| Lint | `npm run lint` | exit 0, 0 errors, 3 warnings. With one probe file adding a 4th warning: **exit 1**, "ESLint found too many warnings (maximum: 3)" (probe removed) |
| Ratchet / focused tests | `npx tsx --test tests/lint-ratchet.test.ts`; `grep -RnE '\.only\(\|only: *true' tests` | 3/3; none |
| Builds | `npm run build -w <svc>` ×6 + `test -f …/dist/services/<svc>/src/server.js`; `npm run build -w frontend` | all exit 0, all dist checks 0. CSP meta present, no `unpkg.com`, worker `pdfjsVersion = 5.4.296` |
| Lockfile | `sha256sum package-lock.json` | `a0c8f16a861b4ac4c7e6006ac8437a8c68afc32297c81539a01d93ad6aac8953` (unchanged) |
| Roadmap | prefix sha256 of the first 218,004 bytes; `git diff --numstat HEAD` | `18990a05…8eea` (unchanged); `277 0` (additions only; §30.7 appended) |

### New finding

| ID | Sev | Location | Evidence | Correction (recommended, non-blocking) |
|---|---|---|---|---|
| W6-R6-10 | L | `tests/ci-config.test.ts` (masking rule, around line 101; gate-`if` rule) | Constructs B1–B8 above all mask a failing command or skip a job, yet the test stays green. B5 matters most: a required job that is skipped is reported to branch protection as successful. B1 works because the quote-stripping regex `'[^']*'` spans across lines, so apostrophes in two comment lines hide a `\|\| true` between them | (a) Strip `#` comment lines before stripping quotes, and limit quote stripping to one line (`'[^'\n]*'`). (b) Fail on `set +o errexit`/`pipefail`, a leading `!` command, a trailing `&`, and `if …; then` around `npm`/`npx`/`node` commands outside the report/cleanup steps. (c) Fail on any step-level `shell:` and any job-level `if:`. (d) Treat `npm i` and `npm add` like `npm install` |

These are deliberate constructs that a reviewer would see in the diff, not accidental masking. The first-review findings this test was meant to close are closed. W6-R6-10 does not block the readiness decision.

### Observation (not a finding)

- During this re-review, `rm-stab-mongo` briefly listed an empty `rmtest_pdflimits_5dd965c6` database (0 collections) at about 13:24. It was gone a few seconds later, and the final listing shows only `admin,config,local`.
- That name comes from `pdf-extraction-limits.timing.ts`, whose `after` hook drops its own database. It was most likely a concurrent run (the security reviewer shares this server) or a drop still finishing. Nothing was left behind.

### Cleanup and safety (re-review)

- Scratch copies `stab/w6r6/cc`, `stab/w6r6/cicopy` and `stab/w6r6/lan` are deleted.
- No container, compose project, volume or network was created in this re-review.
- No listener remains on 5990 to 5999, and no `rm-checktap-*` or `rm-csp-preview-*` temp folder is left.
- rm-stab-mongo: `admin,config,local`. rm-stab-redis dbs 0 to 2: 0 keys.
- `git status --porcelain --untracked-files=all` is identical before and after my runs (301 lines). The only repository edit is this section and the top-line verdict of this file.
- No git writes.
- `.env` mtimes (metadata only) are unchanged: 1794554184, 1794554179, 1790309232, 1789012415, 1794748704, 1787768922, 1794748719, 1794748722.

---

## Final recheck (round 2), 2026-11-24 14:30–15:05 (+05:30)

**Verdict: PASS.** W6-R6-10 is closed. Two new findings, W6-R6-11 and W6-R6-12, are Low hardening items and do not block.

**GitHub Actions has still not run the workflow.**

Rules: `stab/w6-rules.md` (recreated): ports 5990–5999, Redis base db 0, Mongo prefix `rmw6r6_`, explicit `TEST_MONGO_URI=mongodb://127.0.0.1:27095`, `TEST_REDIS_URL=redis://127.0.0.1:6395/0`, `REDIS_URL=redis://127.0.0.1:6599` (dead), `MONGO_URI=…/rmw6r6_unused`, `CI` unset. Port 27017 and 6379 were never used.

Repository state checked:
- Files changed since the morning re-review: `ci.yml`, `tests/ci-config.test.ts`, `safe-error.ts`, `error.middleware.ts`, `pdf-extractor.ts`, `tests/helpers/pdf-fixtures.ts`, `tests/pdf-extraction-limits.timing.ts`, `security.md`, `testing.md`, README, roadmap and `w6-evidence.md`.
- No `package.json` changed (all mtimes are 2026-11-15 or older).
- The lockfile is still `a0c8f16a861b4ac4c7e6006ac8437a8c68afc32297c81539a01d93ad6aac8953`.

### Mutation recheck (scratch copy of `ci.yml` and the new `tests/ci-config.test.ts`, 36 tests)

| Probe | Result |
|---|---|
| M0 baseline (real `ci.yml`) | exit 0, 36/36 |
| M1 `\|\| :` (block scalar) · M2 `\|\| echo` · M3 `\|\| exit 0` · M4 timing gate `if: false` · M5 upload `always()` · M6 drift step removed · M7 drift step → real install · M8 `npm ci` → `npm install` | all **exit 1** (M6 and M7 fail 2 tests each) |
| B1 apostrophes in comments around `\|\| true` · B2 `if npm run lint; then …` · B3 `set +o errexit` · B4 step `shell: bash {0}` · B5 job-level `if: false` on `test` · B6 `! npm run lint` · B7 `npm run lint &` · B8 `npm i --no-save …` | all **exit 1** (they passed before round 2), so **W6-R6-10 is closed** |
| N6b `\|\|` with a backslash-newline · N10 job-level `continue-on-error` · N12 a later `--min-tests 1` override | exit 1 (detected) |
| N1 `if: ${{ false }}` on the **Lint** step · N1b the same on **Build frontend** · N1c `if: github.event_name == 'push'` on **Typecheck tests** | **exit 0, not detected** (W6-R6-11) |
| N15 `npm run lint && echo ok` on a non-final line | **exit 0, not detected**. Real `bash -eo pipefail` exits 0 when `false` is used in that position (W6-R6-11) |
| N2 `trap 'exit 0' ERR` · N3 `export X="$(npm run lint)"` (`local` behaves the same) · N4 `echo "$(npm run lint)"` · N8 `bash -c '…; exit 0'` · N5 `echo npm run lint` | exit 0, not detected. Each masks in real bash (I checked with `false`: all exit 0). These are deliberate or obfuscating constructs and are Info |
| Shown benign in real bash or caught by other gates: N6 `\|` newline `\| true` (syntax error, exit 2); N7 `cmd; true`; N9/N18 pipes (pipefail); N14 `set -o posix`; N15b `&&` as the last line; N16 `{ …; } &&:`; N11 `paths-ignore` (required checks never report, so the merge stays blocked); N13 `NODE_OPTIONS=--test-only` (the counts and skip gates would fail) | not masking |

**Judgement.** Every realistic *accidental* masking pattern I tried is now caught on the gate steps themselves: `\|\| true/:/echo/exit 0`, `set +e`, gate `if:`, upload conditions, step `shell:`, job `if:`, `continue-on-error`, and install drift. Two remaining patterns are plausible by accident: a step-level `if:` on a non-gate required step (lint, typecheck, build), and an `&&` list on a non-final line. That makes W6-R6-11 Low. Everything else that still passes needs deliberate obfuscation that a reviewer would see in the diff (Info).

### Results

| Check | Command | Result |
|---|---|---|
| Full test, run alone (14:35:27–14:41:44) | `npm test` | **exit 1**. Unit **794 tests, 793 pass, 0 fail, 1 skipped** (compose opt-in), 146.8 s. Timing **57 tests, 56 pass, 1 fail**, 0 skipped. Login 205.1 / 205.4 ms, paired ratio 1.009 |
| The failing test | `docx-extraction-limits.timing.ts:211` "a DOM-heavy parse beyond the heap limit maps to 422" | `event loop blocked 332 ms` (limit 200). The note recorded quiet conditions before the file: lag p99 16.6 ms, max 17.4 ms. Host right after the run: **about 2.0 GB free RAM, CPU 53 %**, with the user's browser processes busy. The file and `docx-extractor.ts` are unchanged since 2026-11-15, and this test passed in all three of my earlier full runs |
| Isolated rerun | `npx tsx --test tests/docx-extraction-limits.timing.ts` ×3 (before: about 1.8 GB free, CPU 48 %) | **3/3 exit 0, 19/19 each** |
| Timing stage rerun (14:44:07–14:47:21; before: about 1.7 GB free, CPU 38 %) | `npm run test:timing` | **exit 0, 57/57**, 0 skipped. Login 213.2 / 209.4 ms, paired ratio 0.998 |
| Floors | ci.yml `UNIT_MIN_TESTS: "794"`, `TIMING_MIN_TESTS: "57"`; `check-tap` on my TAP | unit at 794: exit 0, at 795: exit 1. Timing (rerun) at 57: exit 0, at 58: exit 1. The failing first timing TAP is correctly rejected (exit 1, fail 1). The only SKIP is the compose opt-in. **Counts equal the floors** |
| CI-config test (real file) | `npx tsx --test tests/ci-config.test.ts` | exit 0, 36/36 |
| YAML parse | `yaml` 2.9.0 | OK. Jobs: static, build, test, compose-runtime, audit |
| Clean install (commit-equivalent copy, 421 files, no `.env*`) | `npm ci`; `npm install --package-lock-only --ignore-scripts` | exit 0, 883 packages. Lock hash unchanged after both |
| Typecheck | `npx tsc --noEmit -p services/<svc>` ×6; `npx tsc -b frontend`; `npm run typecheck:tests` | all exit 0, 0 output lines |
| Lint | `npm run lint`; plus one probe file with a 4th warning | exit 0, 0 errors, 3 warnings. With the probe: **exit 1**, "too many warnings (maximum: 3)" |
| Ratchet / focused tests | lint-ratchet; `grep -RnE '\.only\(\|only: *true' tests` | 3/3; none |
| Builds | `npm run build -w <svc>` ×6 plus the dist check; `npm run build -w frontend` | all exit 0, dist checks 0. CSP meta present, no `unpkg.com`, `pdfjsVersion = 5.4.296` |
| Lockfile / manifests | `sha256sum package-lock.json`; `package.json` mtimes | `a0c8f16a…8953`; no manifest changed |
| Roadmap | sha256 of the first 218,004 bytes; `git diff --numstat HEAD` | `18990a05…8eea` (§1–29 unchanged); `293 0` (additions only) |
| Docs counts | testing.md:102, README:47 | 794 (793 + 1 skip) / 57, matching the floors |

### New findings

| ID | Sev | Location | Evidence | Correction (recommended, non-blocking) |
|---|---|---|---|---|
| W6-R6-11 | L | `tests/ci-config.test.ts`: the gate-`if` rule (name-based, `/gate\|stage/`) and the masking rule | N1, N1b and N1c: a step-level `if:` on Lint, Build frontend or Typecheck tests silently skips a required check, and the test stays green. N15: `npm run lint && echo ok` on a non-final line passes under `bash -e` (an `&&` list is exempt from errexit). In real bash the equivalent `false && echo ok` followed by `true` exits 0. Info, deliberate only: `trap 'exit 0' ERR`, `export X="$(cmd)"` / `local`, `echo "$(cmd)"`, `bash -c '…; exit 0'`, `echo npm run lint` | (a) Allow a step-level `if:` only on the named report/cleanup and upload steps and the gate/stage/scan steps (already constrained). Reject it on every other step of the five required jobs. (b) Reject `&&` in shell-level text outside the named steps, or require `&&` lists to be the last command of the script. (c) Optionally reject `trap … ERR`, `bash -c`/`sh -c`, and `export`/`local` with a command substitution outside the named steps |
| W6-R6-12 | L | `tests/ci-config.test.ts` (the `scripts/ci/check-tap.mjs` describe) | Only usage errors (exit 2) and one valid case (exit 0) are tested. Nothing in the suite asserts that `check-tap` exits 1 when fail, cancelled or todo is above 0, when the skip count or reason is wrong, when the count is below the floor, or when the summary is missing. I showed all of these manually (first review §1, and the floor+1 and failing-TAP checks above). A refactor that broke them would leave every gate green | Add cases using small synthetic TAP strings: `# fail 1`, `# todo 1`, `# cancelled 1`, `# skipped 2`, a `# SKIP other reason`, `# tests` below the floor, and a missing summary. Each must exit 1 |

### Residual

The timing stage is sensitive to host memory and CPU load. Here, about 1.7 to 2 GB was free and the browser was busy, and one event-loop assertion went over 200 ms. On CI runners with 2 to 4 vCPUs this is the main expected source of red runs. The failure is visible (fail, never skip), and an isolated rerun is the documented response.

### Cleanup (round 2)

- Scratch copies `stab/w6r6/r2/cc` and `stab/w6r6/r2/cicopy` and the shell-probe folder are deleted. Only logs remain (2.0 MB under `stab/w6r6/`).
- No container was created. No listener remains on 5990–5999.
- rm-stab-mongo: `admin,config,local`. rm-stab-redis dbs 0–2: 0 keys.
- `git status --porcelain --untracked-files=all` is identical before and after (301 lines).
- My only repository edits are the top-line verdict and this section of this file. No git writes.
- `.env` mtimes (metadata only) are unchanged.
