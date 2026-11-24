# Wave 6 security and architecture review (Agent 1, read-only)

- **Date:** 2026-11-15
- **Scope:** working tree on `fix/wave-5-stabilization` (HEAD `8b4a304`; Waves 1 to 5 uncommitted)
- **Author:** Agent 1, Security and Architecture Auditor, Wave 6

**Rules kept**

- This file is the only file written.
- No git writes.
- No `.env` file was read.
- `researchmind-*` containers were not connected to or touched. Only `docker ps` and boolean `docker inspect` metadata checks were run against them; no value was printed.
- Probes used the disposable MongoDB `127.0.0.1:27095` (database `rmw6a1_auth`, dropped afterwards; 0 `rmw6a1*` databases left) and a dead Redis port, `redis://127.0.0.1:6399`. No keys were written to any Redis.
- Probes listened on ports 5960 to 5969 only. After the run, 0 listeners remained on 5960 to 5969.
- Provider keys were fake, and no provider was called.
- `npm test` was not run (Agent 2 owns it).

## 1. Summary

| Severity | Count | Items |
|---|---|---|
| High | 1 | SEC-001 (host; user action) |
| Medium | 3 | SEC-002-PDF residual, SEC-014 (real database; user), SEC-005 legacy assets (user migration) |
| Low | 13 | W6-SEC-01 to W6-SEC-07, W5-L1, W5-L3, SEC-022 residual, SEC-009 residual, SEC-007 residual, SEC-008 residual |
| Info | 7 | W6-SEC-08, W6-SEC-09, ARC-010 DEP0060, deferred dependency batch, SEC-019 `iss`/`aud`, SEC-011 residual, ARC-005 E2E |

**No Wave 1 to 5 security control has regressed.** Every live probe in section 2 behaved as specified. No new High or Medium code defect was found. The remaining High and Medium items fall into two groups:

- **Host or data items for the user:** SEC-001, SEC-014 and SEC-005-legacy.
- **One known in-process parsing residual:** PDF extraction (SEC-002-PDF).

The Wave 6 code items are all Low. They concern hardening and consistency:

- a clean startup error for TRUST_PROXY (and other configuration errors);
- redaction gaps in logging;
- stripping internal headers at the gateway;
- input bounds at registration;
- token-lifetime bounds;
- the CI token scope.

## 2. Live verification of Waves 0 to 5 (actual results)

All runs used Node 22.14.0 with the tsx loader from `D:\ReserchMind\node_modules`. The working directory was the session scratchpad, which has no `.env`. Each service's `app.ts` was imported in-process and served on explicit ports:

| Port | Process |
|---|---|
| 5961 | gateway |
| 5962 | upstream stub |
| 5963 | auth-service |
| 5964 | document-service |
| 5965 | task-service |
| 5966 | ai-service |

Secrets were random per run, with distinct access and refresh secrets. Exit code was 0.

| Area | Probe | Result |
|---|---|---|
| Path guard (SEC-003) | `POST /api/auth//login`, `POST /api/ai\query`, `/api/documents/%2e%2e/internal/...`, `/api/documents/x/../../internal/...`, `/api/documents/%2Finternal` | all **400** `Invalid request path`, upstream not hit |
| Internal surface not proxied | `POST /internal/documents/live`, `/api/authx/me`, `/API/DOCUMENTS/x` via gateway | **404** JSON, upstream not hit |
| Gateway JWT (SEC-019) | none / valid / refresh-secret-signed / HS512 / `alg:none` / object `userId` | 401 / **200 (forwarded)** / 401 / 401 / 401 / 401; the 401s never reached the upstream |
| Headers (SEC-017, SEC-008) | proxied response | `x-powered-by` absent, CSP present, HSTS present |
| CORS (SEC-015) | `Origin: http://evil.example` | no ACAO; preflight from `http://localhost:5173`: ACAO echoed, 204 |
| ISS-041, SEC-016 | `GET /nope`, `GET /api-docs/` | 404 `application/json` `Route not found`; `/api-docs/` 404 (flag unset) |
| Internal token, every internal route of every service | no token / wrong token / user JWT only | **401 / 401 / 401** on all 7 routes (detail below) |
| Internal token, correct | auth `POST /internal/users/bulk {userIds:[]}`; document `POST /internal/documents/live {documentIds:[]}` | 200 `{"data":[]}`; 200 `{"liveDocumentIds":[],"liveDocuments":[]}` |
| Internal token on public route | `GET /api/documents/:id` with only `x-internal-token` | 401 (not accepted as user auth) |
| Access token shape | register via gateway | access claims `userId,iat,exp`, TTL 300 s (SEC-007 default 5m); refresh claims `userId,iat,exp,jti`, TTL 604800 s |
| Token-type confusion | `/me` with refresh token; refresh with access token | 401; 401 |
| Rotation | refresh R1 | 200, rotated |
| Concurrent replay | R1 again within grace | 401 `Refresh token has already been used`; R2 still refreshes (200) |
| Reuse detection | `REFRESH_REUSE_GRACE_MS=0`, replay R1 | 401 `Invalid or revoked refresh token`; current R3 then 401 (all sessions revoked) |
| SEC-007 accepted residual | old access token after revocation | 200 (valid until its 5-minute expiry; accepted) |
| Duplicate e-mail | register same e-mail upper-case | 409 `User already exists` |
| Duplicate e-mail race | 6 parallel registrations, same e-mail | `201,409,409,409,409,409` (unique index holds; generic 409 body) |
| Registration bounds | 90,000-character name | **201** (see W6-SEC-04) |
| W5-L1 | `POST /internal/documents/live` with 201 ids | 400 `Invalid live-documents request` |
| W5-L3 | document list with a dead workspace-service | 503 to the client, but the log prints the whole `AppError` object with stack and `{ statusCode: 503 }` |
| ARC-010 | first proxied request | `[DEP0060] DeprecationWarning: The util._extend API is deprecated` printed |

