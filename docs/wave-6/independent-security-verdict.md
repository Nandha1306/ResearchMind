# Wave 6 independent security verdict (Agent 5)

- **Date:** 2026-11-15
- **Reviewer:** Agent 5, independent final security reviewer. I took no part in planning or implementing Wave 6. Every result below comes from reading the code in the working tree and from my own attacks on isolated services. Neither the implementer's report nor its logs counted as evidence.
- **Repository state:** branch `fix/wave-5-stabilization`, HEAD `8b4a304`, uncommitted working tree with Waves 1 to 6. `git status --short --untracked-files=all` lists 299 entries, the same as the implementer's final snapshot (`stab/w6-gitstatus-after.txt`). `md5sum -c stab/w6-allhash-after.txt` shows that only `docs/wave-6/w6-evidence.md` and the roadmap changed after the implementer's final hash, and both are documentation.
- **Rules followed:** `stab/w6-rules.md`. I made no git write and did not read or modify any `.env` file. I did not contact 27017 or 6379. Every command set `MONGO_URI`, `REDIS_URL`, `TEST_MONGO_URI` (`mongodb://127.0.0.1:27095`) and `TEST_REDIS_URL` (`redis://127.0.0.1:6395/4`) explicitly. I used only ports 5950 to 5959 and called no live provider.
- **Probe scripts and raw outputs:** `stab/w6r5/*.ts` and `stab/w6r5/*.out` / `*.log` (scratch only).

## Verdict

**PASS** (final recheck, round 2, 2026-11-24; see the last section of this file)

All findings W6-R5-01 to W6-R5-10 are corrected, and I verified each correction against the code with my own probes. The remaining items are documented, non-blocking residuals (Info): pattern-based redaction, PDF buffers under 1 MiB bounded only by the sampled watchdog, the 30 s extraction slot, and bcrypt's 72-byte limit. No security objection to Wave 6 remains.

History: after the re-review of 2026-11-24 the verdict was PASS WITH CORRECTIONS. The Stage E corrections closed W6-R5-01 to W6-R5-07, with W6-R5-01 dropping from Medium to a Low residual, and the re-review found three new **Low** findings, W6-R5-08 to W6-R5-10:

- **W6-R5-08:** the redaction regexes take quadratic time on crafted input. One rule shipped with the first Wave 6 delivery; the other was added in Stage E.
- **W6-R5-09:** the PDF watchdog is sampled, so memory can overshoot it.
- **W6-R5-10:** message lines that look like stack frames are logged unredacted.

Nothing is High or Medium. Sections 1 to 5 below are the original review of 2026-11-15 and are kept unchanged.

Original summary (2026-11-15): none of the Wave 6 changes weakens a Wave 1 to 5 control, and every claimed Wave 6 control works when attacked, with these exceptions:

- One **Medium** residual: the PDF sandbox's "memory cap" does not limit decoded-stream (ArrayBuffer) memory, and the docs and evidence describe the memory bound wrongly.
- Three **Low** findings: stack-frame lines of multi-line error messages bypass log redaction; a leading-zero port bypasses the test-infrastructure guard; CI uploads the test reports even when the credential scan fails.

No finding is High. None of them is reachable without authentication or exposes a secret that exists today. The corrections in section 3 are required before this is called a full PASS. They are small and local.

---

## 1. Scope reviewed

I confirmed the Wave 6 files against `w6-evidence.md` section 5 in two ways: the `git status` before/after diff, which shows 7 newly modified tracked files and 27 new untracked files, and the before/after hash list, which shows 92 files in total. The security-relevant files I read in full:

- `packages/shared/errors/safe-error.ts`, `packages/shared/errors/error.middleware.ts`, `services/ai-service/src/errors/llm.error.ts`
- `services/api-gateway/src/{app.ts, server.ts, preflight.ts, config/gateway-config.ts, config/trust-proxy.ts}`, `packages/shared/http/cors-origins.ts`
- `services/auth-service/src/{preflight.ts, server.ts, config/token-lifetimes.ts, utils/jwt.ts, models/User.ts}`, `packages/validation/schemas/auth.schema.ts`, `frontend/src/lib/validations/auth.schema.ts`
- `services/task-service/src/server.ts`, `services/task-service/.env.example`, every `services/*/src/routes/internal.routes.ts`, `packages/shared/auth/internal-auth.middleware.ts`, `services/document-service/src/middlewares/internal-auth.middleware.ts`, `packages/shared/config/secrets.ts`
- `services/document-service/src/utils/{extraction-sandbox.ts, pdf-extractor.ts}` (and the gate imports in `docx-extractor.ts`)
- `services/ai-service/src/services/document-status.service.ts` (`fetchLiveDocumentIds`), `ai-session.service.ts` (`redactDeletedSources`), and the `liveDocumentsHandler` in document-service
- `tests/helpers/{infra-guard.ts, test-env.ts, test-mongo.ts, test-redis.ts, spawn-service.ts}`
- `.github/workflows/ci.yml`, `scripts/ci/{check-tap.mjs, wait-infra.cjs, scan-reports.mjs}`, `docker-compose.yml`

---

## 2. Checks, commands and actual results

The common environment prefix for every run below was `NODE_PATH=D:\ReserchMind\node_modules REDIS_URL=redis://127.0.0.1:6599 MONGO_URI=mongodb://127.0.0.1:6598/rmw6r5_unused TEST_MONGO_URI=mongodb://127.0.0.1:27095 TEST_REDIS_URL=redis://127.0.0.1:6395/4`. Probes that import service code ran with the scratch folder as working directory, so no `.env` could be loaded. Spawned services ran in a fresh temporary working directory with a minimal environment, using `tests/helpers/spawn-service.ts`. Their output confirms it: `injected env (0) from .env`.

### 2.1 Log sanitisation (item 1)

**Command:** `npx tsx stab/w6r5/log-probe.ts`. It feeds 30 input shapes to `redactSecrets` and `describeErrorForLog`, exercises attached properties, `cause`, 100,000-character messages and `logLlmFailure`, and runs a real Express app with the shared `errorMiddleware` on 127.0.0.1:5950. The marker is a random-looking `Qx7Hv92Lmn4K`. A first run with a marker containing "SECRET" was discarded because the keyword rule hid partial leaks.

**Redacted correctly (marker absent):**

- Credentialed URIs for `mongodb://`, `mongodb+srv://`, `redis://:pw@`, `rediss://`, `amqp://`, `https://user:pw@`, `postgres://` and upper-case `MONGODB://`.
- An unescaped `@` inside the password (`mongodb://u:p@<S>@h1,h2/db` → `mongodb://<redacted>@h1,h2/db`) and an escaped `%40`.
- `x-internal-token: …`, `Authorization: Bearer …` and `Basic …`, `api_key=`, `apiKey: …`, `token …`, `client_secret=`.
- Provider key shapes `gsk_`, `sk-proj-`, `pcsk_`, `pa-`.
- URL query strings, `cookie:` headers.
- Attached `apiKey`, `config.headers.authorization` and `cause` are never printed (`Error: upstream failed`).
- A 100,000-character message gives 307 characters of output.
- `logLlmFailure` with a `gsk_` key in the message and a `?key=` URL gives one line, at most 357 characters, no marker: `[ai-service] LLM query failed (reason=request_failed) :: Error: 401 Invalid API key <redacted-key> provided; see https://api.groq.com/x?<redacted>`.

**Running app, log output captured:**

| Route | Status | Log contains secret | Log line (secret shown as `<<SECRET>>`) |
|---|---|---|---|
| AppError 503 with `token=…`, attached `apiKey`, `config.headers` | 503 | **no** | `[GET /app503] AppError status=503: upstream down token=<redacted>` + 8 frames |
| Mongo outage (`MongoServerSelectionError` with a credentialed URI) | 503 | **no** | `[GET /mongo] Database unavailable: MongoServerSelectionError: connect ECONNREFUSED mongodb://<redacted>@db:27017` |
| `buffering timed out` with a `redis://:pw@` URI | 503 | **no** | `... (redis://<redacted>@h:6379)` |
| `?token=<S>` in the request URL | 500 | **no** | `[GET /withq] AppError status=500: x` (query string dropped) |
| **AppError 503, multi-line message** | 503 | **YES** | line 1 redacted, then `mongodb://svc:<<SECRET>>@db.internal:27017/app` repeated unredacted from `err.stack` → **W6-R5-02** |
| **Unhandled Error, multi-line message** | 500 | **YES** | same through the catch-all branch → **W6-R5-02** |

