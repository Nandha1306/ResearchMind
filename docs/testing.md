# Testing — ResearchMind

How the automated checks work today, how to run them, and what they do **not** cover.

Command status: **TESTED** means the command was run successfully during the Wave 1–4 audits; **UNTESTED** means it matches `package.json` / CI but was not run in the audit.

---

## 1. What exists

| Check | Tool | Location | Gate in CI? |
|-------|------|----------|-------------|
| Unit tests | Node's built-in test runner (`node:test`, `node:assert`) run through `tsx` | `tests/*.test.ts` | Yes |
| Integration tests (real MongoDB) | Same runner; files named `*.integration.test.ts` | `tests/*.integration.test.ts` | Yes (CI provides MongoDB) |
| Test helpers | — | `tests/helpers/test-env.ts` (random secrets, ephemeral HTTP servers; since Wave 6 also dead-port `REDIS_URL`/`MONGO_URI` defaults), `tests/helpers/test-mongo.ts` (disposable databases), `tests/helpers/test-redis.ts` (database offsets), `tests/helpers/infra-guard.ts` (disposable-target guard), `tests/helpers/spawn-service.ts` (temp cwd, minimal env, ephemeral ports), `tests/helpers/noise.ts` (environment context for latency failures), `tests/helpers/infra.ts` (`infraDescribe`: visible skips, ARC-006) | — |
| Backend typecheck | `tsc --noEmit` per service | `services/<service>/tsconfig.json` | Yes (`static` job) |
| Tests typecheck | `tsc -p tests` (`npm run typecheck:tests`; strict, bundler resolution) | `tests/tsconfig.json` | Yes (`static` job, Wave 6) |
| Frontend typecheck + build | `tsc -b && vite build` (two projects: `tsconfig.app.json` for `src` with `strict`, `tsconfig.node.json` for `vite.config.ts` and `csp.ts`) | `frontend/` | Yes (`static` and `build` jobs) |
| Frontend lint | ESLint (`frontend/eslint.config.js`) with a committed suppression baseline (`frontend/eslint-suppressions.json`) and `--max-warnings 3` (Wave 6) | `frontend/` | Yes (`static` job, Wave 6); the baseline may only shrink (`tests/lint-ratchet.test.ts`) |
| Coverage | Node's built-in `--experimental-test-coverage` (lcov) on the unit stage | CI artifact `test-reports/lcov.info` | Report only, never a gate (Wave 6 decision D-6) |

There is **no** Jest, Supertest, Vitest, Playwright/Cypress or k6 in the repository. The Jest/Supertest/k6 snippets in `ResearchMind_readme.md` §21 are design sketches.