These are the 7 internal routes tested (each answered 401 with no token, 401 with a wrong token, and 401 with a user JWT only):

- auth `POST /internal/users/bulk`
- document `POST /internal/documents/live`
- document `PATCH /internal/documents/:id/embedding-status`
- document `POST /internal/documents/:id/embedding/claim`
- document `GET /internal/documents/:id/embedding-source`
- task `POST /internal/workspaces/:id/members/:id/unassign`
- ai `DELETE /internal/vectors/workspaces/:id/documents/:id`

workspace-service and the gateway have no `/internal` router.

**TRUST_PROXY startup.** The real `services/api-gateway/src/server.ts` was started on port 5960 (`REDIS_URL=redis://127.0.0.1:6399`) with each of these values:

| Value | Exit code | Output |
|---|---|---|
| `::0.0.0.0/96` | 1 | `TypeError: invalid IP address: ::0.0.0.0` stack from `proxy-addr/index.js:163`, via `express/lib/application.js:371` and `app.ts:39` |
| `true` | 1 | uncaught `Error: TRUST_PROXY=true would trust ...` with source excerpt and stack (`app.ts:37`) |
| `0.0.0.0/0` | 1 | uncaught `Error: TRUST_PROXY contains a CIDR that is too wide ...` with stack |
| `::ffff:0:0/100x` | 1 | uncaught `Error: TRUST_PROXY must be a hop count ...` with stack |

**Parser compared with proxy-addr compile**, run with tsx on 17 values. The parser accepts these values, but `proxy-addr.compile` then throws:

- `::0.0.0.0/96`
- `::1.2.3.4/104`
- `::0.0.0.0/120`
- `::127.0.0.1`

All other accepted values compiled, including `::/96`, `0:0:0:0:0:0:0.0.0.0/96`, `::ffff:10.0.0.0/104` and `fe80::1%eth0`. `fd00::/8` and netmask notation are refused by the parser.

**Host checks (metadata only)**

- `docker ps`: `researchmind-mongodb 0.0.0.0:27017`, `researchmind-redis 0.0.0.0:6379`, `researchmind-mongo-express 0.0.0.0:8081`, all with `[::]` too.
- Boolean `docker inspect`: the running researchmind-redis command line contains `requirepass` 0 times and `protected-mode` 0 times. researchmind-mongodb has 0 `docker-entrypoint-initdb.d` mounts, so the per-service users were never provisioned.

**npm audit** (PowerShell, cwd `D:\ReserchMind`):

- `npm audit --omit=dev`: exit 1, **4 low** (katex 0.11.0 to 0.18.1 via `rehype-katex`, `remark-math`, `micromark-extension-math`; GHSA-238p-pmpm-9mq7).
- `npm audit`: exit 1, **19 total (0 critical, 2 high, 12 moderate, 5 low)**. The high ones are `shadcn` and `shadcn/node_modules/zod` (dev only). The moderates are the eslint / typescript-eslint / ts-morph / minimatch / nodemon chains. The lows are katex x4 and `deepmerge`. Wave 4 recorded 20 (2 high, 13 moderate, 5 low); the advisory set changed, but every item is still dev-only or the accepted katex chain.