I also captured log output from real service apps. In `internal-probe.ts` the apps of auth, document and task ran unmodified, and the outage branch printed `[POST /internal/users/bulk] Database unavailable: MongooseError: Operation users.find() buffering timed out after 10000ms`. The task-service AppError branch printed `[GET /api/tasks/workspaces/<id>/tasks] AppError status=503: Workspace access could not be verified right now. Please try again.` with frames only. No secrets appear in either.

**Pattern gaps (W6-R5-05, Low):**

- JSON-quoted pairs are not redacted: `{"apiKey":"<S>"}`, `{"password":"<S>"}`, `"secret": "<S>"`.
- A bare JWT without `Bearer` is not redacted.
- `mongodb://u:pa/<S>@h` is not redacted (an unescaped `/`, `#` or `?` in the password; such a URI is invalid).
- `describeErrorForLog` neither redacts nor bounds `name`, `code` or `status`: with a 5,000-character name and code, the output is 10,009 characters.

### 2.2 AuthN/AuthZ, JWT, token lifetimes, registration bounds (item 2)

**Command:** `node --import tsx/loader auth-probe.ts`. It runs the real `services/auth-service/src/server.ts` on 127.0.0.1:5951 against disposable MongoDB database `rmw6r5_auth`, which was dropped at the end.

**Boot refusals.** Each case produced exit 1, exactly one line naming the variable and the rule, no stack, and no value echo:

- `ACCESS_TOKEN_EXPIRES` = `1h`, `16m`, `901s`, `0s`, `-5m`, `0.1s` → "must be longer than 0 and at most 15 minutes".
- `604800`, `300`, `fivemins`, `1e3s` → "must be a duration with a unit".
- `REFRESH_TOKEN_EXPIRES` = `31d`, `1y`, `2592001s` → "at most 30 days"; `604800` (no unit) → refused.
- Refresh equal to access (`5m`/`5m`) or shorter than access (`15m`/`10m`) → "must be longer than ACCESS_TOKEN_EXPIRES".
- Equal JWT secrets → `[auth-service] refusing to start: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.`

**Accepted values boot and sign as validated:**

| Setting | Register | Access token | Refresh token | Algorithm |
|---|---|---|---|---|
| `15m`/`30d` | 201 | 900 s | 2,592,000 s | HS256 |
| `0.5m`/`1h` | 201 | 30 s | 3,600 s | HS256 |
| default | 201 | 300 s | 604,800 s | HS256 |

**Registration bounds:**

| Input | Status |
|---|---|
| name 100 | 201 |
| name 101 | 400 |
| name 100 padded with 10 spaces | 201 (trimmed) |
| name "  N  " | 400 |
| e-mail 254 | 201 |
| e-mail 255 | 400 |
| password 128 | 201 |
| password 129 | 400 |
| password 100,000 | 400 |

**Legacy users are not blocked.** I inserted a user directly with a 300-character password and a 150-character name:

- Login → **200**; `/me` → 200; refresh rotation → 200.
- Reuse of the rotated refresh token → 401.
- Refresh token used as an access token → 401; access token used as a refresh token → 401.
- The stored name is still 150 characters after login.
- `grep` shows `User.create` is the only write to `User` (no `.save()`, `updateOne` or `findOneAndUpdate` on users), so the new model `maxlength` cannot break existing accounts.

**HS256 only and token confusion** (in-process apps, `internal-probe.ts`). Each of these token kinds was refused with 401 by auth-service `/api/auth/me` and by task-service `/api/tasks/workspaces/:id/tasks`:

- `alg: none`
- HS512 with the right secret
- a token signed with the refresh secret
- a token signed with `INTERNAL_SERVICE_TOKEN`
- an expired token
- a token with an object `userId`

A valid HS256 token passed authentication (503 afterwards because no workspace-service was running).

### 2.3 Service-to-service token (item 3)

**task-service boot** (`internal-probe.ts`, real `server.ts`, temp cwd): `INTERNAL_SERVICE_TOKEN` unset, set to a `<placeholder>`, set to `abc123` or set to `changeme` → exit 1, `[task-service] refusing to start due to insecure secret configuration:` naming the variable, no value. The `.env.example` template value is `<generate-with-openssl-rand-hex-48>`, which is the refused placeholder form.

**Every internal route in every service.** I took the routes from the route files; workspace-service has none. The apps were imported in-process on 127.0.0.1:5954 to 5958:

| Service | Route | none | wrong token | user JWT | JWT + wrong | `/INTERNAL/...` | correct token |
|---|---|---|---|---|---|---|---|
| auth | POST /internal/users/bulk | 401 | 401 | 401 | 401 | 401 | passes the gate (503: DB) |
| document | PATCH /internal/documents/:id/embedding-status | 401 | 401 | 401 | 401 | 401 | passes (503) |
| document | POST /internal/documents/:id/embedding/claim | 401 | 401 | 401 | 401 | 401 | passes (503) |
| document | GET /internal/documents/:id/embedding-source | 401 | 401 | 401 | 401 | 401 | passes (503) |
| document | POST /internal/documents/live | 401 | 401 | 401 | 401 | 401 | passes (503) |
| task | POST /internal/workspaces/:w/members/:u/unassign | 401 | 401 | 401 | 401 | 401 | passes (503) |
| ai | DELETE /internal/vectors/workspaces/:w/documents/:d | 401 | 401 | 401 | 401 | 401 | not sent (would call Pinecone) |

**The token is never accepted on public routes.** With the correct `x-internal-token` and no JWT:

- auth `/api/auth/me` → 401
- workspace `/api/workspaces` → 401
- document `/api/documents/workspace/:w` → 401
- document `/api/documents/:id` → 401
- task `/api/tasks/workspaces/:w/tasks` → 401
- ai `/api/ai/sessions/workspace/:w` → 401
- ai `POST /api/ai/query` → 401

**The gateway strips client headers on all five proxies.** Command: `gw-probe.ts`, the real gateway on 5952 with all five `*_SERVICE_URL` pointing at my echo upstream on 5953 and `TRUST_PROXY=1`. I sent `x-internal-token`, `X-Forwarded-For`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `forwarded` and a valid `x-request-id`. These requests reached the upstream with **none** of the six headers, with `x-request-id` and `authorization` kept:

- `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/workspaces`, `GET /api/documents/x`, `GET /api/tasks`
- `POST /api/ai/query`, `GET /api/ai/sessions`

A raw-socket request (`gw-raw.ts`) with duplicated and case-varied `X-INTERNAL-TOKEN`/`x-internal-token`, `X-Forwarded-For` ×2, `FORWARDED`, `X-Forwarded-Proto` and `Connection: close, x-internal-token` returned 200. The upstream's raw header names were only `x-request-id, connection, authorization, host`.

### 2.4 Gateway configuration (item 4)

**Command:** `gw-probe.ts`, real `server.ts` in a temp cwd. Each of these 19 values gave **exit 1, exactly 1 line, no `    at ` frame, no value echo, variable named**:

- `TRUST_PROXY` (14 values):
  - IPv4-compatible IPv6, the new rejections: `::0.0.0.0/96`, `::127.0.0.1`, `::1.2.3.4/104`, `::203.0.113.77`
  - `true` and ` TRUE `
  - too-wide ranges, still refused: `0.0.0.0/0`, `::/0`, `10.0.0.0/7`, `::ffff:0:0/96`, `::ffff:10.0.0.0/100`
  - `11`, `loopback,203.0.113.77/40`, `x203.0.113.77x`