All tests live in the root `tests/` folder and import service code directly by relative path (for example `../services/auth-service/src/services/auth.service`). No workspace has its own test script (`notification-service` and `shared-config` have npm's placeholder `test` script that only exits with an error).

### Test files

| File | Covers |
|------|--------|
| `auth-flow.test.ts` | JWT utilities, refresh rotation and reuse detection (mocked model), `/api/auth/refresh` router, shared `authenticate` middleware |
| `refresh-rotation.integration.test.ts` | Refresh-token rotation, concurrency, reuse after grace window, expiry, logout (real MongoDB) |
| `internal-auth.test.ts` | `X-Internal-Token` middleware, weak/placeholder tokens never authenticate |
| `workspace-membership.test.ts`, `workspace-isolation.test.ts` | Shared membership check; task-service membership gate; subtask cycle protection |
| `workspace-join.integration.test.ts` | Invite-code join, `409` / `404` / `400`, concurrent joins, non-member reads (real MongoDB) |
| `document-extraction-errors.test.ts`, `upload-and-model-validation.test.ts` | Corrupt/empty files → `422`, file-signature checks, embedding model/dimension configuration, ai-service internal vector-delete guards |
| `document-lifecycle.integration.test.ts` | Delete removes vectors first (`503` on failure), server-owned fields, worker claim/fencing/retry limit, recovery sweep, upload route validation (real MongoDB; Cloudinary and the ai-service are stubbed). Wave 4: `POST /api/documents` returns 404 (ARC-001; the old A07 test that created metadata-only records was rewritten for this), forged upload form fields ignored, a text-less upload is stored `failed` and never queued, the sweep marks text-less pending/stale records `failed` and logs ids (idempotent), a failed record save destroys the uploaded asset (SEC-013), document list paging (ISS-043) |
| `embedding-job-processing.test.ts` (Wave 4 additions) | SEC-012 b: cleanup of a deleted document's vectors is retried until it succeeds, and gives up loudly after 3 attempts |
| `embedding-job-processing.test.ts`, `embedding-worker-lifecycle.test.ts` | Embedding job flow with stubbed providers, claim client, worker start/stop |
| `ai-validation-and-stream.test.ts` | AI query/search/summary validation and membership refusal, meeting-summary normalisation from fixture LLM output, gateway ending the SSE stream when ai-service dies; Wave 5 ARC-012 guard: a client that leaves mid-answer closes the upstream stream through the gateway within 1 s |
| `task-workflows.integration.test.ts` | Assignee must be a member, bulk creation (all-or-nothing, idempotent `importKey`), membership outcomes (real MongoDB). Wave 4: an `importKey` replayed with different tasks → 409 (RT-004), legacy imports without a hash keep the count rule; task, board and activity paging (ISS-043) |
| `error-middleware.test.ts`, `request-body-guards.test.ts`, `lifecycle.test.ts` | Error → status mapping, missing bodies, Redis reconnect/close, graceful shutdown, health handler; Wave 5 ISS-041: unknown routes on all six real apps (and behind the gateway proxy) are a JSON `404 Route not found` |
| `client-auth-refresh.test.ts`, `client-ai-stream.test.ts`, `client-helpers.test.ts`, `document-url-guard.test.ts` | Framework-free frontend modules only: token refresh coordinator and axios interceptors, SSE reader, navigation/polling/assignee helpers, external-URL guard |
| `compose-security.test.ts` | Infrastructure configuration (SEC-001/SEC-014/RT-009). `docker compose config` with a generated env file and a throwaway project name: ports bound to `127.0.0.1` only, every credential required (no fallbacks; each one left out fails), Redis `--requirepass` and protected mode, mongo-express only in the tools file (image version pinned), provisioning script mounted. Also checks the example env files, that both ioredis versions take the password from `redis://:<pw>@host`, and that auth-service has no Redis client. Needs the Docker CLI (skipped without it, except under `CI`) |
| `provision-service-users.test.ts` | Input validation of `docker/mongo/provision-service-users.js`, run in a Node `vm` with `db`/`print` stubbed (no MongoDB needed): valid input creates exactly one `readWrite`-on-own-database user per service and prints no password; database names with `.`, `/`, `\`, space, `$`, `"`, a leading `-`, over 63 characters or a system name are rejected; service passwords under 16 characters or with `+ / = @ :` or a space are rejected; missing/blank variables and the operator's own user are rejected. Every rejection names the variable, not the value, and happens before any write |
| `document-file-stream.integration.test.ts` | SEC-005 through the real gateway and document-service (real MongoDB; Cloudinary uploader and the storage download stubbed): new uploads are `authenticated` assets with a random UUID id; no storage field in any response; members get the streamed bytes with the right headers from a signed URL built server-side (redirects refused); 401/403/404 (deleted, unknown, malformed, no file); legacy public assets still open; stored URLs outside `https://res.cloudinary.com/<cloud>/` are never fetched; upstream errors → 502/503 without URLs; a client abort cancels the upstream download; destroy uses the stored delivery type; the migration script's dry run / `--apply` / re-run (fake Cloudinary) |
| `embedding-pointer-jobs.integration.test.ts` | SEC-006 + ISS-037 with real MongoDB and Redis (`TEST_REDIS_URL` host, database index base + 1, see section 2): upload, re-index and sweep enqueue only `{documentId, workspaceId}`; the internal text route refuses missing/wrong secret, malformed input, unknown, deleted, cross-workspace and stale-claim requests; the gateway never reaches it; the real worker processes a pointer job end to end and a legacy text-carrying entry (text ignored); a hung provider fails its job at the deadline and the worker goes on; a late report from an old claim is fenced out |
| `workspace-owner-permissions.integration.test.ts` | SEC-010 across the real workspace-, document- and task-service apps and ai routes (real MongoDB, live membership checks): `isOwner` in the membership answer; members and outsiders get 403 on every delete, nothing changes; the owner can delete; member removal rules (owner only, not the owner, 404 for non-members); a removed member is refused on the very next request on every service and their tasks are unassigned |
| `retrieval-live-documents.integration.test.ts` | SEC-012 retrieval side (real ai routes and RAG code, real document-service live check; Pinecone, Voyage and LLM stubbed on the SDK objects): matches of deleted, missing and foreign documents are dropped from search results, from the answer's sources and from the LLM prompt, and the saved session cites only live documents; if the check cannot run, retrieval fails closed. Wave 4: other-model and below-threshold matches excluded (ISS-027/028), all-below-threshold gives no sources and the empty-context prompt, the prompt names the document title and not its id, the internal route returns `liveDocumentIds` unchanged plus `liveDocuments` (ISS-029), the session history redacts deleted sources in place and redacts all when the check fails (SEC-012 a) |
| `ai-timeouts-and-heartbeat.test.ts` | ISS-037/ARC-013: bounded settings fall back to defaults for garbage values; Voyage calls that never answer fail within their limit; the SSE answer carries `: ping` heartbeats during a slow answer and the frontend parser ignores them |
| `client-document-file.test.ts`, `client-workspace-roles.test.ts` | Frontend helpers: file fetch via the authenticated API with object URLs that are always revoked; owner-only controls |
| `gateway-path-guard.test.ts` | SEC-003: the real gateway app answers `400` for every non-canonical variant of the login, register, AI and generic routes (`//`, `///`, dot segments, `%2F` `%5C` `%2e` `%6E`…, `%00`, `%zz`, backslash, absolute-form, raw NUL), with and without a token, and none reaches the upstream stubs; canonical paths, query strings and one trailing slash still work; `/api/authx`-style prefixes are not forwarded. No Redis needed |
| `login-throttle.integration.test.ts` | SEC-025: per-account sign-in throttle through the real auth app (real MongoDB): 10 failures lock the account (11th attempt `429` even with the right password), unknown e-mails give identical responses, success resets, accounts independent, e-mail case normalised, lock and window expiry, invalid settings, concurrent burst. Wave 6 (W6-TEST-04): the lock test uses a 5 s lock, asserts the stored `lockedUntil` is `LOCK_MS` after the third failure, a `429` after the old 1.2 s, and waits on `lockedUntil` instead of a fixed sleep |
| `gateway-rate-limit.timing.ts` | **Timing** (serialized). SEC-003 + RT-001 + RT-001b with a real Redis (`TEST_REDIS_URL`) behind an in-test TCP proxy: gateway started while Redis is down fails open fast and enforces limits once Redis is up; path variants and canonical requests share one limit (upstream never sees more than 5 logins / 3 registrations / 30 AI queries / 20 summaries); 40 concurrent AI queries → exactly 30 forwarded; Redis refused or frozen → every limited request < 1 s and forwarded, one log line per outage; limits resume within 10 s. Wave 5 SEC-021: refresh, `/me` and logout share a per-IP limit of 60 per minute (the 61st is `429` and never reaches auth-service) |
| `docx-extraction-limits.timing.ts` | **Timing.** SEC-002 on the real extractor: the 19 KB / 180,000-paragraph bomb → `413` in < 1 s with event-loop delay < 200 ms; zero-ratio bomb, > 1,000 entries → `413`; missing parts, truncated and non-zip → `422`; parser differentials → `422` (the Wave 2 review's 410 KB hidden-archive bypass, a bomb in the ZIP comment, concatenated archives, trailing data, unreferenced bytes between entries); forged declared sizes → `422` in the extraction process; a FATAL out-of-memory abort and the time limit end only the child (`422`, no live child afterwards); small, streamed (data descriptor) and 5,000-paragraph legitimate DOCX extract (< 3 s); text cap `413`; concurrency gate (2 running, 8 waiting, then `503`; never more than 2 live children) |
| `login-timing.timing.ts` | **Timing.** SEC-025/SEC-009: median sign-in time for an unknown e-mail is within a tolerant band of a wrong password for a real account (dummy bcrypt check of the same cost); the dummy hash's cost equals `SALT_ROUNDS`. Wave 6 (W6-TEST-03): 31 pairs in ABBA order; the two median assertions are unchanged and the median of the per-pair ratios must meet the same thresholds; a deterministic test asserts exactly one awaited bcrypt compare (against the dummy hash) for an unknown e-mail |
| `docx-upload-limits.timing.ts` | **Timing.** SEC-002 through the real upload route (real MongoDB): bomb → `413` and the 410 KB hidden-archive bypass → `422` in < 1 s while `/health` keeps answering and the event loop is not blocked; forged bomb → `422`; repeated bombs leave the service healthy; nothing uploaded or stored and no temp file left; a large legitimate DOCX → `201`. Process level: the real `server.ts` in its own process (temp cwd, disposable database) gets 9 crafted/corrupt DOCX files, each answered with the expected 4xx while `/health` keeps answering; the process stays up and no temp file remains |
| `skip-visibility.test.ts` | ARC-006: a suite whose infrastructure is missing is reported as `# skipped N` (not a silent `# pass`), a missing `TEST_MONGO_URI` under `CI` fails the run, and no test file uses a bare `describe(..., { skip })`; Wave 6: no `*.timing.ts` file can skip or todo a test itself, and the noise helper only measures |
| `service-listen.test.ts` | SEC-004/RT-002: services bind `127.0.0.1` by default (`HOST` overrides; the gateway `0.0.0.0`); a port already in use makes the real process exit 1 with `EADDRINUSE`; a real workspace-service is reachable on loopback and refused on the LAN address |
| `gateway-health-and-request-id.test.ts`, `gateway-upstream-timeout.timing.ts`, `gateway-trust-proxy.timing.ts` | ISS-044 (`/health` reports the rate-limit store; `X-Request-ID` kept or generated and forwarded), SEC-008 gateway CSP and Swagger UI, RT-003 (silent upstream → 504 after the idle limit; streams that keep sending are not cut), RT-008 (`TRUST_PROXY` parsing, `true` refused; with a real Redis, per-client IP limits behind one proxy) |
| `access-token-lifetime.test.ts` | SEC-007: default access-token lifetime 5 minutes; `.env.example` documents `5m` |
| `workspace-member-hydration.test.ts` | ARC-004: member names fall back to placeholders with a warning (token unset, non-OK answer, timeout after 3 s) |
| `retrieval-filters.test.ts`, `rag-context-isolation.test.ts` | ISS-027/ISS-028: other-model and low-score matches dropped, `MIN_RELEVANCE_SCORE` parsing; SEC-011/ISS-029: one nonce-tagged block per chunk, forged tags and `[Source N]` neutralised, nonce differs per request, title labels, hostile titles escaped and capped, prompt rule |
| `ai-stream-disconnect.test.ts` | ISS-015: a client that leaves after two tokens aborts the LLM request; nothing more is generated or saved (control: a full answer saves one session) |
| `ai-answer-markdown.test.ts` | ARC-002: hardened Markdown options rendered with react-dom/server (headings, tables, KaTeX kept; images, raw HTML, `javascript:`/`data:` links removed; `rel` on links; KaTeX without trust) and the Q&A page wiring |
| `client-list-paging.test.ts` | ISS-043 client: list helpers follow `meta.nextCursor` (stubbed axios), stop at 10 pages and report truncation; pages show the notice |
| `client-csp.test.ts`, `frontend-config.test.ts` | SEC-008 SPA CSP (absolute/relative/unset API URL, `blob:`, no inline script, one meta tag, preview header); ISS-051 tsconfig split, `strict`, lint gate configuration |
| `dependency-resolution.test.ts` | RT-005 (ai-service resolves zod 4), RT-009 (no redis/cookie-parser in auth-service), SEC-022 (build tools are devDependencies), ISS-032 (each service declares every package it imports at runtime, including the shared code it compiles in); Wave 6 D3: every bare import under `tests/` is a root dependency pinned to the hoisted version, and vite is resolved through `frontend/package.json` |
| `jwt-hardening.test.ts`, `required-secrets-boot.test.ts`, `refresh-expiry.integration.test.ts` | Wave 5, SEC-019/ISS-047/SEC-018: every verifier (shared, auth, gateway, workspace, refresh) rejects tokens whose `userId` is missing, not a string or not 24-hex (an object would act as a Mongo operator), `alg: none` and other algorithms; `jwt.verify` only in the two allowed modules; auth-service and workspace-service exit 1 without `INTERNAL_SERVICE_TOKEN`, auth-service exits 1 when the JWT secrets are equal (names only printed); the stored refresh expiry follows the token's `exp` |
| `security-headers.test.ts`, `gateway-cors.test.ts`, `api-docs-flag.test.ts` | Wave 5, SEC-017/SEC-015/SEC-016/ISS-050: no `X-Powered-By` from workspace-service or through the gateway; CORS allow-list (loopback default on any port, foreign origin refused, exact list when `CORS_ORIGIN` is set, `*` refused at startup, no CORS headers from internal services); Swagger UI only with `API_DOCS_ENABLED=true`; workspace name max 100 |
| `provider-error-redaction.test.ts`, `ai-search-error-mapping.test.ts` | Wave 5, RT-007/RT-011: provider error details (keys, tokens, URLs) are redacted in logs; stored and returned failure reasons are fixed texts; a failing search is `502` with a fixed message |
| `ai-session-privacy.integration.test.ts`, `ai-service-health.test.ts` | Wave 5, SEC-023: each member sees only their own Q&A sessions, paged (default 20, cap 100, cursor); ARC-008/REQ-082: `/health` degraded (200) when only Redis is down, `/health/ready` strict; 50,000-character multi-byte meeting notes accepted, larger bodies `413` |
| `upload-temp-sweep.test.ts`, `legacy-data-hygiene.integration.test.ts` | Wave 5, SEC-024: random temp names in `UPLOAD_TMP_DIR`; the startup sweep deletes only its own old top-level files (links, other names, fresh files kept; repository, home, root and legacy folders refused); the user-run hygiene scripts change nothing in a dry run and only what each flag names (disposable database, injected models) |
| `client-validation-parity.test.ts`, `client-pdf-worker.test.ts`, `frontend-dead-code.test.ts`, `frontend-bundle.test.ts` | Wave 5, ISS-039/ISS-050/ARC-009/ARC-011: client register, meeting-notes and workspace-name rules match the server; the pdf.js worker is bundled from react-pdf's exact pdfjs-dist and the CSP names no CDN; every frontend module is reachable from `main.tsx`; a real production build (temp folder) has no JS chunk over 500 kB and no pdf.js/KaTeX/react-pdf in the entry chunk |
| `repo-hygiene.test.ts`, `docs-consistency.test.ts` | Wave 5, ISS-008/ISS-031/ARC-012: `docs/` is not git-ignored; phrase checks for the corrected documentation residuals |
| `log-redaction.test.ts` | Wave 6, W5-L3/W6-SEC-02/A-1: credentials inside connection URIs (`mongodb`, `mongodb+srv`, `redis`, `rediss`, `amqp`, `https`) are redacted; the shared error middleware logs 5xx AppErrors and database outages as one redacted, bounded line (no raw object, no `cause`, no query string); `logLlmFailure` is redacted and bounded; Stage E: multi-line messages cannot leak through the stack lines (only `    at` frames, 8 × 300 characters), JSON-quoted keys, bare JWTs and long/secret `name`/`code`/`status` are redacted (W6-R5-02, W6-R5-05) |
| `live-documents-batching.test.ts` | Wave 6, W5-L1: the session-history liveness check is sent in requests of at most 200 ids (450 → 200/200/50, exactly 200 → 1, de-duplicated, workspace id on each); any failed request redacts the whole page; document-service's cap stays 200 |
| `gateway-config-refusal.test.ts`, `gateway-header-strip.test.ts` | Wave 6, W6-SEC-01/03: the TRUST_PROXY parser only accepts what Express (proxy-addr) can compile (Wave 4 43-value corpus kept); an invalid `TRUST_PROXY`/`CORS_ORIGIN` stops the real gateway with one `[api-gateway] refusing to start: <VAR> ...` line (no value, no stack, exit 1), and `app.ts` still refuses when imported directly; `x-internal-token`, `x-forwarded-*` and `forwarded` sent by a client never reach any of the five upstreams |
| `registration-bounds.test.ts`, `token-lifetimes.test.ts` | Wave 6, W6-SEC-04/05: register name ≤ 100 (trimmed), e-mail ≤ 254, password ≤ 128 (server, client and model; login unchanged); `ACCESS_TOKEN_EXPIRES` ≤ 15 min and `REFRESH_TOKEN_EXPIRES` ≤ 30 days and longer than access, validated with jsonwebtoken's own parser (no unit-less values); the real auth-service refuses an invalid value with one line |
| `pdf-extraction-sandbox.test.ts`, `pdf-extraction-limits.timing.ts` | Wave 6, SEC-002-PDF: PDF text extraction runs in the DOCX child-process sandbox (minimal environment, one shared gate, heap and time limits); output byte-identical to the former in-process extraction; corrupt, empty and encrypted PDFs keep 422; text cap 413; a ~0.7 MB PDF that inflates to 24 million operators gets 422 at the time limit while `/health` keeps answering, nothing is stored and no temp file or process is left; Stage E (W6-R5-01): PDFs whose streams decode to 200 MB, 1 GiB, or 200 MB behind `[/ASCIIHexDecode /FlateDecode]` get 422 with the child's ArrayBuffer peak at or below 384 MiB |
| `infra-guard.test.ts`, `ci-config.test.ts`, `lint-ratchet.test.ts` | Wave 6, WP-8/9: tests only reach loopback MongoDB/Redis on non-default ports (27017/6379 and omitted ports refused, credentials need `authSource`, locally and in CI; messages never echo the URI); every test file loads the dead-port defaults before service code; static checks of `.github/workflows/ci.yml` (permissions, SHA pins, masking, gates, images, cleanup); the lint suppression baseline may only shrink |
| `compose-security.runtime.test.ts` | **Opt-in** (`TEST_COMPOSE_RUNTIME=1`, needs Docker; a required CI job since Wave 6). Starts the real compose files as a throwaway project on ports 5940–5942 and checks: localhost-only bindings, LAN addresses refused, Redis `NOAUTH`/`WRONGPASS`, default MongoDB credentials refused, each service user limited to its own database, provisioning script idempotent and fail-closed with no password output, mongo-express basic auth. Also runs auth-service and document-service from source with their own credentials. Removes the project with `down -v` |

---

## 2. Running the tests

All commands run from the repository root after `npm install`.

```bash
# Everything that can run without a database (integration suites are skipped)   [TESTED]
npm test
```

`npm run test:unit` is `tsx --test tests/*.test.ts`. Without `TEST_MONGO_URI` and `TEST_REDIS_URL` the MongoDB- and Redis-backed suites are reported as SKIP (never silently passed) and the runner prints `[tests] TEST_MONGO_URI not set`; that count was not re-measured in Wave 6.

```bash
# Full suite against a DISPOSABLE MongoDB and Redis (loopback, non-default ports) [TESTED]
TEST_MONGO_URI=mongodb://127.0.0.1:27095 TEST_REDIS_URL=redis://127.0.0.1:6395 \
REDIS_URL=redis://127.0.0.1:6399 MONGO_URI=mongodb://127.0.0.1:6598/rmtest_unused npm test
```

`npm test` runs two steps: `npm run test:unit` (`tests/*.test.ts`, files in parallel) and then `npm run test:timing` (`tests/*.timing.ts`, one file at a time, because they assert latencies under 1 s and event-loop delay under 200 ms that parallel CPU load would distort). **Counts (Wave 6 final local run, the CI floors): unit 794 tests (793 pass, 1 skipped: the opt-in compose runtime suite), timing 57 tests (2026-11-24, after the Stage E round 2 corrections; Stage E was 783 + 55, Wave 6 Stage D 752 + 52, Wave 5 587 + 47).** These numbers live in one place in CI: `UNIT_MIN_TESTS` / `TIMING_MIN_TESTS` in `.github/workflows/ci.yml` (the gate `scripts/ci/check-tap.mjs` fails when a stage runs fewer tests, any test fails, is cancelled or todo, or any skip other than the compose-runtime one appears). A count that falls between waves needs a logged reason. A suite whose infrastructure is missing is reported as one skipped test (`infraDescribe`, ARC-006), so `# skipped` in the summary shows it. The opt-in compose runtime suite is reported as SKIP unless `TEST_COMPOSE_RUNTIME=1`. Point the variables at disposable servers (see below), never at your development databases.

**Run nothing else while the timing stage runs.** Its thresholds are absolute wall-clock and event-loop numbers (they encode the SEC-002 property and are never relaxed). Under concurrent CPU load (another test run, a build, a busy browser) they can fail; since Wave 6 every such failure message ends with `[environment before this file: event-loop lag p99 … ms, max … ms; 1-min load average …]` (`tests/helpers/noise.ts`), which only reports and never skips or passes a test.

```bash
# One file, or tests matching a name (standard node:test options)              [UNTESTED]
npx tsx --test tests/auth-flow.test.ts
npx tsx --test --test-name-pattern="bulk" tests/task-workflows.integration.test.ts
```

### Integration test requirements

- `TEST_MONGO_URI` must point at a MongoDB server **whose data does not matter**. Each test file creates its own database named `rmtest_<label>_<random>` and drops only that database when it finishes. A run that is killed before its cleanup can leave an `rmtest_*` database behind; drop it by hand.
- If the environment variable `CI` is set but `TEST_MONGO_URI` (or `TEST_REDIS_URL`) is not, the helper throws, so a misconfigured pipeline fails instead of reporting skipped suites.
- **Disposable-target guard (Wave 6, `tests/helpers/infra-guard.ts`), applied locally AND in CI:** `TEST_MONGO_URI`, `TEST_REDIS_URL` and the test process's own `MONGO_URI` / `REDIS_URL` must name loopback hosts only (`127.0.0.1`, `localhost`, `::1`), must not use the default ports 27017 / 6379 (an omitted port counts as the default), and `mongodb+srv://` is refused. Otherwise the test process stops with `<VARIABLE>: <rule>`; the URI itself is never printed. `tests/helpers/test-env.ts` sets dead-port defaults (`redis://127.0.0.1:6399`, `mongodb://127.0.0.1:6598/rmtest_unused`) when `REDIS_URL` / `MONGO_URI` are unset, so no service module can fall back to a real server, and every spawned service gets a temp working directory (no `.env` is loaded) and explicit connection strings.
- **Authenticated servers.** An unauthenticated throwaway MongoDB is the simplest option, for example `docker run --rm -d -p 127.0.0.1:27018:27017 --name rm-test-mongo mongo:7.0` and `TEST_MONGO_URI=mongodb://127.0.0.1:27018`. With authentication the URI shape is `mongodb://<user>:<password>@127.0.0.1:<port>/?authSource=admin`; **`?authSource=admin` is mandatory** (the guard refuses credentials without it) because `service-listen.test.ts` and `docx-upload-limits.timing.ts` replace the database path of `TEST_MONGO_URI`, which would otherwise become the authentication database (MongoDB error 18, AuthenticationFailed). A password-protected Redis is `redis://:<password>@127.0.0.1:<port>/<db>`. Use URL-safe (hex) passwords.
- `TEST_REDIS_URL` (for example `redis://127.0.0.1:6395/7`) must point at a Redis **whose data does not matter**. Its database index is the **base** (0 when omitted, at most 13): `gateway-rate-limit.timing.ts` uses base, `embedding-pointer-jobs.integration.test.ts` base + 1 and `gateway-trust-proxy.timing.ts` base + 2 (`tests/helpers/test-redis.ts`). Only named keys are deleted (`rl:*`, the embedding queue key; SCAN + DEL, never FLUSHDB) and outages are simulated with an in-test TCP proxy, so the Redis server itself is never stopped. Run one test run per database range at a time; a second concurrent run needs another base. Without it those suites are reported as SKIP; with `CI` set they fail instead. A throwaway server: `docker run --rm -d -p 127.0.0.1:6395:6379 --name rm-test-redis redis:7.4`. Every other test points Redis-using code at a closed port.

### Compose runtime test (opt-in)

```bash
TEST_COMPOSE_RUNTIME=1 npx tsx --test tests/compose-security.runtime.test.ts   # [TESTED]
```

The test never uses the default compose project, the root `.env` or the default ports:
- it runs as project `rmstabtest` (`TEST_COMPOSE_PROJECT`, which must look like `rm*test*`) with an env file of random secrets in the OS temp directory;
- it uses host ports `TEST_COMPOSE_PORT_BASE` to `+4` (default 5940–5944; it refuses 27017/6379/8081 and ports already in use);
- an override resets `container_name`, so no name can collide with your own containers;
- it removes only its own project (`docker compose -p rmstabtest down -v`).
- It needs Docker Compose 2.24 or later (the override uses the `!reset` tag). In CI it runs as its own required job (`compose-runtime`, project `rmcitest`, ports 15940–15944, 0 skips and at least 12 tests).

### External services

No test contacts Cloudinary, Voyage AI, Pinecone or Groq/xAI. Tests set random secrets (`tests/helpers/test-env.ts`) and dummy provider keys when they are not already set, and replace provider clients and peer services with in-process stubs or ephemeral local HTTP servers. You do not need any `.env` file or provider account to run the suite.

---

## 3. Typecheck, build and lint

```bash
# Typecheck each backend service (same as CI, which uses `npx tsc`)              [TESTED]
./node_modules/.bin/tsc --noEmit -p services/api-gateway
./node_modules/.bin/tsc --noEmit -p services/auth-service
./node_modules/.bin/tsc --noEmit -p services/workspace-service
./node_modules/.bin/tsc --noEmit -p services/document-service
./node_modules/.bin/tsc --noEmit -p services/task-service
./node_modules/.bin/tsc --noEmit -p services/ai-service

# Frontend typecheck + production build (tsc -b && vite build)                  [TESTED]
npm run build -w frontend

# Frontend lint (0 errors, 3 warnings, exit 0)                                  [TESTED]
npm run lint -w frontend

# Compile one service to dist/ (then `npm start -w <service>`)                 [TESTED]
npm run build -w <service>
```

**Lint gate (ISS-051, Wave 4).** `npm run lint` (root) runs `npm run lint -w frontend`, which was `eslint . --max-warnings 4` until Wave 6 (now `--max-warnings 3`). Before Wave 4 ESLint reported 45 problems (41 errors, 4 warnings); 10 errors were fixed and the remaining **31 errors are baselined** in `frontend/eslint-suppressions.json` (by file and rule: 24 `no-explicit-any`, 6 `react-hooks/set-state-in-effect`, 1 `react-hooks/immutability`). Result: 0 errors, 4 warnings (2 `react-hooks/incompatible-library`, 2 `react-hooks/exhaustive-deps`), exit 0.

**Wave 5 (ARC-009).** Deleting the unreachable wizard and dashboard files removed one suppressed error (`ProjectDomainStep.tsx`, entry pruned) and one warning (`WorkspaceDetailsStep.tsx`). Now **30 suppressed errors** (23 `no-explicit-any`, 6 `react-hooks/set-state-in-effect`, 1 `react-hooks/immutability`) and **3 warnings** (1 `react-hooks/incompatible-library`, 2 `react-hooks/exhaustive-deps`), exit 0.

**Wave 6 (W5-L2, W6-CI-02).** The script is now `eslint . --max-warnings 3`, lint is a CI step, and `tests/lint-ratchet.test.ts` holds a snapshot of the allowed suppressions per file and rule (30 in 12 files): a new file, a new rule or a higher count fails `npm test` and CI, so growing the baseline is a visible edit of that test.

```bash
# Tests typecheck (strict, bundler resolution; Wave 6)                           [TESTED]
npm run typecheck:tests
```
- A **new** error fails lint; so does a suppression that no longer matches anything (ESLint reports unused suppressions), so the baseline can only shrink. After fixing a suppressed problem run `npx eslint . --prune-suppressions` in `frontend/` and commit the smaller file.
- Lower `--max-warnings` when a warning is fixed.
- Never regenerate the baseline with `--suppress-all` to hide new errors.

`notification-service` has no source and no build; it is not typechecked.

**`npm ls` on Windows (ISS-032).** npm 10.9.2 can crash in `npm ls --depth=0` (`Cannot read properties of undefined (reading 'edgesOut')`) when the current directory has a **lower-case drive letter** (`d:\ReserchMind`). It is an npm bug, not a repository problem. Run it from an upper-case path, for example in PowerShell `Set-Location D:\ReserchMind; npm ls --depth=0`, or in CI.

---

## 4. Continuous integration

Workflow: `.github/workflows/ci.yml` (rewritten in Wave 6), five jobs on `ubuntu-latest`. **GitHub Actions has not run it yet**: it was validated statically (`tests/ci-config.test.ts`, YAML parse) and with local equivalents of its steps; the first pull request is its first real run.

- **Triggers:** pull request into `develop` or `main`, push to `develop` or `main`, and manual `workflow_dispatch`. Never `pull_request_target`; no repository secrets are used.
- **Hardening:** `permissions: contents: read` (no job widens it); every checkout uses `persist-credentials: false`; every action is pinned to a full commit SHA with its tag in a comment (`actions/checkout` v4.4.0, `actions/setup-node` v4.4.0, `actions/upload-artifact` v4.6.2, looked up with `gh api repos/actions/<name>/commits/<tag>` and `git ls-remote` on 2026-11-15); `bash` with `-eo pipefail`; `timeout-minutes` on every job; superseded pull-request runs are cancelled. Node comes from `.nvmrc` (22.14.0; root `engines`: node `>=22.12 <23`, npm `>=10.9 <11`, not enforced). No step may use `continue-on-error` or any shell-level `||` (`|| true`, `|| :`, `|| echo …`, `|| exit 0`; quoted strings such as the JavaScript in `node -e '…'` are not shell syntax); only the named report and cleanup steps tolerate a failure (`set +e` … `exit 0`). Gate, stage, scan and tree-clean steps run unconditionally or exactly on `${{ !cancelled() }}`. Every artifact upload runs only when that job's credential scan succeeded (`always() && steps.<scan>.outcome == 'success'`). All of this is enforced by `tests/ci-config.test.ts` (Wave 6 Stage E, W6-R6-01, W6-R5-04).
- **`static`:** `npm ci`, lockfile unchanged by the install (`git diff --exit-code -- package-lock.json`), lockfile drift check (`npm install --package-lock-only --ignore-scripts`, then the same `git diff`: the committed lock must be npm's stable output, W6-R6-09), `npm ls --depth=0`, `tsc --noEmit` for the six services, `tsc -b frontend`, `npm run typecheck:tests`, `npm run lint` (max 3 warnings; stale suppressions fail), the suppression ratchet test, and a "no focused tests" grep.
- **`build`:** `npm run build -w <service>` for the six services, each followed by a check that `services/<svc>/dist/services/<svc>/src/server.js` exists; `npm run build -w frontend`; the built `index.html` carries the CSP meta tag and no file references `unpkg.com`.
- **`test`:** the two images are pre-pulled with three retries; a disposable MongoDB (`mongo:7.0`, root user) and Redis (`redis:7.4`, `requirepass`) started with `docker run` on `127.0.0.1:27018` and `127.0.0.1:6380`, with per-run passwords from `openssl rand -hex 32` that are masked before any use and passed only as `-e VARIABLE`. `TEST_MONGO_URI=mongodb://ci_root:<generated>@127.0.0.1:27018/?authSource=admin`, `TEST_REDIS_URL=redis://:<generated>@127.0.0.1:6380/7` (database base 7, so 7, 8 and 9 are used); `MONGO_URI` / `REDIS_URL` point at dead ports. A readiness step (`scripts/ci/wait-infra.cjs`) waits until an authenticated ping works AND anonymous access is refused. Then the unit stage (with a report-only lcov coverage file; code in spawned child processes is not counted), its gate (`scripts/ci/check-tap.mjs`: 0 fail/cancelled/todo, exactly 1 skip with the reason `set TEST_COMPOSE_RUNTIME=1 …`, at least `UNIT_MIN_TESTS`), the serialized timing stage without coverage and its gate (0 skips, at least `TIMING_MIN_TESTS`), a scan of the reports for the generated passwords or any `scheme://user:password@` URI, a check that the tests left the tree clean (`git status --porcelain`), the report upload and the container removal.
- **`compose-runtime`:** `tests/compose-security.runtime.test.ts` with `TEST_COMPOSE_RUNTIME=1`, project `rmcitest`, ports 15940–15944, the generated env file in `RUNNER_TEMP`; Docker Compose ≥ 2.24 is checked; images are pre-pulled with retries; gate: 0 skips and at least 12 tests (since Wave 6 Stage E, W6-R6-02, the "LAN addresses" test FAILS under `CI` when the machine has no non-loopback IPv4, and elsewhere records a counted skip — it no longer passes silently; `check-tap.mjs` also requires positive integer `--min-tests` and `--skips` values, W6-R6-04); cleanup by the label `com.docker.compose.project=rmcitest` (containers, networks, volumes).
- **`audit`:** `npm audit --omit=dev --audit-level=moderate` is the gate (from `package-lock.json` alone, no install; today 4 low, all in the katex chain); the full-tree `npm audit --json` is a report-only artifact (today 19: 2 high, 12 moderate, 5 low, all dev-only or katex).
- **Required checks for branch protection (user action):** `static`, `build`, `test`, `compose-runtime`, `audit`.
- **Images:** `mongo:7.0` and `redis:7.4` in CI and in `docker-compose.yml` (the same minor lines as the former `mongo:7` / `redis:7`); `mongo-express:1.0.2`.
- **Dependencies:** CI installs with a plain `npm ci`; its only other npm install is the lock-only drift check above (`--package-lock-only --ignore-scripts`, which writes no `node_modules` and runs no scripts); it never runs `npm audit fix`. Make dependency changes locally with `npm install` (add `--legacy-peer-deps` only if npm reports the known `@langchain/community` / `openai` ERESOLVE while re-resolving), then check that a plain `npm install --package-lock-only` changes nothing and a plain `npm ci` works. Do **not** add `legacy-peer-deps` to `.npmrc`. After pulling a lockfile change run `npm ci`.
- **Not in CI:** any live provider, browser tests, deployment, a coverage threshold.

---

## 5. Manual verification

The end-to-end flow (register → workspace → upload → indexed → Q&A → meeting notes → tasks) is only checked by hand; see the verification workflow in [onboarding.md](onboarding.md). It needs real Cloudinary, Voyage, Pinecone and Groq/xAI accounts.

---

## 6. Known gaps

- **No browser end-to-end tests** (no Playwright/Cypress).
- **No component tests:** React pages and components are not tested; only framework-free frontend helpers are (`tests/client-*.test.ts`, `tests/document-url-guard.test.ts`).
- **No live-provider tests:** behaviour against real Cloudinary, Voyage, Pinecone and Groq/xAI (including answer quality, citations and retrieval relevance) is unverified by automation.
- **Limited route coverage:** workspace create/list and board CRUD have no route-level tests (login is covered by `login-throttle.integration.test.ts`, register bounds by `registration-bounds.test.ts`, AI session listing by `ai-session-privacy.integration.test.ts`, gateway rate limits by `gateway-rate-limit.timing.ts`).
- **Lint** passes with the suppression baseline (30 suppressed errors in 12 files, 3 warnings); the baseline may only shrink.
- **Coverage is report-only** (no threshold) and misses code that runs in spawned child processes; no load tests, and no tests for `npm run dev` / the `concurrently` startup scripts.
- **Latency assertions in the parallel unit stage** (W6-TEST-14: `ai-timeouts-and-heartbeat`, `embedding-job-processing`, `workspace-membership`, `workspace-member-hydration`, `ai-validation-and-stream`, `embedding-pointer-jobs`) passed every local run; watch them on the first CI runs (fewer vCPUs) before moving any to the timing stage.
- **Linux:** the suite has not run on Linux yet; the first pull-request run is the Linux verification (signals, timing on 2–4 vCPUs).

---

## Related documentation

- [Developer onboarding](onboarding.md)
- [Deployment and operations](deployment/docker-process.md)
- [Environment variables](reference/environment-variables.md)
- [Background jobs](operations/background-jobs.md)