**Repository secret scan.** `grep` of the working tree (excluding `node_modules`, `dist`, `.git`, `.env*`, `*.log`) for provider key shapes and credentialed Mongo/Redis URLs found no real credential. The hits were placeholders, test template strings, and the fake `redis://:3f9c0a2b7d@127.0.0.1:6380/2` test fixture. `.env`, `.env.backup-before-restore` and `*.log` are git-ignored (`.gitignore:9`, `:10`, `:15`).

## 3. Findings

Format: ID, severity, still present, files, evidence, root cause, recommended fix, regression test, disposition.

### 3.1 Wave 6 code scope (all Low)

#### W6-SEC-01: TRUST_PROXY / configuration errors crash with a stack trace; parser accepts IPv4-compatible IPv6 that proxy-addr cannot compile (Wave 4 carry-over)
- **Severity:** Low (fails closed: the gateway never starts with a dangerous value). **Still present:** yes.
- **Files:**
  - `services/api-gateway/src/config/trust-proxy.ts:39-61` (`classifyEntry` validates with `net.isIP`, which accepts `::a.b.c.d`);
  - `services/api-gateway/src/app.ts:35-39` (`throw new Error(trustProxy.error)` at module load; `app.set("trust proxy", …)` compiles with proxy-addr);
  - `services/api-gateway/src/app.ts:46-49` (same `throw` pattern for `CORS_ORIGIN`).
- **Evidence:** section 2. The `::0.0.0.0/96` value exits 1 with a proxy-addr `TypeError` stack. Every other refusal prints the source line, the stack and the message instead of a one-line `[api-gateway] refusing to start: …`.
- **Root cause:**
  - The parser and proxy-addr (ipaddr.js) disagree on what is a valid address.
  - Configuration errors are thrown from module scope instead of reported and followed by `process.exit(1)`, the pattern used by `assertRequiredSecrets`.
- **Fix:**
  - (a) In `classifyEntry`, after the existing checks, validate each accepted entry with `require("proxy-addr").compile([entry])` inside try/catch (or `ipaddr.isValid`), and map a throw to `"invalid"`.
  - (b) Move the TRUST_PROXY and CORS_ORIGIN checks into a `validateGatewayConfig()` called from `server.ts`, before `import app` (or catch in `app.ts`). It prints `[api-gateway] refusing to start: <message>` (variable name only) and calls `process.exit(1)`.
  - (c) As a belt-and-braces measure, wrap `app.set("trust proxy", …)` the same way.
- **Regression test:**
  - Extend `tests/gateway-trust-proxy.timing.ts`: the parser refuses `::0.0.0.0/96`, `::1.2.3.4/104` and `::127.0.0.1`.
  - Add a property check that every value the parser accepts compiles with proxy-addr, over the 43-value corpus from Wave 4 plus these.
  - A real gateway boot with `::0.0.0.0/96`, `true` and `*` (CORS) must exit 1, print exactly one `refusing to start` line naming the variable, and print no `    at ` stack frame.
- **Disposition:** Wave 6 scope.

#### W5-L3: AppErrors with status 500 or more are logged as whole objects
- **Severity:** Low. **Still present:** yes.
- **Files:** `packages/shared/errors/error.middleware.ts:51-55` (`console.error(err)` at line 53). It is the single shared middleware used by all five services; there is no per-service copy.
- **Evidence:** in the live run (section 2), a 503 printed `AppError: Workspace access could not be verified…`, 4 stack frames and `{ statusCode: 503 }`. No secret was in it, but any property later attached to an AppError (a wrapped provider error, a `cause`) would be dumped unredacted.
- **Root cause:** the RT-007 redaction (Wave 5) covered the catch-all branch (line 107) but not the AppError branch.
- **Fix:** replace line 53 with the same form as line 107: `console.error(\`[${req.method} ${path}] ${describeErrorForLog(err)}\n${frames}\`)`. Do not log `err.cause` raw.
- **Regression test:** in `tests/error-middleware.test.ts`, throw `new AppError("x", 503)` carrying an extra property `apiKey: "sk-live-…"`. Capture `console.error`. Expect one string argument containing `AppError status=503` and not containing `sk-live`.
- **Disposition:** Wave 6 scope.

#### W5-L1: a session-history page that cites more than 200 documents redacts every source
- **Severity:** Low (fails closed: provenance is lost, not data leaked). **Still present:** yes.
- **Files:**
  - `services/ai-service/src/controllers/query.controller.ts:189-196` (page cap `AI_SESSION_PAGE_MAX` 100);
  - `services/ai-service/src/services/document-status.service.ts:173-180` (one request with every id);
  - `services/document-service/src/controllers/document.controller.ts:277`, `:295` (`MAX_LIVE_CHECK_IDS = 200`, more than that gives 400);
  - `services/ai-service/src/services/ai-session.service.ts:68-101` (a catch sets `has: () => false`).