- `CORS_ORIGIN` (5 values): `*`, `null`, `https://203.0.113.77/p`, `https://u:203.0.113.77@app.example.com`, `ftp://app.example.com`

An example line: `[api-gateway] refusing to start: TRUST_PROXY must be a hop count (1-10) or a list of IP addresses, CIDRs or loopback/linklocal/uniquelocal`.

**`app.ts` imported directly** (`node --import tsx -e "require('…/app.ts')"`) with `TRUST_PROXY=::0.0.0.0/96`, `true`, `0.0.0.0/0` or `CORS_ORIGIN=*` → exit 1 and `APP LOADED` never printed. It throws an `Error` naming the variable, so it still fails closed.

**Accepted controls still start (`/health` 200):** `1`, `loopback, 10.0.0.0/8`, `::ffff:10.0.0.0/104`, `2001:db8::/32`.

By reading the code: the `compilesInExpress` cross-check runs only on entries already classified `ok`, so it can only add rejections.

### 2.5 PDF sandbox (item 5)

**Command:** `pdf-probe.ts`, `gate-probe.ts`, `pdfmem-time.ts`. The parent process had `JWT_*`, `INTERNAL_SERVICE_TOKEN`, `CLOUDINARY_API_SECRET`, `VOYAGE_API_KEY`, credentialed `MONGO_URI`/`REDIS_URL` and `NODE_OPTIONS=--max-old-space-size=4096` set.

- **Minimal environment.** Child env keys: `HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SystemRoot, TEMP, TMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR`. `sandboxChildEnv()` passes only `PATH, SystemRoot, TEMP, TMP`; Windows adds the rest. Parent secret visible in the child: **false**. Child `execArgv` is only the heap flag, so `NODE_OPTIONS` was not inherited.
- **Timeout.** An endless loop with `timeoutMs` 1500 gives 422 after 1,517 ms. The child pid was dead afterwards (`process.kill(pid, 0)` throws) and no live extraction pids remained.
- **Hostile PDF.** The fixture's 4,000,000-operator bomb (124,867 bytes, inflating to 64 MB) with `timeoutMs` 3000 gives 422 "took too long" in 3,082 ms. The parent's maximum event-loop lag was 15 ms.
- **Response mapping.** A legitimate 3-page PDF extracted 2,656 characters. A text cap of 50 gives 413. Garbage bytes give 422; an empty file gives 422.
- **One gate for both formats.** With the gate full (2 running PDF bombs and 8 queued), a valid PDF gets 503 and a **valid DOCX also gets 503**; after release the DOCX extracts normally. A malformed DOCX gets 422 before reaching the gate, because the precheck runs first.
- **Repository timing test.** `npx tsx --test --test-concurrency=1 tests/pdf-extraction-limits.timing.ts`: **exit 0, 4/4**. This includes "the heavy PDF: 422 within the extraction timeout, /health answering, nothing stored, no temp file" through the real upload route and MongoDB.
- **Memory bound (W6-R5-01).** A child started with `--max-old-space-size=64` allocated 300 MB of `Uint8Array`: rss 342 MB, arrayBuffers 300 MB, heapUsed 4 MB. The heap flag does not limit ArrayBuffer memory.
  - With a 204,501-byte PDF whose content stream inflates to about 200 MB of spaces (about 1,025:1), the same pdf-parse code under a 64 MB heap peaked at **rss 401 MB / arrayBuffers 384 MB**, and `extractPdfText` **accepted** the file.
  - With the production defaults (512 MB heap, 30 s), the same file was **accepted after 6,945 ms**.
  - The upload limit is 10 MB (`upload.middleware.ts:57`), so a single upload can carry a stream that inflates to about 10 GB. Two extraction slots run at once. Only the 30 s wall clock stops decoded-stream growth, not the "512 MB heap limit" the documentation describes.
  - I deliberately did not run a multi-GB test on this machine (15.7 GB total, about 2.2 GB free).

### 2.6 AI history liveness batching (item 6)

**Command:** `batch-probe.ts`, a stub document-service on 127.0.0.1:5955 that enforces the 200-id cap and workspace ownership (even ids belong to W1, odd ids to W2, multiples of 7 are deleted).

| ids (+ up to 50 duplicates) | requests | request sizes | every request has W1 | token on every request | no duplicates in a request | live returned |
|---|---|---|---|---|---|---|
| 1 | 1 | 1 | yes | yes | yes | 1/1 |
| 199 | 1 | 199 | yes | yes | yes | 171/171 |
| 200 | 1 | 200 | yes | yes | yes | 172/172 |
| 201 | 2 | 200, 1 | yes | yes | yes | 173/173 |
| 450 | 3 | 200, 200, 50 | yes | yes | yes | 386/386 |
| 1000 | 5 | 200 ×5 | yes | yes | yes | 858/858 |

- **Cross-workspace:** 450 mixed W1/W2 ids requested for W1 → 3 requests; 0 foreign or deleted ids returned.
- **Fail closed:** making request 1, 2 or 3 return 503 makes `fetchLiveDocumentIds` throw `DocumentServiceError`, and `redactDeletedSources` then keeps **0/450** sources.
- **Repository tests:** `live-documents-batching` and `ai-session-privacy.integration` pass (they are included in 2.9).

### 2.7 Test-infrastructure guards (item 7)

**Command:** `defaults-probe.ts` (children only import the helpers; nothing connects) and `guard-parse.ts` (parse-only).

- **Dead-port defaults.** With no `REDIS_URL`/`MONGO_URI` set, importing `test-env.ts` sets `redis://127.0.0.1:6399` and `mongodb://127.0.0.1:6598/rmtest_unused`. `spawn-service.ts` gives every child the same dead defaults, a temp cwd and a minimal environment.
- **Refused targets** (exit 1, `InfraTargetError` with the variable and rule only, URI or password never printed):
  - `REDIS_URL` …:6379
  - `MONGO_URI` …:27017
  - an omitted port
  - remote `10.1.2.3`
  - `0.0.0.0`
  - `TEST_MONGO_URI` on 27017
  - `mongodb+srv://`
  - credentials without `authSource`
  - `TEST_REDIS_URL` on 6379 with `CI=true`
- **Bypass (W6-R5-03).** `redis://127.0.0.1:06379`, `redis://[::1]:06379`, `mongodb://127.0.0.1:027017` and `mongodb://localhost:0027017/x` are **accepted** by `assertDisposableRedisUrl`/`assertDisposableMongoUri` and by `test-redis.ts`/`test-mongo.ts`. The drivers' own parsers, called without connecting, resolve them to **port 6379** (ioredis 6.0.0 `parseURL`) and **27017** (mongodb `parseOptions`). I never connected to those ports.

### 2.8 CI security (item 8)

Static review of `.github/workflows/ci.yml` and `scripts/ci/*`:

- **Permissions and triggers.** `permissions: contents: read` at the top level, with no job override. `persist-credentials: false` on all 5 checkouts. No `pull_request_target`, no `secrets.`, no `set -x`, no `continue-on-error`, no `|| true`/`|| :`. Untrusted context (`github.event.*`) is used only in the `concurrency` expression, never in a `run:` script.
- **Credentials.** Generated with `openssl rand -hex 32`. `::add-mask::` runs before any other use. The values are passed to `docker run` only as `-e VAR` and never appear as literals. They reach later steps only as the masked substring of `TEST_MONGO_URI`/`TEST_REDIS_URL` through `$GITHUB_ENV`. `wait-infra.cjs` prints labels and error names only.
- **Databases.** `-p 127.0.0.1:27018:27017` and `-p 127.0.0.1:6380:6379`. Mongo uses root auth; Redis uses `--requirepass` and `--protected-mode yes`. Readiness requires an authenticated ping and an anonymous refusal. The `MONGO_URI`/`REDIS_URL` job variables point at dead ports.
- **Artifacts.** Only `reports/` (unit/timing/compose TAP, lcov) and `npm-audit-full.json`, kept 14 days. `scan-reports.mjs` checks for the generated passwords and any `scheme://user:pass@`, and prints file and rule names only. **However, both report uploads use `if: ${{ always() }}`, so they also run when the scan fails** → W6-R5-04.
- **Compose job.** `TMPDIR: ${{ runner.temp }}`, so the generated env file (mode 0600) stays outside the checkout.
- **Action SHA pins.** Verified with `git ls-remote https://github.com/actions/<name> refs/tags/<tag> refs/tags/<tag>^{}` against the public action repositories; no user data was sent. All three are lightweight tags pointing at the pinned commit:
  - `actions/checkout` v4.4.0 → `11d5960a326750d5838078e36cf38b85af677262` ✔
  - `actions/setup-node` v4.4.0 → `49933ea5288caeca8642d1e84afbd3f7d6820020` ✔
  - `actions/upload-artifact` v4.6.2 → `ea165f8d65b6e75b540449e92b4886f43607fa02` ✔

  Every `uses:` line is pinned to a 40-hex SHA.
- **Images.** `mongo:7.0`, `redis:7.4`, `mongo-express:1.0.2`. These are tags, not digests (recorded residual).
- **`docker-compose.yml`.** The only Wave 6 change is `mongo:7` → `mongo:7.0` and `redis:7` → `redis:7.4`. The SEC-001/SEC-014 hardening is intact:
  - `127.0.0.1:` port bindings
  - every credential required with `${VAR:?…}`
  - per-service users through the read-only provisioning mount
  - `--requirepass` and `--protected-mode yes`
  - mongo-express only in `docker-compose.tools.yml`, which is unchanged

  Effect on the user's containers (read-only `docker image inspect`): the running `researchmind-mongodb`/`researchmind-redis` use `mongo:7` (7.0.35) and `redis:7` (7.4.9) and are untouched; the new tags resolve to 7.0.48 and 7.4.12. Nothing changes until the user runs `docker compose up` for the project. That run will recreate both containers: patch upgrades, same named volumes, so data is kept. It will also apply the Wave 1-5 hardening, which needs the root `.env` variables or compose refuses to start, plus Redis `requirepass`, which means every service's `REDIS_URL` must carry the password. `researchmind-mongo-express` will be reported as an orphan unless it is removed. I did not touch any `researchmind-*` container.

### 2.9 Waves 1 to 5 controls not weakened (item 9)

- **No test removed or skipped.** All test files from the pre-Wave-6 hash baseline still exist. I compared every `# Subtest:` name in the Wave 5 review run (`stab/review5-npmtest.log`, 783 names) with the Wave 6 final run (983 names). Exactly one Wave 5 name is missing: the CSP `vite preview` test was renamed from "(port 5932)" to "(ephemeral port)", with the same assertion (W6-TEST-11). The only `# SKIP` in the final run is the opt-in compose-runtime suite. `grep` finds no new `.skip(`/`.todo(`; the conditional skips are the existing infrastructure gates.
- **Diff of the newly modified tracked tests.** `tests/document-extraction-errors.test.ts` gained only the `test-env` import. In `required-secrets-boot.test.ts` I spot-checked the assertions: exit 1, the variable named, no value printed. They are unchanged, and there are 2 new task-service tests.
- **Security-relevant test files run by me:** `npx tsx --test --test-reporter=spec` over 32 files (`log-redaction, provider-error-redaction, error-middleware, gateway-config-refusal, gateway-header-strip, gateway-cors, gateway-path-guard, registration-bounds, client-validation-parity, token-lifetimes, access-token-lifetime, jwt-hardening, auth-flow, required-secrets-boot, internal-auth, pdf-extraction-sandbox, document-extraction-errors, infra-guard, live-documents-batching, ai-session-privacy.integration, ci-config, security-headers, workspace-isolation, workspace-membership, request-body-guards, upload-and-model-validation, document-url-guard, rag-context-isolation, compose-security, repo-hygiene, login-throttle.integration, refresh-rotation.integration`) → **exit 0; tests 354, suites 76, pass 354, fail 0, cancelled 0, skipped 0, todo 0**, 85.6 s (`stab/w6r5/sec-tests.log`). Plus `pdf-extraction-limits.timing.ts` 4/4 (2.5).
- **Not run by me:** the Redis-backed `gateway-rate-limit.timing.ts`/`gateway-trust-proxy.timing.ts`. Their database indices (base+0 and base+2) would leave the Redis database assigned to me. They are unchanged Wave 4 controls, and the CI reviewer runs the full suite.

### 2.10 Secrets hygiene (item 10)

I grepped the new and changed docs (`docs/wave-6/*`, testing, onboarding, README, environment-variables, security, docker-process, roadmap), `scripts/ci`, `.github`, the new tests and helpers, and `.env.example`:

- **64-hex strings:** only lockfile/roadmap sha256 values and the three action SHAs.
- **Provider key shapes:** only obvious fixtures in tests and the security review (`gsk_abcdefghijklmnop`, `sk-live-ABCDEFGHIJKL1234`, `sk-proj-ABCDEFGHIJKLMNOP`).
- **Credentialed URIs:** only fixtures and placeholders (`S3cretPw`, `pw-SECRET-123`, `R3disPassw0rd`, `$MPW`, and the documented fake `3f9c0a2b7d`).
- **Implementer logs** (`stab/w6-*.log`): credentialed URIs appear only masked (`***`) or as fixtures, and there are no 64-hex values except the roadmap hashes.
- **Personal data:** no user name, user path or e-mail in the evidence.

**Result: no real secret or private content found.**

---

## 3. Findings

### W6-R5-01: PDF sandbox does not bound decoded-stream memory (Medium)

- **Where:**
  - `services/document-service/src/utils/extraction-sandbox.ts:87` (the only memory control is `--max-old-space-size`)
  - `services/document-service/src/utils/pdf-extractor.ts:35` (`PDF_EXTRACTION_HEAP_MB = 512`)
  - `docs/architecture/security.md:167` ("a 512 MB heap limit") and `:297`
  - `docs/wave-6/w6-evidence.md:437` (residual stated as CPU and time only)
- **Evidence:** section 2.5. V8's old-space limit does not cover ArrayBuffer backing stores, and pdf.js keeps a decoded stream in a growing `Uint8Array`. A 204,501-byte PDF needed about 400 MB of child memory and was **accepted** in 6.9 s with the production settings. A 10 MB upload, the multer limit, can carry roughly 10 GB of decoded stream, and two children run at once. Only the 30 s SIGKILL limits the growth, so an authenticated workspace member can push the host or container toward OOM. Wave 6 is still a large improvement over the in-process parse of Wave 5, so this is a residual, not a regression. Calling SEC-002-PDF fully fixed with a "512 MB memory cap" is inaccurate.
- **Correction required:** bound the decoded size before or while parsing. Either of these is acceptable:
  - (a) A parent-side precheck, like `zip-precheck.ts` for DOCX: walk the PDF's `stream … endstream` objects and inflate each `/FlateDecode` stream with `zlib.inflateSync(data, { maxOutputLength })`, rejecting with 422 "too large or too complex" when the total decoded bytes exceed a limit (for example 64 MB). Add a test with the 200 MB-of-spaces fixture expecting 422.
  - (b) A child-side watchdog: an interval that exits the child, mapped to the 422 "too complex", when `process.memoryUsage().rss` or `.arrayBuffers` exceeds a limit. Add the same test.

  In both cases also add a container memory limit to the deployment documentation as defence in depth. Until then, `security.md:167/297` and `w6-evidence.md` section 19 must state the residual accurately: "heap limit does not bound decoded PDF stream memory; bounded only by the 30 s wall clock".

### W6-R5-02: stack frames carry unredacted continuation lines of multi-line messages (Low)