- **Evidence:** 201 ids gave a live 400 (section 2). 100 sessions x up to 10 sources (`MAX_TOP_K = 10`, `packages/validation/schemas/ai.schema.ts:11`) can reach 1,000 distinct ids.
- **Root cause:** the caller does not batch to the callee's cap.
- **Fix:** in `fetchLiveDocumentIds`, split the de-duplicated ids into chunks of 200, call them in sequence (or with bounded concurrency) and merge the maps. Any chunk failure still throws, which keeps the fail-closed behaviour. Do not raise the callee cap.
- **Regression test:** in `tests/retrieval-live-documents.integration.test.ts` (or a unit test with a stub document-service), check that 450 ids lead to 3 calls of 200, 200 and 50, and that the merged result is correct. In `ai-session-privacy.integration.test.ts`, check that a page of 30 sessions x 10 distinct sources keeps the live sources unredacted.
- **Disposition:** Wave 6 scope.

#### W6-SEC-02: LLM failure log line carries the raw provider message (RT-007 gap)
- **Severity:** Low. **Still present:** yes (`llm.error.ts` is unchanged since HEAD).
- **Files:**
  - `services/ai-service/src/errors/llm.error.ts:61-71`: `detail = \`${error.name}: ${error.message}\`` with no redaction and no length bound;
  - called from `grok.service.ts:60`, `:146`, `:165` and `meeting-summarizer.service.ts:222`.
- **Evidence:** static. Every other provider-error log path in ai-service uses `describeErrorForLog`: `query.controller.ts:58`, `:151`, `rag.service.ts:62`, `server.ts:65`, `worker.ts:51`, `embedding.worker.ts:108`. OpenAI-compatible SDK errors put the provider's response text in `message`; for authentication errors that is a partly masked key, and some proxies echo request details.
- **Root cause:** this logger predates `safe-error.ts` and was missed by the Wave 5 pass.
- **Fix:** `const detail = error === undefined ? "" : describeErrorForLog(error);`
- **Regression test:** in `tests/provider-error-redaction.test.ts`, call `logLlmFailure("stream", "auth", new Error("Incorrect API key provided: gsk_abcdefghijklmnop"))`. Expect the captured line to contain `<redacted` and not `gsk_abcdefghijklmnop`, and to be 400 characters or fewer.
- **Disposition:** Wave 6 scope.

#### W6-SEC-03: the gateway forwards client-supplied internal headers upstream
- **Severity:** Low (defence in depth; not exploitable today). **Still present:** yes.
- **Files:** `services/api-gateway/src/app.ts:146-165` (`proxyTo`: no `proxyReq` header removal besides the idle timeout).
- **Evidence:** in the live run, a client request with `x-internal-token: client-supplied`, `x-user-id: abc` and `x-forwarded-for: 6.6.6.6` reached the upstream with all three headers present.
- **Why not exploitable:** every `/internal` router is mounted outside the proxied prefixes. Path traversal to it is refused (400/404 above). The services key users only on the JWT, and none sets `trust proxy`.
- **Root cause:** http-proxy forwards all request headers by default.
- **Fix:** in the composed `proxyReq` handler, call `proxyReq.removeHeader("x-internal-token")` before `applyUpstreamIdleTimeout`. Optionally also remove any `x-forwarded-*` the client sent, since TRUST_PROXY governs the gateway itself and the services must never trust it.
- **Regression test:** in `tests/gateway-health-and-request-id.test.ts` (or `gateway-path-guard.test.ts`), send `x-internal-token` through each of the five prefixes to the stub upstream and assert the stub never sees it.
- **Disposition:** Wave 6 scope.

#### W6-SEC-04: registration fields have no upper bound
- **Severity:** Low. **Still present:** yes.
- **Files:** `packages/validation/schemas/auth.schema.ts:3-16` (`name` `min(2)` only, `email` `z.email()`, `password` `min(8)` only); `services/auth-service/src/models/User.ts:29-46` (no `maxlength`).
- **Evidence:** a live `POST /api/auth/register` with a 90,000-character name returned **201**. The response body was 90,619 bytes, because the name is echoed. The name is later shown to every workspace member through member hydration.
- **Bounds that do exist:** the 100 kB JSON limit caps the size per request. A long password is harmless to bcrypt (it truncates at 72 bytes) but is still stored. The frontend mirrors the server (ISS-039), so it does not bound the name either.
- **Root cause:** the schemas define minimums only.
- **Fix:**
  - Add `.max(100)` to name (trim first) and `.max(254)` to email.
  - Add `.max(128)` to password, or `.max(72)` with a clear message, since bcrypt ignores the rest.
  - Mirror these limits in `frontend/src/lib/validations/auth.schema.ts` (parity test).
  - Add `maxlength` to the model.