- **Where:** `packages/shared/errors/error.middleware.ts:55-56` (`framesOf` = `stack.split("\n").slice(1, 9)`), used at `:60` (AppError ≥ 500, new in Wave 6) and `:114` (catch-all).
- **Evidence:** section 2.1. A V8 stack begins with `Name: <full message>`, so the lines after the first message line are not frames: they are the rest of the message, unredacted and unbounded. `AppError("Provider error\nmongodb://svc:<S>@db…", 503)` logged the password in clear. The redacted first line confirms the redaction itself works.
- **Correction required:** in `framesOf`, keep only real frames, for example `error.stack.split("\n").filter((l) => /^\s+at /.test(l)).slice(0, 8)`, and cap each line, for example `.map((l) => l.slice(0, 300))`. Add a `log-redaction` test with a multi-line message carrying a credentialed URI on its second line, for both branches.

### W6-R5-03: leading-zero ports bypass the disposable-infrastructure guard (Low)

- **Where:** `tests/helpers/infra-guard.ts:66` (`port === "" || port === defaultPort` is a string comparison) and `:69`.
- **Evidence:** section 2.7. `redis://127.0.0.1:06379`, `redis://[::1]:06379` and `mongodb://127.0.0.1:027017` pass the guard, but ioredis and the MongoDB driver parse them to 6379 and 27017, the developer's real servers that A-4 protects. This is a guard against mistakes, not an attacker control, hence Low.
- **Correction required:** compare numerically and reject non-canonical ports. After the `/^\d+$/` check, refuse `port.length > 1 && port.startsWith("0")` and any `Number(port) > 65535`, then compare `Number(port) === Number(defaultPort)`. Add these cases to `tests/infra-guard.test.ts`: `06379`, `0006379`, `027017`, `[::1]:06379`, `65915`.

### W6-R5-04: CI uploads reports even when the credential scan fails (Low)

- **Where:** `.github/workflows/ci.yml:186-187` ("Upload test reports", `if: ${{ always() }}`) and `:257` ("Upload compose reports", `if: ${{ always() }}`), after the scans at `:175` and `:253`.
- **Evidence:** A-16 requires artifacts to be scanned for credentials, but a failing `scan-reports.mjs` does not stop the upload, so a report containing a generated password would still be published as an artifact. The exposure is low (per-run passwords of loopback-only containers destroyed at job end), but the control does not do what it claims.
- **Correction required:** give each scan step an `id` (`scan-unit`, `scan-compose`). Change each upload to `if: ${{ always() && steps.<id>.outcome == 'success' }}`, or make the scan step delete or quarantine the offending files before failing. Extend `tests/ci-config.test.ts` to assert that every `upload-artifact` step depends on a successful scan.

### W6-R5-05: redaction pattern gaps (Low, partly an accepted residual)

- **Where:** `packages/shared/errors/safe-error.ts:20` (the key rule needs the separator immediately after the key name), `:44-47` (`name`, `status` and `code` are neither redacted nor bounded).
- **Evidence:** section 2.1:
  - `{"apiKey":"<S>"}`, `{"password":"<S>"}` and `"secret": "<S>"` are left intact.
  - A bare JWT without `Bearer` is left intact.
  - A secret in `err.code` or `err.name` is printed.
  - The output reached 10,009 characters with a 5,000-character name and code.
- **Correction required:**
  - Extend the key rule to accept an optional closing quote before the separator and an optional opening quote after it: `(api[_-]?key|apikey|access[_-]?key|secret|password|token)["']?\s*[=:]?\s*["']?[^\s,;"'}]+`.
  - Add a JWT-shape rule: `\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*` → `<redacted-jwt>`.
  - Pass `name`, `code` and `status` through `redactSecrets` and cap each at 100 characters.
  - Add the cases to `log-redaction.test.ts`.

  The remaining pattern-based limits (RT-007) stay a recorded residual.

### W6-R5-06: bcrypt 72-byte truncation behind the new 128-character password limit (Info)

- **Where:** `packages/validation/schemas/auth.schema.ts:12` (`MAX_PASSWORD_LENGTH = 128`); `services/auth-service/src/utils/hash.ts` (bcryptjs).
- **Evidence:** for a stored 300-character password, a login with that password plus one extra character returned **200**, because bcrypt reads only the first 72 bytes. This is pre-existing behaviour, and the schema comment acknowledges it. Wave 6 allows 73 to 128 characters at registration, which users may believe count in full.
- **Action (recommended, not required for Wave 6):** document the effective 72-byte limit in `security.md`, or cap registration at 72 UTF-8 bytes. Pre-hashing would need a migration and is out of scope.

### W6-R5-07: user's existing containers and the compose image change (Info)

- **Where:** `docker-compose.yml:26`, `:69`.
- **Evidence and effect:** section 2.8. No risk is introduced. The next `docker compose up` recreates both containers with patch-level upgrades on the same volumes and enforces the Wave 1-5 hardening. It also leaves `researchmind-mongo-express` as an orphan.
- **Action:** make sure the user procedure in `w6-evidence.md` section 21 item 8 says "back up first, populate the root `.env`, add the Redis password to every `REDIS_URL`, remove the orphaned mongo-express (`docker rm`) or use `--remove-orphans`". Item 8 mostly says this already; the orphan note is missing.

---

## 4. Residual risks (after the corrections above)

- **Image pins.** `mongo:7.0`, `redis:7.4` and `mongo-express:1.0.2` are tags, not digests. There is no Dependabot (a user decision, A-21).
- **CI has not run on GitHub.** Masking, Linux signal behaviour for the SIGKILL timeout, and the runner's Docker behaviour are verified only statically.
- **Pattern-based redaction (RT-007).** Unknown secret formats can still reach a log line.
- **Document-service internal guard (W6-SEC-08, Info, D-3).** It checks only that `INTERNAL_SERVICE_TOKEN` is non-empty per request, not `requireSecret` quality. This is mitigated because document-service refuses to boot without a valid token.
- **SEC-007.** No access-token denylist; the lifetime is now bounded at 15 minutes and defaults to 5.
- **Unchanged accepted residuals.** SEC-019, SEC-009, SEC-008, SEC-011, SEC-022 and ARC-010 are unchanged and accepted.
- **Host-level user actions are not performed.** SEC-001 and SEC-014 still apply to the running `researchmind-*` containers on `0.0.0.0` without per-service users; credential rotation is also outstanding.

---

## 5. Cleanup

- **MongoDB.** The disposable MongoDB 27095 databases were `admin,config,local` before and after my runs. `rmw6r5_internal` and `rmw6r5_auth` were created and dropped; the test helpers' `rmtest_*` databases were dropped by the tests.
- **Redis.** The disposable Redis 6395 database 4 had 0 keys before and after; I used no other database.
- **Processes and ports.** No listener remains on 5950 to 5959 (`Get-NetTCPConnection`), and no extraction child pid is live.
- **Temporary files.** No `rm-spawn-*` or new `rm-*` temp folders remain. The probe temp folders `stab/w6r5/pdftmp-*` and `gatetmp-*` were removed; the `gate-probe` run left one when its script ended early, and I deleted it. A `/tmp/now.txt` written by mistake during the hash check was deleted.
- **Containers.** `rm-stab-mongo`, `rm-stab-redis` and the `researchmind-*` containers were left as they were, never contacted (`researchmind-*`), stopped or modified.
- **Files kept.** The probe scripts and their outputs in `stab/w6r5/` contain no secret. They use fake markers, and the per-run random keys were never printed.
- **Repository.** The only file I wrote in the repository is this one.

---

## Re-review of the Stage E corrections (2026-11-24)

- **Scope:** the "Stage E corrections" section of `w6-evidence.md`, checked against the code itself. The repository files changed since my first review are listed by mtime newer than 2026-11-15 22:36, with `node_modules`, `dist` and `.git` excluded:
  - code: `packages/shared/errors/{safe-error.ts, error.middleware.ts}`, `services/document-service/src/utils/pdf-extractor.ts`, `scripts/ci/check-tap.mjs`, `.github/workflows/ci.yml`
  - tests: `tests/helpers/{infra-guard.ts, pdf-fixtures.ts}`, `tests/{log-redaction, infra-guard, ci-config, compose-security.runtime}.test.ts`, `tests/pdf-extraction-limits.timing.ts`
  - docs: `security.md`, `docker-process.md`, `testing.md`, `onboarding.md`, `ResearchMind_readme.md`, roadmap, `w6-evidence.md`
- **Repository state:** HEAD `8b4a304`. `git status --short --untracked-files=all` lists 301 entries (the 299 from the first review plus the two independent verdict files).
- **Environment:** after the Docker Desktop restart, `rm-stab-mongo` (127.0.0.1:27095) and `rm-stab-redis` (127.0.0.1:6395) were up and empty. The user's `researchmind-*` containers were running and were not contacted.
- **Scratch folder:** the restart had wiped `stab/` (`w6-rules.md`, `impl-log.md` and my first-round probes were gone), so I recreated the probes as `stab/w6r5/rr-*.ts`. I followed the same rules as the first review: fixed env prefix (`REDIS_URL=redis://127.0.0.1:6599`, `MONGO_URI=mongodb://127.0.0.1:6598/rmw6r5_unused`, `TEST_MONGO_URI=mongodb://127.0.0.1:27095`, `TEST_REDIS_URL=redis://127.0.0.1:6395/4`), the scratch folder as working directory for in-process imports, ports 5950 to 5959 only, no git write, no `.env`, no live provider.
- **Load:** the host had about 1.1 GB of free memory and the CI reviewer was running at the same time, so I kept every probe at or below about 370 MB of child RSS. I ran long commands in the background with timeouts.

### R.1 Status of W6-R5-01 to W6-R5-07

| ID | Claimed correction | Re-review command and actual result | Status |
|---|---|---|---|
| W6-R5-01 (Medium) | `pdf-extractor.ts` child: every ArrayBuffer/typed-array constructor refuses one allocation > 128 MiB; a 25 ms watchdog stops the child at ArrayBuffers > 384 MiB or RSS > 1,280 MiB → 422; docs corrected | `rr-pdf-probe.ts`, see R.2. My original 204,501-byte → 200 MB bomb now gets **422 in 2.7 s** (child peak 192 MiB ArrayBuffers / 267 MiB RSS; parent event-loop lag ≤ 25 ms; first review: accepted after 6.9 s). Legitimate 3- and 40-page PDFs give **byte-identical** text to an in-process pdf-parse run (2,656 / 71,949 characters; child peak ≤ 0.2 MiB ArrayBuffers). Text cap 413, garbage 422, operator bomb 422 by the time limit, 0 live children. `tests/pdf-extraction-limits.timing.ts`: **exit 0, 7/7**, including the 1 GiB stream, the `[/ASCIIHexDecode /FlateDecode]` chain, and "/health answering, nothing stored, no temp file" through the real upload route. `security.md:297` now states the ArrayBuffer residual and the new bounds. | **Corrected.** A bounded overshoot remains: W6-R5-09 (Low) |
| W6-R5-02 (Low) | `framesOf` keeps only `/^\s+at /` lines (≤ 8, ≤ 300 characters); the message is joined onto one line | `rr-log-probe.ts`, real `errorMiddleware` on 127.0.0.1:5950. My first-round cases (credentialed URI on line 2, AppError 503 and catch-all) are now redacted: `AppError status=503: Provider error mongodb://<redacted>@db.internal:27017/app retry`, 9 lines, longest 164 characters. A forged 5,000-character frame is cut to 300. | **Corrected** for the reported case. Bypass with message lines that look like frames: W6-R5-10 (Low) |
| W6-R5-03 (Low) | strict numeric ports, leading zeros refused, 1–65535 | `rr-guard-probe.ts` (parse only, no connection). Refused with "canonical form": `06379`, `0006379`, `[::1]:06379`, `LOCALHOST:06379`, `027017`, `0027017`, and the multi-host `27095,127.0.0.1:027017`. Refused as invalid: `:0`, `:+6379`, `:6379.0`, `:%36379`, `65536`, `65915`. Still refused: 6379, 27017, `10.1.2.3`, `mongodb+srv`. Accepted: `:6395/4`, `:27095`. Dead-port defaults unchanged. | **Corrected** |
| W6-R5-04 (Low) | scan steps get ids; uploads run only after a successful scan | `ci.yml` 207-208 / 279-280 / 325-326: `if: ${{ always() && steps.scan-unit/scan-compose/scan-audit.outcome == 'success' }}`. The scan steps `scan-unit`, `scan-compose` and the new `scan-audit` are `!cancelled()`. Re-check: `permissions: contents: read`; 5× `persist-credentials: false`; no `pull_request_target`, `secrets.`, `set -x` or `continue-on-error`; all 13 `uses:` pinned to the same three verified SHAs; masked `openssl rand` credentials; databases on `127.0.0.1:27018/6380`. The new lock-drift step uses `npm install --package-lock-only --ignore-scripts`. `check-tap.mjs` now rejects non-integer floors. | **Corrected**, no regression |
| W6-R5-05 (Low) | quoted key/value pairs, bare JWTs, `name`/`code`/`status` redacted and capped at 100 characters | `rr-log-probe.ts`: all 16 first-round shapes stay redacted. Now also redacted: `{"apiKey":"…"}`, `{"password":"…"}`, `"secret": "…"`, `'token': '…'`, `{"api_key" : "…"}`, `{"accessKey":"…"}`, `{"client_secret":"…"}`, `{"x-internal-token":"…"}`, and bare or `jwt=` JWTs. `name`/`code`/`status` with keyword secrets and 5,000-character padding give a 70-character output. Not covered (pattern residual, RT-007): `{"authorization":"<bare value>"}`, `{"auth":…}`, `{"credentials":…}`, and a bare secret in `code` without a keyword. `logLlmFailure` with a multi-line provider error gives 1 line, redacted. | **Corrected** for the reported shapes. New performance regression: W6-R5-08 (Low) |
| W6-R5-06 (Info) | bcrypt 72-byte behaviour documented | `security.md:298` states it as an accepted residual | **Done** |
| W6-R5-07 (Info) | user procedure for the next `docker compose up`, including the orphan | `docker-process.md:62`, roadmap 30.1 item 7, `w6-evidence.md` section 21 item 8 | **Done** |

**Tests I ran:** `npx tsx --test` over `log-redaction, error-middleware, provider-error-redaction, infra-guard, ci-config, pdf-extraction-sandbox, document-extraction-errors, gateway-header-strip, gateway-config-refusal, token-lifetimes, registration-bounds, internal-auth` → **exit 0, 210/210, 0 skipped** (`stab/w6r5/rr-sec-tests.log`). Plus `pdf-extraction-limits.timing.ts` 7/7.

**Other checks:**

- **Files touched by Stage E.** The new `compose-security.runtime` LAN check fails under `CI` and is otherwise a counted skip (stricter than before). `pdf-fixtures.ts` is a test helper. I found no weakened assertion in the touched tests.
- **Secrets hygiene.** A scan of the Stage E docs, tests and CI files found only placeholders and fixtures. The tests reuse my fake marker `Qx7Hv92Lmn4K`.

### R.2 Attacks on the W6-R5-01 correction

- **Allocators outside the guard.** In pdf-parse's bundled pdf.js (`pdf.worker.mjs`, `index.cjs`) I found 0 `Buffer.alloc`/`Buffer.from`, 0 `SharedArrayBuffer`, 0 `Float16Array`. `DataView` and `BigInt64Array` only wrap existing buffers (WebAssembly memory views). The only `new Worker(` is the browser path, so in Node the guard and pdf.js share one realm.
  - The `bytesRequested` check covers numeric and array-like arguments.
  - Views over an existing buffer cost 0 and are bounded by that buffer.
  - `slice` and `species` copies cannot exceed their source.
  - Strings live on the V8 heap, so the 512 MB `--max-old-space-size` applies to them.
  - WebAssembly `Memory.grow` would bypass the constructor check. Text extraction does not run the image decoders (JPX/JBIG2), so this is only reachable through the sampled watchdog (Info).