- **Regression test:** add `tests/auth-flow.test.ts` cases: name 101 characters gives 400; e-mail 255 characters gives 400; password 129 characters gives 400; a boundary value of exactly 100/254/128 gives 201. Update `client-validation-parity.test.ts`.
- **Disposition:** Wave 6 scope. This is a validation bound, not a feature.

#### W6-SEC-05: token lifetimes are not validated or bounded at startup
- **Severity:** Low. **Still present:** yes.
- **Files:** `services/auth-service/src/utils/jwt.ts:36` (`ACCESS_TOKEN_EXPIRES as any || "5m"`) and `:42` (`REFRESH_TOKEN_EXPIRES as any || "7d"`).
- **Evidence (static):**
  - Any string is passed to `jwt.sign`. An invalid value (for example `abc`) makes every login, register and refresh fail with 500 at request time instead of at boot.
  - An over-long value (for example `30d`) silently undoes the SEC-007 decision (5-minute access tokens).
  - The roadmap (section 29.1 item 12) records that the user's auth `.env` still sets `ACCESS_TOKEN_EXPIRES=15m`. Not verified here: `.env` files are not read.
- **Root cause:** no parser, unlike `readBoundedIntEnv` and `refreshReuseGraceMs`.
- **Fix:** parse both values at boot (`ms`-style string or seconds). Refuse to start (name only) when a value is invalid, when access is over 15 minutes, or when refresh is over 30 days or not greater than the access lifetime.
- **Regression test:** add to `tests/access-token-lifetime.test.ts` / `required-secrets-boot.test.ts`: a boot with `ACCESS_TOKEN_EXPIRES=abc` or `=30d` exits 1 naming the variable; `=5m` mints a 300-second token.
- **Disposition:** Wave 6 scope (code). **User action:** remove `ACCESS_TOKEN_EXPIRES=15m` from the auth `.env` (carried over).

#### W6-SEC-06: task-service starts without INTERNAL_SERVICE_TOKEN
- **Severity:** Low. **Still present:** yes.
- **Files:**
  - `services/task-service/src/server.ts:10` (`assertRequiredSecrets("task-service", ["JWT_ACCESS_SECRET"])`);
  - its internal route `services/task-service/src/routes/internal.routes.ts:22-37` uses the shared guard, which fails closed per request (`packages/shared/auth/internal-auth.middleware.ts:22-30`);
  - the caller is `services/workspace-service/src/services/workspace.service.ts:217-243` (`unassignRemovedMemberTasks`).
- **Evidence (static):** auth, workspace, document and ai require the token at boot (their `server.ts`); task-service does not. With it unset, every member removal leaves the removed member's tasks assigned. It is logged at `workspace.service.ts:177` and reported as `tasksUnassigned: null`, while task-service looks healthy.
- **Root cause:** SEC-018 added the boot requirement to auth and workspace only.
- **Fix:** add `"INTERNAL_SERVICE_TOKEN"` to task-service's `assertRequiredSecrets`, and document it in `services/task-service/.env.example` and `docs/reference/environment-variables.md`.
- **Regression test:** in `tests/required-secrets-boot.test.ts`, task-service without the token must exit 1 naming only the variable.
- **Disposition:** Wave 6 scope. **User action:** set the same token in the task `.env` before starting.

#### W6-SEC-07: the CI workflow does not restrict the GITHUB_TOKEN
- **Severity:** Low. **Still present:** yes.
- **Files:** `.github/workflows/ci.yml:1-71`.
  - No `permissions:` key, so the repository default applies, which can be read/write for `push`.
  - `actions/checkout@v4` (line 40) uses the default `persist-credentials: true`, so the token stays in `.git/config` while `npm ci` (line 51) runs dependency lifecycle scripts and `npm test` runs.
  - Actions are pinned by tag, not by commit SHA (lines 40 and 43).
- **What is already good:**
  - no `secrets.*` is referenced;
  - no `pull_request_target`;
  - the service containers use throwaway credentials-less images on the runner;
  - the test environment holds only disposable URLs (lines 67-69).
- **Root cause:** template workflow.
- **Fix:**
  - Add top-level `permissions: { contents: read }`.
  - Add `with: { persist-credentials: false }` on checkout.
  - Optionally pin `actions/checkout` and `actions/setup-node` to full commit SHAs, and add `timeout-minutes`.
  - Coordinate with the CI auditor (Agent 3), who owns the workflow.