- **One stream through a filter chain** (`[/FlateDecode /ASCII85Decode]`, 191,613 bytes, decodes to about 125 + 100 MiB). Every stage buffer stays ≤ 128 MiB, so it was **accepted** with a child peak of 320 MiB ArrayBuffers / 366 MiB RSS. That is within the documented 384 MiB bound and therefore acceptable.
- **Many allocations just under the cap: W6-R5-09.** I ran the real `CHILD_SOURCE`, extracted from `pdf-extractor.ts`, through `runSandboxedChild` with every limit scaled 1/8 (cap 16 MiB, watchdog 48 MiB), so the test stays light on this host. Each ASCII85 stage keeps its full decoded buffer, every buffer stays under the per-allocation cap, and pdf.js decodes and lexes the chain synchronously, so the 25 ms `setInterval` watchdog cannot run until the work is done:

| Chain | File | Result | Peak ArrayBuffers vs. watchdog |
|---|---|---|---|
| Flate only | 16 KB | ok | 24 MiB (0.50×) |
| Flate + 3× ASCII85 | 56 KB | 422 | 80 MiB (**1.67×**) |
| Flate + 6× ASCII85 | 124 KB | 422 | 108 MiB (**2.26×**) |

At production scale that is roughly 0.85 GiB per child before the 422, and two children can run at once. Every case still ends in 422 and memory stays finite: deflate's 32 KB window limits how many compressible stages fit in a 10 MB upload. This is far below the roughly 10 GB of the first review, so it is Low. I did not run the chain at production scale, because the host had too little free memory.

### R.3 New findings

#### W6-R5-08: redaction regexes take quadratic time on crafted input (Low)

- **Where:** `packages/shared/errors/safe-error.ts:18` (URI rule `\b([a-z][a-z0-9+.-]*:\/\/)…`, Wave 6 A-1, first delivery; I missed it in the first review) and `:20` (bare-JWT rule `\beyJ[A-Za-z0-9_-]{5,}\.…`, Stage E). Both run on the whole message before `describeErrorForLog` cuts it to 300 characters.
- **Evidence** (`rr-log-probe.ts`; the host was loaded, so absolute times vary):

| Input | Size | `redactSecrets` | `describeErrorForLog` |
|---|---|---|---|
| `"eyJaaaaa-"` repeated | 40 KB | 445 ms | 427 ms |
| `"eyJaaaaa-"` repeated | 100 KB | 28 s | 56 s |
| `"ab-"` repeated | 40 KB | 7.1 s | 5.5 s |
| `"ab-"` repeated | 100 KB | 41 s | 21 s |
| plain text | 100 KB | 3 ms | 3 ms |

  On a quiet run, isolating the rules on 40 KB took 317 ms for the JWT rule and 600 ms for the URI rule; every other rule took about 0 ms. The work is synchronous on the service's request thread: the error middleware, `logLlmFailure` and the worker logs all call it. It only matters if an attacker can put tens of KB of chosen text into a logged 5xx or provider error message. I found no direct path for that (for example, AI session saves have no `maxlength` that would echo values), hence Low.
- **Correction required:**
  - (1) In `redactSecrets`, bound the input before applying the rules, for example `text.slice(0, 4096)`. `describeErrorForLog` outputs at most 300 characters, so nothing useful is lost.
  - (2) Also make both rules linear: `\b([a-z][a-z0-9+.-]{0,31}:\/\/)` and JWT segments `{5,4096}`.
  - (3) Add a test: a 100 KB `"eyJaaaaa-"` and a 100 KB `"ab-"` message are each described in under 50 ms.

#### W6-R5-09: the PDF ArrayBuffer/RSS watchdog is sampled, not enforced (Low)

- **Where:** `services/document-service/src/utils/pdf-extractor.ts`, `CHILD_SOURCE` (`setInterval(…, 25)` watchdog). `security.md:297` and `w6-evidence.md` (Stage E row W6-R5-01) present 384 MiB / 1,280 MiB as a bound.
- **Evidence:** section R.2. A chain of stages that each stay under the cap reached 2.26× the watchdog limit (scaled) before the 422. The watchdog cannot run while pdf.js decodes synchronously.
- **Correction required:** keep the watchdog, but also enforce a hard cumulative budget inside the `construct` trap. Add every allocation's `bytesRequested` to a running total, and refuse (set `limitHit`, throw `RangeError`) once the total exceeds, for example, 512 MiB per extraction. Legitimate documents allocate well under 1 MiB in total (measured peak 0.2 MiB for 40 pages). Add a test with the Flate + 6× ASCII85 chain at production scale expecting 422 with a peak under the budget, or record the overshoot accurately in `security.md` as a residual: "the 384 MiB / 1,280 MiB limits are sampled every 25 ms; a filter chain can exceed them by about 2× before the 422".

#### W6-R5-10: message lines that look like stack frames reach the log unredacted (Low)

- **Where:** `packages/shared/errors/error.middleware.ts:58-64` (`framesOf`). The frame lines are filtered by shape but never passed through `redactSecrets`.
- **Evidence** (`rr-log-probe.ts`, real middleware). Line 1 is redacted in every case below, but the frame line repeats the secret in clear:

| Thrown error | Status | Frame line logged |
|---|---|---|
| `AppError("Provider error\n    at mongodb://svc:<S>@db…\n    at token=<S>", 503)` | 503 | `    at mongodb://svc:<<SECRET>>@db.internal…`, `    at token=<<SECRET>>` |
| `Error("wrapped: inner\n    at Object.connect (redis://:<S>@cache:6379)")` | 500 | `    at Object.connect (redis://:<<SECRET>>@cache:6379)` |
| `AppError("x\r\n    at <S>", 500)` | 500 | the same |

  Error messages that embed an inner error's stack ("wrapped" errors) are a realistic way to hit this.
- **Correction required:** in `framesOf`, map each kept line through redaction before the length cap: `.map((line) => redactSecrets(line).slice(0, 300))`. Add the three cases above to `log-redaction.test.ts` for both branches.

### R.4 Re-review verdict

**PASS WITH CORRECTIONS.**

- W6-R5-01 to W6-R5-07 are corrected, and I found no regression of a Wave 1 to 6 control in the files Stage E touched.
- The three new findings W6-R5-08 to W6-R5-10 are all Low and local, and need no authentication change. Each is about one line of code plus a test.
- Once they are corrected, or W6-R5-09 is recorded accurately as a residual, I have no remaining security objection to Wave 6.

### R.5 Re-review cleanup

- **Infrastructure.** Disposable MongoDB 27095: `admin,config,local` before and after. Redis 6395 database 4: 0 keys. I created no database: the probes were parse-only or in-process, and the timing test dropped its own `rmtest_*` database.
- **Processes and temporary files.** 0 listeners on 5950 to 5959. 0 live extraction children. No `rm-*` temp folders from the last hour. The probe temp folder `stab/w6r5/rrpdf-*` was removed.
- **Files kept.** `stab/w6r5/rr-*.ts`, `*.out`, `*.log` and `infra-state.cjs` contain only fake markers.
- **Untouched.** The `researchmind-*` containers were never contacted. No git write, no `.env` read. The only repository file I changed is this one: the top-line verdict paragraph and this appended section.

---

## Final recheck (round 2), 2026-11-24

- **Scope:** the "Stage E round 2 corrections" section of `w6-evidence.md`, checked against the code. Files changed after my re-review (mtime newer than this file's previous version):
  - code: `packages/shared/errors/{safe-error.ts, error.middleware.ts}`, `services/document-service/src/utils/pdf-extractor.ts`, `.github/workflows/ci.yml`
  - tests: `tests/{log-redaction.test.ts, ci-config.test.ts, pdf-extraction-limits.timing.ts}`, `tests/helpers/pdf-fixtures.ts`
  - docs: `security.md`, `testing.md`, `ResearchMind_readme.md`, the roadmap, `w6-evidence.md`, `independent-ci-verdict.md`
- **Repository state:** HEAD `8b4a304`, 301 status entries (unchanged).
- **Rules:** `stab/w6-rules.md` (recreated). Same fixed environment prefix as before (`REDIS_URL=redis://127.0.0.1:6599`, `MONGO_URI=mongodb://127.0.0.1:6598/rmw6r5_unused`, `TEST_MONGO_URI=mongodb://127.0.0.1:27095`, `TEST_REDIS_URL=redis://127.0.0.1:6395/4`), port 5950 only.
- **Load:** the host had about 0.7 to 1 GB free and the CI reviewer was running concurrently, so every PDF child in my probes stayed at or below 270 MiB RSS.

### F.1 W6-R5-08: redaction cost (corrected)

`redactSecrets` now cuts its input to `MAX_REDACTION_INPUT` = 4096 characters at the last ASCII whitespace before any rule runs. When there is no such whitespace it drops everything. The URI, JWT and query quantifiers are now bounded (`{0,31}`, `{0,512}`, `{5,1024}`, `{1,2048}`).

**Timing** (`stab/w6r5/rr2-log-probe.ts`, median of 3; round 1 values in brackets):

| Input | Size | Time |
|---|---|---|
| `eyJaaaaa-` repeated | 100 KB | 0.1 ms [28–56 s] |
| `ab-` repeated | 100 KB | < 0.1 ms [21–41 s] |
| `a://`, `http://b…` or `sk-a` repeated | 100 KB | < 0.1 ms each |
| `eyJaaaaa-` (just under the cut) | 3,996 chars | 1.8–2.2 ms |
| `token` + 4,000 spaces + `,` (worst residual backtracking inside the cut) | 4,006 chars | 13.7–17.3 ms |
| `ab-` with a space every 4,000 characters | 100 KB | 0.3 ms |

**Secrets at or across the cut.** None leaked in any case below:

- `token=<S>`, `mongodb://svc:<S>@…` and `password: <S>` starting at offsets 4066, 4084, 4091, 4095, 4096, 4097 and 4101. The token at the cut is dropped whole or redacted.
- Whitespace-free input with a credentialed URI first gives an empty output.
- A token at offset 4000 in a whitespace-free 6 KB string gives an empty output.
- Input separated only by `\u00a0` or `\u2028` gives an empty output.
- `Bearer <S>` split by the cut: the token is dropped and the output ends with `Bearer`.

**Info:** a replacement longer than the secret can make the output a few characters longer than 4096 (observed 4,105). Every caller cuts again to 300 or 100 characters, so this has no effect.

### F.2 W6-R5-10: fake frame lines (corrected)

`framesOf` now passes every kept frame line through `redactSecrets` before the 300-character cap. I tested both branches through the real `errorMiddleware` on 127.0.0.1:5950. **The log contained no secret in any case**:

- AppError 503 with `\n    at mongodb://svc:<S>@…` and `\n    at token=<S>`
- catch-all `wrapped: inner\n    at Object.connect (redis://:<S>@cache:6379)`
- CRLF AppError 500: `\r\n    at api_key=<S>\r\n    at rediss://default:<S>@c:6380`
- CRLF catch-all: `\r\n    at Bearer <S>\r\n    at {"password":"<S>"}`
- a 5,000-character forged frame followed by a credentialed URI
- a frame padded past 300 characters
- a Mongo outage whose message carries a second credentialed line

In each case the message line and every frame line show `<redacted>` (`mongodb://<redacted>@…`, `token=<redacted>`, `Bearer <redacted>`, `{"password=<redacted>"}`). Lines are capped at 300 characters, at most 9 lines are written, and the outage branch is a single line.

### F.3 W6-R5-09: PDF allocation budget (corrected; residual accurately documented)

The child's constructor trap now keeps a synchronous running total of allocations of 1 MiB or more and refuses (422) past `PDF_MAX_TOTAL_LARGE_ALLOCATION_BYTES` = 512 MiB. This is in addition to the 128 MiB per-allocation cap and the sampled watchdog. The production call (`document.service.ts:99`) passes no options, so the production constants apply. The new options exist only for tests.

I ran my round-1 filter chain through the real `extractPdfText` with scaled options (cap 16 MiB, budget 64 MiB, watchdog 48 MiB; the 1 MiB threshold is fixed):

| Chain | Result | Peak ArrayBuffers vs. budget | vs. watchdog | Round 1 |
|---|---|---|---|---|
| Flate only | accepted | 24 MiB | — | — |
| Flate + 3× ASCII85 | **422** | 44.1 MiB (0.69×) | 0.92× | 1.67× the watchdog |
| Flate + 6× ASCII85 | **422** | 42.3 MiB (0.66×) | 0.88× | 2.26× the watchdog |

**Buffers under 1 MiB, which the budget does not count:**

| Case | Result | Peak ArrayBuffers |
|---|---|---|
| 150 pages × 400 KiB decoded | accepted | 22.2 MiB |
| 400 pages × 400 KiB decoded | accepted | 3.6 MiB (earlier pages are garbage-collected) |
| Flate + 6× ASCII85 with every stage < 512 KiB | accepted | 3.8 MiB |
| one page whose `/Contents` array repeats a 400 KiB stream 150 times | 422 (the combined buffer is counted) | 30.5 MiB |

I found no way to hold many sub-1 MiB buffers at once. The `security.md:297` residual ("allocations under 1 MiB are bounded only by the sampled watchdog (it can overshoot between two samples)") is therefore accurate, and I record it as Info.

**Production limits:**
- My original 204 KB → 200 MB bomb gets 422 in 2.4 s (peak 192 MiB ArrayBuffers / 268 MiB RSS).
- Legitimate 3- and 40-page PDFs still give byte-identical text to an in-process pdf-parse run (2,656 / 71,949 characters; peak ≤ 0.2 MiB).
- No extraction child was left running.

**Tests:**
- `npx tsx --test` on `log-redaction, error-middleware, provider-error-redaction, pdf-extraction-sandbox, document-extraction-errors, ci-config, infra-guard` → **exit 0, 156/156, 0 skipped**.
- `npx tsx --test --test-concurrency=1 tests/pdf-extraction-limits.timing.ts` → **exit 0, 9/9**, including the new W6-R5-09 chain test, the production-default budget test, and "/health answering, nothing stored, no temp file" through the real upload route.

### F.4 Regression and hygiene checks

- **CI:** `ci.yml` still has `permissions: contents: read`, 5× `persist-credentials: false`, and all 13 `uses:` pinned to the three verified SHAs. It has no `pull_request_target`, `secrets.`, `set -x` or `continue-on-error`. All three uploads still require a successful scan. The floors are raised to 794 / 57. The stricter `ci-config` test passes.
- **No regressions** in the touched files: the earlier W6-R5-01 to 07 behaviour holds (re-run above), and no test was weakened (the evidence logs only stricter edits).
- **Secrets hygiene:** a scan of the round-2 docs, tests and fixtures found only placeholders (`redis://:pw@` in `security.md:294`, `user:pass` templates) and fixtures. Fixtures include my fake marker; there are no 40-hex values other than the known SHAs, and no JWT or AWS key shapes.

### F.5 Final verdict

**PASS.** Every finding W6-R5-01 to W6-R5-10 is corrected and verified. These non-blocking residuals remain, documented in `security.md` and `w6-evidence.md`:

- pattern-based redaction (RT-007), including keys outside the list such as `"auth"` and `"credentials"`
- PDF buffers under 1 MiB, bounded only by the sampled watchdog
- one extraction slot for up to 30 s per crafted PDF
- bcrypt's 72-byte password limit
- image tags rather than digests
- CI not yet run on GitHub
- the user's host actions for SEC-001 and SEC-014

### F.6 Cleanup (round 2)

- **Infrastructure.** Disposable MongoDB 27095 has only `admin,config,local`. Redis 6395 database 4 has 0 keys.
- **Processes and temporary files.** 0 listeners on 5950 to 5959. 0 live extraction children. 0 `rm-*` temp folders from the last hour. `stab/w6r5/rr2pdf-*` was removed.
- **Files kept.** The probes and logs `stab/w6r5/rr2-*` contain only fake markers.
- **Untouched.** The `researchmind-*` containers were never contacted. No git write, no `.env` read. The only repository file I edited is this one: the top-line verdict and this section.