- **Regression test:** extend `tests/repo-hygiene.test.ts` (or a CI-config test) to parse `ci.yml` and assert `permissions.contents === "read"`, `persist-credentials: false`, and no `pull_request_target` and no `secrets.` usage.
- **Disposition:** Wave 6 scope (CI hardening).

### 3.2 Carry-over residuals verified (not regressions)

#### SEC-002-PDF: PDF parsing runs in-process with no time or memory bound
- **Severity:** Medium (availability; any workspace member). **Still present:** yes.
- **Files:**
  - `services/document-service/src/utils/pdf-extractor.ts:17-38` (`new PDFParse({ data }) .getText()` on the request's event loop);
  - by contrast, DOCX runs in a child process with a timeout (`docx-extractor.ts:3`, `:226`);
  - the only PDF bound is the post-hoc text cap `MAX_EXTRACTED_TEXT_CHARS = 2_000_000` (`extraction-limits.ts:8`) plus the 10 MB upload cap (`upload.middleware.ts:56-59`).
- **Evidence:** static. Roadmap section 28.4 records "PDF parsing still in-process (residual)". Crafted PDFs were never tested (section 7.4).
- **Root cause:** the Wave 2 SEC-002 fix targeted DOCX (the demonstrated vector).
- **Fix:** run PDF extraction through the same child-process sandbox as DOCX: `--max-old-space-size`, wall-clock timeout giving 422/413, temp-file cleanup. Optionally cap pages (`getText({ first: N })`).
- **Regression test:** a timing test in the style of `docx-extraction-limits.timing.ts` with a generated PDF of many pages or deeply nested objects. Expect a 4xx within the timeout, `/health` answering throughout, and no temp file left.
- **Disposition:** recommended for Wave 6 if the lead accepts it as stabilization (it reuses existing machinery). Otherwise it is an accepted residual that the lead signs off explicitly.

#### SEC-001: real MongoDB, Redis and mongo-express exposed on all interfaces
- **Severity:** High (P0 in the original audit). **Still present:** yes, at host level. The repository part is fixed: `docker-compose.yml:29-30`, `:80-81` bind `127.0.0.1`; `:33-51` have no default credentials; `:73-78` set `requirepass` and protected mode.
- **Evidence:**
  - `docker ps` shows `0.0.0.0:27017`, `0.0.0.0:6379` and `0.0.0.0:8081` (plus `[::]`) for the running `researchmind-*` containers.
  - The running Redis command has no `requirepass` (boolean 0).
  - The running Mongo has no provisioning mount (boolean 0). These containers were created from the old compose file.
- **Disposition:** **user/host action**. Follow "Securing an existing installation" in `docs/deployment/docker-process.md`:
  - recreate the containers from the current compose file with a populated root `.env`;
  - provision the per-service users and rotate the root password;
  - update every `MONGO_URI` / `REDIS_URL`;
  - remove or localhost-bind mongo-express.

  This depends on SEC-014. Not performed here (rules).

#### SEC-014: services use the root MongoDB user (real configuration)
- **Severity:** Medium. **Still present:** cannot be verified without reading `.env`. The running container has no provisioning mount, so no per-service user exists. The repository part (`docker/mongo/provision-service-users.js`) is done.
- **Disposition:** **user action** (same procedure as SEC-001).

#### SEC-005 legacy: 67 public Cloudinary assets
- **Severity:** Medium (existing uploads stay world-readable by URL). **Still present:** cannot be verified (no real data access). The new-upload path is verified correct:
  - `file-storage.ts:207-228`: `type: "authenticated"`, random UUID `public_id`, `overwrite:false`;
  - `:269-292`: host, cloud, folder and type allow-list; no `fetch` types; no transformations;
  - `:306-340`: signed URL built server-side only;
  - `document-serializer.ts:8-14`, `:46-55`: storage fields stripped from every client response;
  - `document-file.controller.ts:70-166`: live membership check, `redirect:"error"`, 60 s timeout, 20 MB cap, `no-store`, `nosniff`, sanitised `Content-Disposition`.
- **Note:** a Cloudinary signature on an `authenticated` asset does not expire. That is acceptable because the URL never leaves the server and is not logged (the log lines at `document-file.controller.ts:94`, `:116-124`, `:156-158` print ids and status only).
- **Disposition:** **user-run migration**: `services/document-service/src/scripts/migrate-cloudinary-private.ts`. It is a dry run by default; `--apply` migrates. Run it after a backup.

#### SEC-022 residual: npm advisories
- **Severity:** Low. **Still present:** yes (section 2: production 4 low katex chain; full 19, all dev-only or katex).
- **Disposition:** accepted residual. Revisit in the dependency batch, where the katex chain is fixable only by downgrades or an override.

#### SEC-009 residual: register reveals existing e-mails; duplicate registration
- **Severity:** Low. **Still present:** yes.
- **Files:** `services/auth-service/src/services/auth.service.ts:52-56`.
- **Evidence:** the race is safe. Six parallel registrations gave one 201 and five 409s via the unique index (`User.ts:40-46`, `lowercase:true`). The upper-case variant gave 409. Two different 409 texts exist (`User already exists` versus the generic `A resource with the same unique value already exists` from the index race), but both reveal the same fact.
- **Disposition:** accepted residual (needs e-mail verification, product scope); capped by the register limiter (3 per hour per IP).

#### SEC-007 residual: access token survives logout or revocation for up to 5 minutes
- **Severity:** Low.
- **Evidence:** live: after reuse-triggered revocation, the old access token got 200 on `/me`.
- **Disposition:** accepted (user decision; 5-minute TTL verified live, 300 s).

#### SEC-008 residual: tokens in localStorage
- **Severity:** Low (mitigated by the CSP).
- **Files:** `frontend/src/store/auth.store.ts:87` (`createJSONStorage(() => localStorage)`). The CSP is verified live on the gateway. The SPA policy is in `frontend/csp.ts:31-46` (no `unsafe-inline` or `unsafe-eval` scripts; `img-src https:` is broad but script-free).
- **Disposition:** accepted exception (S10). The browser check of the production build is a **user action**.

### 3.3 Informational

#### W6-SEC-08: document-service keeps its own internal-token guard
- **Files:** `services/document-service/src/middlewares/internal-auth.middleware.ts:46-103`.
- **Detail:** it reads `process.env.INTERNAL_SERVICE_TOKEN` raw, without `requireSecret` strength checks or trimming. The boot check at `document-service/src/server.ts:10` compensates, and all 4 routes answered 401/401/401 live.
- **Fix (optional):** re-export the shared guard (ISS-047 residual) so that a future change cannot diverge.
- **Disposition:** Info; optional in Wave 6.

#### W6-SEC-09: document-service winston writes `error.log` and `combined.log` to the current folder
- **Files:** `services/document-service/src/utils/logger.ts:9-13`.
- **Detail:** git-ignored (`.gitignore:15`). The content is redacted log lines (document ids, sweep summaries).
- **Disposition:** Info. Document the location and retention, or make a log directory configurable (operations, not security-critical).

#### ARC-010: DEP0060 `util._extend`
- **Detail:** still emitted on the first proxied request (live). It comes from http-proxy inside `http-proxy-middleware` 3.0.7.
- **Disposition:** accepted exception until the http-proxy-middleware 4 upgrade in the dependency batch.

#### Deferred dependency batch
Confirmed still present:
- `cors` declared but not imported in auth, ai, document and task `package.json`;
- `frontend/package.json`:
  - `pdfjs-dist ^6.2.108` (line 26; the code imports react-pdf's 5.4.296 through the Vite alias);
  - `recharts` (35), `@hugeicons/core-free-icons` and `@hugeicons/react` (18-19), and `react-is` (31), with no importer under `frontend/src`;
  - `--max-warnings 4` (line 9; actual 3).

There is no security impact beyond the attack surface of unused code.

**Disposition:** a dependency batch, owned by the implementation agent or the lead, with its own lockfile verification. It is not a security fix.

#### SEC-019: `iss`/`aud`/`typ` absent
- **Evidence:** live claims are `userId,iat,exp` (access) and `+jti` (refresh). Type separation relies on distinct secrets: auth-service enforces this (`packages/shared/config/secrets.ts:159-172`, used in `auth-service/src/server.ts:15`), and a refresh-secret token got 401 at the gateway (live). Other services cannot check the inequality, because they hold only the access secret.
- **Disposition:** accepted residual.

#### SEC-011: RAG prompt injection
- **Detail:** model-level influence remains after the Wave 4 nonce fencing.
- **Disposition:** accepted residual.

#### ARC-005: browser E2E
- **Detail:** still deferred. It is the CI/testing agents' concern.
- **Disposition:** accepted exception (S15).

## 4. Controls re-confirmed (no change needed)

- **Path guard:** first middleware (`app.ts:68`). Segment-bounded proxy filters (`path-guard.middleware.ts:94-95`).
- **Gateway rate limiting:**
  - login 5/15 min, register 3/h, auth API 60/min (IP);
  - AI 30/h and summarize 20/h (user);
  - general 100/min;
  - fail-open fast with a 300 ms command timeout and latch (`rate-limit.middleware.ts`).
- **Per-account login throttle:** in MongoDB (`login-throttle.ts`). Its key is a SHA-256 of the normalised e-mail, so no address is stored.
- **One HS256 verifier** with a 24-hex `userId` (`packages/shared/auth/access-token.ts`). It is used by the gateway, workspace, auth (re-export) and the shared `authenticate` (document, task, ai).
- **Refresh rotation:** an atomic claim, a 10 s grace (bounded to 60 s), and revocation of all sessions on reuse (`auth.service.ts:146-223`), all verified live.
- **Membership:** checked live against workspace-service with the caller's token. Outcomes stay distinct (400/401/403/503). Owner-only deletes apply to boards, tasks and documents (`workspace-membership.ts`, task routes).
- **Embedding queue jobs are pointers only:** `{documentId, workspaceId}` (`embedding.queue.ts:12-27`). Text is fetched over the authenticated internal route by the claim holder.
- **Secrets:** fail-closed validation with names only (`secrets.ts`); a known-insecure list; minimum 32 characters.
- **CORS** allow-list with a loopback default; `*` is refused. Swagger is off by default. JSON 404s. `x-powered-by` stripped.

## 5. Recommended Wave 6 security scope

1. **W6-SEC-01:** a parser cross-check with proxy-addr, plus a clean `refusing to start` message and exit 1 for TRUST_PROXY and CORS_ORIGIN (and a guarded `app.set`).
2. **W5-L3:** use `describeErrorForLog` for AppErrors with status 500 or more in `error.middleware.ts:53`.
3. **W6-SEC-02:** redact `logLlmFailure` through `describeErrorForLog`.
4. **W5-L1:** batch `fetchLiveDocumentIds` in chunks of 200, keeping the fail-closed behaviour.
5. **W6-SEC-03:** strip `x-internal-token` (and client `x-forwarded-*`) in the gateway's `proxyReq`.
6. **W6-SEC-04:** maximum lengths for registration name, e-mail and password (server, model and client parity).
7. **W6-SEC-05:** boot-time validation and bounds for `ACCESS_TOKEN_EXPIRES` and `REFRESH_TOKEN_EXPIRES`.
8. **W6-SEC-06:** require `INTERNAL_SERVICE_TOKEN` at task-service startup.
9. **W6-SEC-07:** `permissions: contents: read` and `persist-credentials: false` in `ci.yml` (with Agent 3).
10. **SEC-002-PDF** (lead decision): run PDF extraction in the existing child-process sandbox. If not taken, record it as an accepted residual with sign-off.
11. **Optional:** W6-SEC-08 (re-export the shared internal guard in document-service).

Each item comes with the regression test listed in its section. None needs a `package.json` or lockfile change.

## 6. Out of scope (with reason)

| Item | Reason |
|---|---|
| SEC-001 host exposure, SEC-014 real database users, credential rotation | Host-level change on the user's machine; rules forbid touching `researchmind-*`. The procedure is documented in `docs/deployment/docker-process.md` |
| SEC-005 legacy 67 public Cloudinary assets | Real-data migration and a live provider call; the user runs `migrate-cloudinary-private.ts` (dry run, then `--apply`) after a backup |
| Removing `ACCESS_TOKEN_EXPIRES=15m` from the auth `.env`; setting `INTERNAL_SERVICE_TOKEN`, `CORS_ORIGIN`, `TRUST_PROXY` | `.env` files are user-owned and must not be read or edited |
| SEC-022 katex lows and dev-only advisories (19) | Fixable only by downgrades or overrides; accepted residual; belongs in a verified dependency batch |
| ARC-010 DEP0060, http-proxy-middleware 4 upgrade, unused `cors`, `pdfjs-dist ^6`, `recharts`, `@hugeicons/*`, `react-is`, `--max-warnings 3`, D2 dedupe, D3 root test devDependencies | Dependency and lockfile batch (manifest changes, separate verification); no security defect |
| SEC-019 `iss`/`aud`/`typ` | Accepted residual; distinct secrets are enforced at auth-service and verified live |
| SEC-009 register 409 enumeration | Needs e-mail verification (product scope) |
| SEC-007 access-token revocation (denylist) | User decision: 5-minute TTL, no denylist |
| SEC-008 cookie token transport | Accepted exception S10 (needs a deployment-topology decision) |
| SEC-011 residual model influence | Inherent to LLMs; mitigations in place |
| ARC-005 browser E2E | Deferred exception S15; CI/testing agents' concern, not a security fix |
| ISS-046 / ISS-048 | Product scope |
