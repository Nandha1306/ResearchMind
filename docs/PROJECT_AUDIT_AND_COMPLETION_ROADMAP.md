# ResearchMind AI: Project Audit and Development Readiness Report

| | |
|---|---|
| **Audit date** | 2026-11-12 |
| **Repository** | `d:\ReserchMind` (npm workspaces monorepo) |
| **Branch / revision** | `fix/wave-4` @ `e6d68ad47b640ab91ff715fd4c772917efec3b64`, clean working tree |
| **Integration branch** | `develop` (`origin/develop` is 16 commits behind HEAD) |
| **Audit type** | Audit only. The only repository change is this file. It replaces the audit of 2026-11-10, whose issues ISS-001 to ISS-052 are reconciled in section 6. The previous version remains in git history (`git show e6d68ad:docs/PROJECT_AUDIT_AND_COMPLETION_ROADMAP.md`). |
| **Final decision** | **B. READY FOR DEVELOPMENT WITH CONDITIONS**, with strict prerequisites that must be completed before any new feature development begins (section 27) |

## How to read this report

- **Severity scale (current findings):**

  | Level | Meaning |
  |---|---|
  | P0 Critical | Live, exploitable exposure or data loss. Act immediately. |
  | P1 High | Must be fixed before development continues. |
  | P2 Medium | Fix before work in the affected area and before any exposure beyond localhost. |
  | P3 Low | Real defect or gap with limited impact. Schedule. |
  | P4 Informational | Hygiene, documentation, minor UX or tracking items. |

  The 2026-11-10 audit used Critical / High / Medium / Low. These map approximately to P0 / P1 / P2 / P3.
- **Reconciliation status (section 6):** FIXED, PARTIALLY FIXED, STILL OPEN, REGRESSED, NOT REPRODUCIBLE, NOT VERIFIED.
- **Requirement status (section 19):** COMPLETE (implemented, and executed evidence covers the whole requirement), NOT VERIFIED (implemented per code, but the user journey was never executed end to end), PARTIAL (part of the scope, or a material deviation), BROKEN (does not do what the specification says), NOT IMPLEMENTED (absent, placeholder, disabled control or empty service).
- **Runtime result (section 21):** PASS, FAIL, INFO (a measurement with no pass/fail criterion), BLOCKED (could not run without a prerequisite such as a live provider), NOT VERIFIED.
- **Root cause:** CONFIRMED (shown by code and/or execution) or SUSPECTED (plausible, not proven).
- **Method tags:** S = static reading of the cited lines; T = a named automated test passed; R = runtime or command execution in this audit.
- **ID prefixes:**

  | Prefix | Source |
  |---|---|
  | ISS-nnn | Historical issue from the 2026-11-10 audit |
  | ARC-nnn | Agent 1, architecture and codebase |
  | RT-nnn | Agent 2, runtime and end-to-end QA |
  | SEC-nnn | Agent 3, security, authentication and data integrity |
  | REQ-nnn | Agent 4, README requirement (also used as a finding ID for the two requirement defects in section 7) |
  | S1 to S15 | Product development scope items (missing capabilities, not bugs) |

- **Precedence:** Agent 5 independently re-ran and re-graded findings. Where it differs from the original agent, Agent 5's result is used and the disagreement is recorded (section 7.2).
- File line numbers refer to revision `e6d68ad`. No secret, credential, token, `.env` value, e-mail address or document content appears in this report; only counts, names of variables and file paths.

---

## 1. Executive summary

**Position.** The core MVP is implemented and its API-level journeys work at runtime against the current source: authentication with refresh rotation, workspaces with invite-code join, PDF/DOCX upload and validation, the embedding job pipeline with claim/fencing/retry/sweep, streaming RAG Q&A, the meeting summarizer feeding an idempotent bulk task import, and a Kanban board with subtasks and activity history. Since the 2026-11-10 audit, fix waves 0 to 4 have fixed 23 of the 52 historical issues and partly fixed 13 more, with no regressions.

The infrastructure on the development host and a few concentrated defects are not acceptable: the real MongoDB, Redis and mongo-express are reachable on every network interface with default or no credentials while the host is on a Public network (P0); a 19 KB crafted DOCX can exhaust document-service memory (P1); and a doubled slash in the URL bypasses the login, register and AI cost rate limits (P1). CI has never passed and has never run on any fix-wave code. External providers (Voyage, Pinecone, Groq/xAI, Cloudinary) were never exercised live, so no user journey that depends on them is verified.

**Key numbers**

| Metric | Value |
|---|---|
| Historical issues reconciled (section 6) | 52: FIXED 23, PARTIALLY FIXED 13, STILL OPEN 15, NOT REPRODUCIBLE 1, REGRESSED 0, NOT VERIFIED 0 |
| Current findings (section 7) | 68: P0 1, P1 2, P2 5, P3 31, P4 29 |
| Runtime checks against current source (Agent 2) | 190: 171 PASS, 7 FAIL, 11 INFO, 1 NOT VERIFIED; plus independent reproductions by Agents 3 and 5 |
| Automated tests | 239/239 pass with a disposable MongoDB (3 independent runs); 170/170 without it (69 tests skipped silently) |
| Typecheck and build | 6 services and the frontend typecheck clean; frontend build succeeds |
| Frontend lint | 42 problems (38 errors, 4 warnings); not a CI gate |
| `npm audit --omit=dev` | 30 advisories (2 critical, 14 high, 9 moderate, 5 low); no reachable exploit path identified |
| README requirements (section 19) | 157: COMPLETE 15, NOT VERIFIED 44, PARTIAL 26, BROKEN 1, NOT IMPLEMENTED 71 |
| CI history | Exactly one GitHub Actions run ever (2026-11-11, phase-4 branch): failed. No run on any fix-wave commit. No pull request exists. |
| Readiness gates (section 24) | 4 CONDITIONAL PASS, 2 FAIL (Security, Operational readiness) |

**Most important findings**

| ID | Severity | Finding |
|---|---|---|
| SEC-001 | P0 | Real MongoDB (root user, default password), mongo-express (default basic auth) and Redis (no password, protected mode off) published on all interfaces; Docker firewall Allow rule on the active Public profile. Default credentials verified to work through the host's own LAN address. |
| SEC-002 | P1 | DOCX parsing in the request process has no decompressed-size or node limits: a 19 KB file takes 11.7 s, adds about 0.5 GB RSS per upload, stalls `/health`, and crashes the process under a constrained heap. |
| SEC-003 | P1 | `//` in the path (`/api/auth//login`, `/api/auth//register`, `/api/ai//query`) bypasses the login, register and AI cost limiters. (Re-graded from P2 by Agent 5.) |
| RT-001 | P2 | While Redis is down, every rate-limited request waits 9 to 31 s (fail-open is slow); AI queries exceed 30 s client timeouts. |
| SEC-005, SEC-006, SEC-010, ISS-037 | P2 | Public Cloudinary assets; full document text carried and trusted through unauthenticated Redis; no roles or member removal; embedding provider calls without timeout can stall the only worker. |
| ARC-005 / REQ-138 | P3 (gate condition) | CI quality gates incomplete, and CI has never been green. |

**What holds** (runtime-verified): HS256 pinning (alg=none, HS512, expired and wrong-key tokens rejected on every service); workspace isolation (21 cross-tenant probes); internal routes unreachable through the gateway; server-owned document fields; atomic refresh rotation with reuse detection (concurrent refreshes yield exactly one success); ordered, compensating document deletion; claim/fencing and retry limits in the embedding worker; atomic idempotent bulk import; fail-closed membership checks (503); graceful shutdown of all services in 1.5 to 3.2 s; all upload rejection paths.

**Decision.** **B. READY FOR DEVELOPMENT WITH CONDITIONS.** Before any new feature development begins: (1) remediate SEC-001 on the host; (2) fix SEC-003, SEC-002 and RT-001 with regression tests; (3) obtain a green CI run on a pull request into `develop`. Until gates 2 and 6 pass, nothing is exposed beyond localhost. If the prerequisites are not met, the decision reverts to C. Details in sections 24 to 27.

---

## 2. Audit scope and methodology

**Scope.** The whole monorepo at `e6d68ad`: `services/` (api-gateway, auth, workspace, document, task, ai, notification stub), `packages/shared`, `packages/validation`, `packages/shared-config`, `frontend/`, `tests/`, `.github/workflows/ci.yml`, `docker-compose.yml`, `docs/` and `ResearchMind_readme.md` (plus the original specification at commit `31ef58d`). The developer host's Docker infrastructure was inspected read-only.

**Agents**

| Agent | Scope | Executed | Static only |
|---|---|---|---|
| Lead | Baseline, disposable infrastructure, final decisions | Recorded git state, tooling, Docker and port ownership; created disposable MongoDB (`127.0.0.1:27094`) and Redis (`127.0.0.1:6394`) | — |
| 1 Architecture | Architecture map, module completeness, build/test/lint/CI, historical reconciliation, ARC findings | `tsc --noEmit` x6, frontend build, ESLint, `npm test` with and without MongoDB, build-and-start of workspace-service from `dist/`, `npm audit`, index-metadata read of the user's auth DB, a timezone computation | Module review, ISS-001 to 052 dispositions, CI workflow review |
| 2 Runtime / E2E | All journeys through the gateway | Built all six services from current source into git-ignored `dist/`; ran them on ports 5980 to 5989 against disposable MongoDB/Redis with child-only environment; 190 checks including Redis outage, service kills, startup failures, signals, SSE truncation, Vite preview; `npm test` | — |
| 3 Security | AuthN/AuthZ, data integrity, RAG security, dependencies | Services from source (tsx) on ports 5990 to 5997; JWT, isolation, mass-assignment, internal-route, rate-limit, DOCX-amplification, enumeration-timing probes; 78 security tests; `npm audit`; read-only aggregate counts on the user's MongoDB/Redis | Code review of all services and the frontend auth/rendering paths |
| 4 Requirements | README traceability (157 requirements), feature matrix | `npm test` with MongoDB (239/239); read-only `gh run list` / `gh run view` | Requirement-by-requirement code tracing |
| 5 Independent review | Re-verification, severity re-grades, contradiction resolution | Own instances on ports 5970 to 5979 from current-source `dist/`; reproduced SEC-001, SEC-002, SEC-003, RT-001, RT-002, RT-003, RT-007, RT-004, SEC-022; Redis outage simulated through a TCP proxy; `gh` read-only CI history | Static re-checks of REQ-128, REQ-082, SEC-005/006/010 |

**Safety rules applied**
- No repository file was modified except this report. `git status --porcelain` was empty before and after every agent's work. Builds wrote only to git-ignored `dist/`, `frontend/dist` and `frontend/node_modules/.tmp`.
- All runtime tests used disposable MongoDB/Redis. Each service ran from a scratch working directory so that no repository `.env` could be loaded (logs confirm `injected env (0) from .env`). Secrets were fresh random values per run; provider keys were dummies.
- The user's real infrastructure was inspected read-only and aggregate-only (counts, configuration flags, credential equality tested as booleans inside the containers). No document content, e-mail address or secret value was read or printed. Only variable names in `.env` files were inspected.
- Outbound calls: three uploads reached Cloudinary with dummy credentials (401); provider calls with dummy keys failed (401); `npm audit` queried the npm registry. No real credential was used.
- All started processes were stopped; disposable databases created by agents were dropped or flushed.

---

## 3. Audit date and source revision

| Item | Value |
|---|---|
| Audit date | 2026-11-12 (approximately 12:30 to 14:15 UTC) |
| Branch | `fix/wave-4` |
| Revision | `e6d68ad47b640ab91ff715fd4c772917efec3b64` ("docs(wave-4): align documentation with the implementation …") |
| History | `e6d68ad` wave-4 docs, `c1464f7` wave-3, `4c405b7` wave-2, `0818907` wave-1, `bf2404b` wave-0, `e7dae6e` phase-4 |
| Working tree | Clean (0 staged, unstaged or untracked). Ignored non-build items: `ResearchMind-page-images/`, `services/document-service/{combined.log,error.log,test_files/}` |
| Remote | `origin/fix/wave-4` equals HEAD (pushed). `gh pr list --state all` is empty. |
| Build provenance | `dist/` builds used at runtime were produced after the HEAD commit time from the clean tree, so they reflect the current source. |

---

## 4. Environment and Docker status

**Plain statement.** No ResearchMind application container exists: the repository has no Dockerfiles, and `docker-compose.yml` defines infrastructure only. The user's Docker runs only MongoDB, Redis and mongo-express. Ports 5000 and 5173 on the host belong to other projects. **All runtime results in this report come from services started from the current source against disposable MongoDB/Redis. Nothing is attributed to old containers.**

**Tooling:** Node v22.14.0, npm 10.9.2, Docker 28.4.0, Docker Compose v2.39.2-desktop.1, Windows 11.

**Host resources:** disk C: about 2.5 GB free at the start and **0.8 GB free at the end of the audit** (operational risk on this development host: builds, Docker volumes and logs can fail); free virtual memory about 3.1 GB at the start, about 2.3 GB during runtime tests. Cold starts were slow under this pressure (section 22).

| Item | Status |
|---|---|
| `researchmind-mongodb` (mongo:7) | Running, 0 restarts, `unless-stopped`, no healthcheck, published `0.0.0.0:27017` and `[::]:27017`. Logs routine. Not modified. |
| `researchmind-redis` (redis:7.4.9) | Running, 0 restarts, no healthcheck, published `0.0.0.0:6379`, `requirepass` empty, `protected-mode no`, `bind * -::*`, AOF off. 1 key (`test`, no TTL); embedding queue length 0. Not modified. |
| `researchmind-mongo-express` | Running, published `0.0.0.0:8081`; its log says the server is open to connections from anyone. Default basic-auth credentials. Not modified. |
| Firewall / network | Wi-Fi profile **Public**. Effective default inbound action Block, overridden by two enabled "Docker Desktop Backend" Inbound Allow rules (TCP and UDP, any port, Public profile). |
| Other containers | Unrelated projects (rate-limiter-gateway, fund-request-db, sonarqube), exited. |
| `rm-audit-mongo` (disposable) | `127.0.0.1:27094`, no auth. Used for all runtime tests and `npm test`. |
| `rm-audit-redis` (disposable) | `127.0.0.1:6394`. Created with `--rm`, so Agent 2's outage tests deleted and recreated it (about 13:12Z and 13:20Z); any queue contents in it are not evidence. Agent 5 simulated outages through a TCP proxy instead. |
| Application containers | None exist (no Dockerfiles). "Containers run current source" is not applicable. |
| Host port 5000 | An unrelated `node server.js` started 2026-11-05; `GET /health` returns 404. Not the ResearchMind gateway. The frontend default `VITE_API_URL` (`http://localhost:5000/api`) points at it when `frontend/.env` is absent (it is). |
| Host port 5173 | Vite of a different project. |
| `.env` presence | Present in all six services and the root; `frontend/.env` missing. Values not read. Names-only checks: the root `.env` uses `MONGO_ROOT_USER` while compose expects `MONGO_ROOT_USERNAME`; `INTERNAL_SERVICE_TOKEN` is absent from auth-service and workspace-service. |
| Pre-existing artefacts | `services/document-service/uploads/` (git-ignored) holds leftover temporary upload files from earlier development runs: Agent 2 counted 9 dated 2026-08-04 to 2026-11-11, Agent 3 counted 7 from August 2026. Not created or deleted by the audit. The current code removed temp files on every tested path. |
| Windows signals | `taskkill` without `/F` refuses to stop a Node service; `/F` kills without cleanup. Graceful stop on Windows works only with Ctrl+C in an attached console (agents used a preload script to emit the signal). |

---

## 5. Architecture overview

### 5.1 Runtime topology (as implemented)

```
Browser SPA (React 19 + Vite, frontend/) --axios / fetch(SSE)--> VITE_API_URL || http://localhost:5000/api
        |
api-gateway :5000   cors() * | helmet (CSP off) | morgan | Swagger /api-docs (public)
  POST /api/auth/login    -> login limiter (5 / 15 min / IP)
  POST /api/auth/register -> register limiter (3 / h / IP)
  /api/auth/*        -> auth-service :5001        (refresh, me, logout unthrottled)
  /api/workspaces/*  -> authenticate + 100/min/user -> workspace-service :5002
  /api/documents/*   -> authenticate + 100/min/user -> document-service :5003
  /api/tasks/*       -> authenticate + 100/min/user -> task-service :5004
  /api/ai/*          -> authenticate + AI limiters (query/search 30/h, summarize 20/h) + general -> ai-service :5006
  GET /health        -> static 200
  Rate-limit store: Redis (rate-limit-redis, passOnStoreError = fail open)

auth-service       Mongo users, refreshtokens; node-redis client connected but unused; /internal/users/bulk
workspace-service  Mongo workspaces (members: string[], inviteCode); join, membership, members
document-service   Mongo documents; multer to disk; pdf-parse; mammoth; Cloudinary; ioredis producer;
                   internal claim/status endpoints; recovery sweep every 5 min
task-service       Mongo boards, tasks, taskactivities; bulk import; activities
ai-service         Mongo aisessions; Voyage (LangChain); Pinecone (namespace = workspaceId); Groq/xAI (OpenAI SDK);
                   /api/ai/search, /api/ai/query (SSE), sessions, summarize-meeting; internal vector delete;
                   in-process embedding worker (BLPOP); optional standalone worker
notification-service  0-byte app.ts/server.ts; not routed, not built
Infrastructure (docker-compose.yml): mongo:7, redis:7, mongo-express only
```

### 5.2 Main flows

- **Auth:** login/register issue an access token (15 min, HS256) and a refresh token (7 d, random `jti`). The refresh hash is stored with a TTL. Rotation is a single conditional `findOneAndUpdate` with a 10 s grace window (`auth.service.ts:139-170`). The client stores both tokens in `localStorage` and uses a single-flight refresh coordinator with Web Locks and cross-tab sync.
- **Membership:** document, task and ai services call `GET workspace-service/api/workspaces/:id/membership` with the caller's token (3 s timeout; outcomes 400/401/403/503) via `packages/shared/auth/workspace-membership.ts`.
- **Ingestion:** upload, extension filter and 10 MB cap, membership, magic bytes, text extraction (in the request process), Cloudinary, Mongo `pending`, `RPUSH` job carrying the full text, worker `BLPOP`, claim with fencing token, chunk (about 400 tokens, 60 overlap), Voyage embed (batch 20), delete old vectors, Pinecone upsert, PATCH `indexed`. Failures set `failed` with a reason; the sweep retries up to 3 attempts.
- **Delete:** mark `deletedAt`, delete vectors through ai-service (rollback and 503 on failure), Cloudinary destroy, delete record.
- **RAG:** validate (1 to 2000 characters, topK 1 to 10), membership, SSE `start`, query embedding, Pinecone topK (no score threshold), `sources`, LLM stream (`token`) with idle watchdog, citation audit, save session, `done`; failures send `error{message, partial}`.
- **Meeting to tasks:** LLM JSON normalised by zod; the client builds a bulk payload with `importKey`; task-service inserts all-or-nothing with compensation and a unique `(workspaceId, importKey, importIndex)` index.

### 5.3 Frontend

| Route | Component | State |
|---|---|---|
| `/login`, `/register` | LoginPage / RegisterPage | Real |
| `/create-workspace` | CreateWorkspacePage (create or join) | Real |
| `/dashboard` | OverviewPage (indexing stats, AI session count, member count) | Real data |
| `/dashboard/tasks` | KanbanPage with CreateTaskModal and TaskDetailModal | Real |
| `/dashboard/documents` | DocumentsPage with upload and PdfViewerModal | Real |
| `/dashboard/ai-researcher`, `/app/workspace/:id/search` | SemanticSearchPage (SSE Q&A, history) | Real; the `:id` alias is BROKEN (REQ-128) |
| `/dashboard/meeting-notes` | MeetingSummarizerPage | Real |
| `/dashboard/sources`, `/analytics`, `/literature-review`, `/report-drafter`, `/settings` | PlaceholderPage ("in development") | Placeholder |

Guards: `ProtectedRoute`, then `OnboardingGuard`, then `AppShell`. State: zustand stores (`auth.store.ts`, `workspace.store.ts`) and TanStack Query. Dead code with no importers: the 5-step workspace wizard components, three dashboard mock cards, `MathMarkdown.tsx`, `App.css`, default assets (ARC-009).

### 5.4 Shared packages and integrations

- `packages/shared` (no `package.json`; consumed by deep relative imports): authenticate, internal-auth, workspace-membership, fail-closed secret validation, error middleware, health check, lifecycle (mongo, redis, shutdown).
- `packages/validation`: zod schemas for auth, workspace, document, task, ai.
- `packages/shared-config`: unreferenced placeholder.

| Integration | Used by | Startup behaviour | Verified live in this audit |
|---|---|---|---|
| MongoDB | 5 data services | One bounded attempt (about 30 s), then exit 1 | Yes (disposable) |
| Redis | gateway, document, ai, auth (unused) | Reconnect forever, non-blocking | Yes (disposable) |
| Cloudinary | document-service | Not validated at startup; first upload fails with 502 | No (dummy credentials, 401) |
| Voyage | ai-service | Key required at import | No (dummy key, 401) |
| Pinecone | ai-service | Key/index required at import; dimension check warns and continues on failure | No (dummy key rejected) |
| Groq / xAI | ai-service | Key required at import | No (dummy key) |

### 5.5 Module completeness

| Module | Status | Notes |
|---|---|---|
| api-gateway | PARTIAL | Agent 1 rated it COMPLETE; corrected by Agent 5: limiters bypassable (SEC-003), slow fail-open (RT-001), no upstream timeout (RT-003), static `/health` (ISS-044) |
| auth-service | COMPLETE (core) | Runtime and integration tests; account management missing (scope) |
| workspace-service | PARTIAL | No roles, removal, leave, rename, delete; member hydration without timeout (ARC-004) |
| document-service | FUNCTIONAL, live providers unverified | Parser exhaustion (SEC-002); public Cloudinary (SEC-005); metadata-only endpoint (ARC-001) |
| task-service | COMPLETE (backend) | Board rename/delete have no UI; replay compares count only (RT-004) |
| ai-service RAG | FUNCTIONAL, live providers unverified | No disconnect abort (ISS-015), no relevance threshold (ISS-028), prompt injection (SEC-011), raw Markdown in UI (ARC-002), zod 3 at runtime (RT-005) |
| ai-service meeting summarizer | FUNCTIONAL, live provider unverified | No JSON mode, not persisted (ISS-030) |
| Embedding worker and sweep | FUNCTIONAL, live providers unverified | No provider timeout (ISS-037); full text in Redis (SEC-006) |
| notification-service | NOT IMPLEMENTED | Empty files |
| Agent, chat, literature review, report drafter, analytics | NOT IMPLEMENTED | Product scope |
| Frontend | Core pages real; 5 placeholders | No component or browser tests |
| Tests | PARTIAL | 239 tests; no UI/E2E/live-provider/limiter tests; no coverage |
| CI | PARTIAL | Never green; no lint, audit, Redis, E2E |
| Deployment | NOT IMPLEMENTED | No Dockerfiles or deployment configuration |

---

## 6. Previous audit reconciliation

Each historical issue was checked against the current code, not against the fix-wave notes. Agent 5 corrections are applied: **ISS-011 is PARTIALLY FIXED** (Agent 1 said FIXED; parser resource exhaustion remains as SEC-002), and **ISS-025's original Medium severity was understated** (it is now SEC-001, P0). Where an item maps to a current finding, the finding ID is given; section 7 carries the details.

| ID | Original title (short) | Orig. sev. | Disposition | Current evidence | Method |
|---|---|---|---|---|---|
| ISS-001 | Document delete never deletes Pinecone vectors | Critical | FIXED (live Pinecone delete-by-metadata not verified) | `document.service.ts:288-324` soft-marks, deletes vectors via ai-service, rolls back with 503; worker removes vectors if the document disappears mid-job; runtime rows 137-139 show rollback | S + T + R |
| ISS-002 | `POST /api/documents` accepts client-owned URL/text fields | High | FIXED | `document.controller.ts:141-153` builds server-owned fields; URL guard before `window.open`; runtime row 95 and Agent 3 mass-assignment probe | S + T + R |
| ISS-003 | Join modal sends wrong payload; frontend build fails | High | FIXED | `workspace.store.ts:128-133` sends `{inviteCode}`; frontend `tsc -b` passes | S + R |
| ISS-004 | Assignee saved as display name | High | FIXED | Picker uses `member.userId`; server `assertAssigneesAreMembers`; runtime rows 49-51 | S + T + R |
| ISS-005 | Non-atomic refresh rotation; identical tokens; no cross-tab sync | High | FIXED | Random `jti`; atomic claim + 10 s grace; client single-flight coordinator; runtime rows 12-17 (concurrent refresh: exactly one 200) | S + T + R |
| ISS-006 | At-most-once embedding queue; stuck `indexing` | High | FIXED (residual stall tracked as ISS-037) | Claim with fencing, bounded retries, periodic sweep; runtime rows 126-136, 184 | S + T + R |
| ISS-007 | No effective tests or CI | High | FIXED (CI gaps now ARC-005) | 20 test files import real modules; CI on `develop`/`main` with MongoDB; 239/239 pass | R |
| ISS-008 | Working tree depends on untracked files; `docs` ignored | High | PARTIALLY FIXED | All code tracked; clean clone compiles. `.gitignore:40` still ignores `docs` | R + S |
| ISS-009 | No roles, no member removal, permanent invite codes | High | STILL OPEN (now SEC-010; also product scope) | `Workspace.ts` `members: string[]`; no remove/role/leave routes; any member deletes boards and documents (runtime by Agent 3) | S + R |
| ISS-010 | Client errors mapped to 500 | Medium | FIXED | `error.middleware.ts:60-93` maps 400/409/413/503; runtime rows 26, 87, 88, 125 | T + R |
| ISS-011 | Weak upload filter; vulnerable parsers; DoS | Medium | **PARTIALLY FIXED** (corrected from FIXED) | Extension, magic-byte, empty and size checks fixed (runtime rows 81-91). Parser resource exhaustion remains: SEC-002 | T + R |
| ISS-012 | Membership check: no timeout, errors as 403 | Medium | FIXED (sibling gap ARC-004) | Shared checker: 400 / 3 s timeout / 503; runtime rows 165-167 | T + R |
| ISS-013 | DB fallback URI; ai-service runs without Mongo; no graceful shutdown | Medium | FIXED | No fallback; exit without Mongo (runtime row 170); graceful shutdown (rows 176-181) | S + T + R |
| ISS-014 | Redis producer stops reconnecting; ai-service exits without Redis | Medium | FIXED | Reconnect forever with capped backoff; runtime rows 148-151, 173 | S + T + R |
| ISS-015 | SSE generation not aborted on client disconnect | Medium | STILL OPEN | `query.controller.ts:73-103` has no `close` handler | S |
| ISS-016 | Truncated SSE stream shown as complete | Medium | FIXED | Client marks streams without terminal event incomplete; gateway ends response on upstream abort (runtime row 157) | T + R |
| ISS-017 | Wrong `npm start` paths | Medium | FIXED | Start scripts point at `dist/services/<svc>/src/server.js`; all six services started this way | R |
| ISS-018 | Non-atomic, non-idempotent bulk tasks | Medium | FIXED (new defect RT-004) | All-or-nothing with compensation and unique index; runtime rows 66-73 | T + R |
| ISS-019 | "Open in Kanban" link dead-ends | Medium | FIXED | `MeetingSummarizerPage.tsx:679` links `/dashboard/tasks` | S |
| ISS-020 | DOCX card click does nothing | Medium | FIXED | `DocumentCard.tsx:30-42` opens DOCX via URL guard | S |
| ISS-021 | Tokens in localStorage, no httpOnly cookie | Medium | STILL OPEN (now SEC-008) | `auth.store.ts:85-95`; gateway CSP disabled | S |
| ISS-022 | Prompt-injection exposure | Medium | STILL OPEN (now SEC-011) | `context.service.ts:17-29`, `rag.prompt.ts:21-39` | S |
| ISS-023 | Public Cloudinary delivery, guessable `public_id` | Medium | STILL OPEN (now SEC-005) | `document.service.ts:18-38`; real data: 67 of 67 URLs public | S + R |
| ISS-024 | 0.0.0.0 binding, refresh unthrottled, no `trust proxy`, fail-open, wildcard CORS | Medium | PARTIALLY FIXED | Redis-backed per-route/per-user limiters added. Open: SEC-003, RT-001, SEC-004, SEC-015, SEC-021, SEC-025, RT-008 | S + R |
| ISS-025 | Compose exposes Mongo/Redis/mongo-express with weak defaults | Medium (understated) | PARTIALLY FIXED (now SEC-001, P0) | Compose uses variables with defaults; ports still 0.0.0.0, Redis unauthenticated, root `.env` name mismatch; default credentials verified working | S + R |
| ISS-026 | 47 dependency advisories | Medium | STILL OPEN (reduced; now SEC-022) | 30 advisories (2 critical, 14 high) | R |
| ISS-027 | Embedding model drift; model not recorded | Medium | PARTIALLY FIXED | Pinned `voyage-3`, dimension check, model stored per vector. Open: retrieval does not compare model; ADR-0004 says voyage-4 | S + T |
| ISS-028 | No relevance threshold; unvalidated queries | Medium | PARTIALLY FIXED | Validation fixed (runtime rows 105-110). Open: no score threshold | S + T + R |
| ISS-029 | Weak citation provenance | Medium | PARTIALLY FIXED | UI resolves file names. Open: no title/page metadata, ObjectId labels in prompt, page markers stripped | S |
| ISS-030 | Brittle meeting summarizer | Medium | PARTIALLY FIXED | Nulls normalised, `max_tokens` + truncation rejection, ISO dates. Open: no JSON mode; summary not persisted | S + T |
| ISS-031 | Documentation untruthful / not bootable | Medium | PARTIALLY FIXED | Docs rewritten. Residuals: ADR-0004 lines 49, 61, 63; README:60 (ARC-012); `.gitignore:40` | S |
| ISS-032 | Shared code not packages; undeclared dependencies | Medium | STILL OPEN | `packages/shared` has no `package.json`; auth/workspace/gateway/task/ai rely on hoisted deps; consequence RT-005 | S + R |
| ISS-033 | `INTERNAL_SERVICE_TOKEN` absent; members shown as "Researcher" | Medium | PARTIALLY FIXED | Documented in `.env.example`; silent substitution remains (ARC-004); local auth/workspace `.env` lack the token (SEC-018) | S + R |
| ISS-034 | Document status not live; no failure reason | Medium | FIXED | `documentPollInterval`; `embeddingError` stored | T |
| ISS-035 | Right-panel question dropped | Medium | FIXED | `RightContextPanel.tsx:79` passes `initialQuery` | S + T |
| ISS-036 | Invite code case mismatch | Medium | FIXED | Client uppercases; server normalises; runtime row 33 | T + R |
| ISS-037 | Voyage: no timeout, nested retries, no SSE heartbeat | Medium | STILL OPEN | LangChain Voyage `fetch` has no signal; a hung call blocks the only in-process consumer | S |
| ISS-038 | Fake status, dead controls, wrong metric | Low | FIXED | Fake card removed; bell disabled; metric corrected | S |
| ISS-039 | Client register validation weaker than server | Low | STILL OPEN | Client name `min(1)`, password length only; server `min(2)` plus letter/digit | S |
| ISS-040 | Logout after expiry does not revoke | Low | FIXED | Sign-out renews before revoking; runtime rows 19-24 | T + R |
| ISS-041 | Envelope/status codes deviate from README | Low | PARTIALLY FIXED | README now documents the real envelope; no `error.code` (documented design choice) | S |
| ISS-042 | Concurrent join duplicates member | Low | FIXED | Single conditional update; runtime rows 34-35 | T + R |
| ISS-043 | Unbounded lists, no pagination | Low | STILL OPEN | `document.service.ts:201-212`, `task.service.ts:364-386`, `board.service.ts:31-37` | S |
| ISS-044 | No request IDs; static health | Low | PARTIALLY FIXED | Service health reports Mongo/Redis; gateway `/health` static (runtime row 142); no request IDs | S + T + R |
| ISS-045 | RefreshToken index change without migration | Low | NOT REPRODUCIBLE | User's auth DB has only the expected indexes; 0 legacy rows | R |
| ISS-046 | No cross-service lifecycle (workspace/user delete) | Low | STILL OPEN (product scope) | No workspace or user delete; no namespace cleanup | S |
| ISS-047 | Duplicated JWT verifiers and guards; unused auth Redis | Low | PARTIALLY FIXED | Membership checker unified; still 4 JWT verifiers, 2 internal guards, unused auth Redis (RT-009) | S + R |
| ISS-048 | Roadmap features not built | Low | STILL OPEN (product scope) | No agent, chat, notifications, analytics, deployment | S |
| ISS-049 | Signed token without `userId` accepted | Low | STILL OPEN (now part of SEC-019) | No `userId` presence check in authenticate implementations; runtime: 200 with 0 rows | S + R |
| ISS-050 | Miscellaneous hygiene | Low | STILL OPEN | bcrypt cost 10; no iss/aud; public stale Swagger; pdf.js worker from unpkg; workspace-wide AI history; no workspace-name max | S + R |
| ISS-051 | ESLint not enforced; tsconfig duplication | Low | STILL OPEN | 42 problems; `tsconfig.node.json` includes `src` and shares a build-info file; notification-service not typechecked | R + S |
| ISS-052 | Document delete/retry fail silently | Low | FIXED | Action-error banner and busy guard | S |

**Totals (52):** FIXED **23** · PARTIALLY FIXED **13** · STILL OPEN **15** · NOT REPRODUCIBLE **1** · REGRESSED **0** · NOT VERIFIED **0**. ISS-001's FIXED status depends on Pinecone delete-by-metadata, which was never exercised against a live index (section 23).

**Documentation items from the old audit (DOC-xxx), current state:** DOC-001, 006, 018, 021, 022, 028, 029 fixed. DOC-002 (a remaining "Joi validators" mention at README:2231), DOC-003/004/005 (README compose example still uses `./apps/*` and ports 3000 to 3006), DOC-008 (ADR-0004 body says voyage-4), DOC-015 and DOC-016 (ADR-0004 lines 49, 61, 63 under correction notes) are partial. DOC-036 (`docs` git-ignored) remains. New: README:60 overstates SSE abort handling (ARC-012).

---

## 7. Current P0 to P4 findings

### 7.1 Summary

| Severity | Count | IDs |
|---|---|---|
| P0 | 1 | SEC-001 |
| P1 | 2 | SEC-002, SEC-003 |
| P2 | 5 | RT-001, SEC-005, SEC-006 (merged with ARC-007), SEC-010, ISS-037 |
| P3 | 31 | ARC-001 to ARC-006; RT-002, RT-003, RT-004, RT-005, RT-006, RT-008; SEC-004, SEC-007, SEC-008, SEC-009, SEC-011, SEC-012, SEC-013, SEC-014, SEC-022; REQ-128; ISS-015, ISS-027, ISS-028, ISS-029, ISS-030, ISS-032, ISS-043, ISS-044, ISS-051 |
| P4 | 29 | ARC-008 to ARC-013; RT-007, RT-009, RT-010, RT-011; SEC-015 to SEC-021, SEC-023, SEC-024, SEC-025; REQ-082; ISS-008, ISS-031, ISS-039, ISS-041, ISS-046, ISS-047, ISS-048, ISS-050 |
| **Total** | **68** | |

By source: 12 ARC entries (ARC-007 is merged into SEC-006), 11 RT, 25 SEC, 2 REQ defects, 18 historical ISS items with no newer equivalent. ISS-046 and ISS-048 are product-scope tracking items; they are listed for completeness and excluded from the stabilization roadmap.

**Historical items carried by a newer finding** (not repeated as separate entries):

| Historical | Disposition | Carried by |
|---|---|---|
| ISS-009 | STILL OPEN | SEC-010 |
| ISS-011 | PARTIALLY FIXED | SEC-002 |
| ISS-021 | STILL OPEN | SEC-008 |
| ISS-022 | STILL OPEN | SEC-011 |
| ISS-023 | STILL OPEN | SEC-005 |
| ISS-024 | PARTIALLY FIXED | SEC-003, RT-001, SEC-004, SEC-015, SEC-021, SEC-025, RT-008 |
| ISS-025 | PARTIALLY FIXED | SEC-001 |
| ISS-026 | STILL OPEN | SEC-022 |
| ISS-033 | PARTIALLY FIXED | ARC-004, SEC-018 |
| ISS-049 | STILL OPEN | SEC-019 |

Current severities for historical items are assigned in this report for the residual defect only; the original severity is in section 6.

### 7.2 Severity re-grades and recorded disagreements

| Item | Original agent position | Agent 5 position (applied) |
|---|---|---|
| SEC-003 severity | P2 (Agent 3) | **P1**: unlimited registration multiplied by the uncapped AI path defeats every AI cost control, and unlimited password guessing defeats the only brute-force control |
| RT-002 severity | P2 (Agent 2) | **P3**: no data impact (claim/fencing makes a zombie worker harmless), detectable via `/health` |
| SEC-002 magnitude | 213 s event-loop block, RSS to 1.2 GB (Agent 3) | **11.7 s per 19 KB file, about +0.5 GB RSS per upload, heap-limit crash demonstrated**. Agent 3's figure was a contention artefact on a memory-starved host. Severity P1 agreed; the crash threshold (about 150 to 200 KB, extrapolated) is lower than Agent 3 stated |
| SEC-022 zod reachability | Flagged zod copies not used for request validation (Agent 3) | **Wrong**: ai-service's built validator resolves zod 3.25.76, the flagged copy (RT-005). Not practically exploitable (no constrained arrays in user-input schemas; 100 KB body cap) |
| RT-001 root cause | SUSPECTED (Agent 2) | **CONFIRMED** by the logged `MaxRetriesPerRequestError` |
| SEC-001 LAN reachability confidence | Medium (Agent 3) | **High**: effective firewall evaluation plus successful connects through the host's LAN address; a second-host test is still missing |
| api-gateway module status | COMPLETE (Agent 1) | **PARTIAL** (SEC-003, RT-001, RT-003) |
| ISS-011 disposition | FIXED (Agent 1) | **PARTIALLY FIXED** (SEC-002) |
| ISS-025 severity | Medium (historical) | Understated; now SEC-001 (P0) |
| REQ-134, REQ-023 | COMPLETE (Agent 4) | **PARTIAL** (insecure compose defaults; gateway static health, Redis brown-out, swallowed listen errors) |
| ARC-007 vs SEC-006 | P3 (Agent 1) vs P2 (Agent 3) | **One item, P2 while SEC-001 is open**, P3 once Redis is private and authenticated |
| REQ-015 evidence | "No 429 evidence" (Agent 4) | 429s observed at runtime on canonical paths; still no regression test; status PARTIAL unchanged |
| REQ-001/002/006/029/147 | NOT VERIFIED (Agent 4) | Status unchanged (UI journey not run); annotated "backend runtime-verified" |
| REQ-064 | Server SSE never run (Agent 4) | SSE error path runtime-verified; success path still unverified |
| REQ-038/039 vs SEC-002 | COMPLETE | COMPLETE functionally, linked to SEC-002 robustness defect |
| U1 SEC-001 exploitation from another host | — | UNRESOLVED (no second host) |
| U2 live-provider journeys | — | UNRESOLVED / NOT VERIFIED by all agents |
| U3 browser behaviour (REQ-128, ARC-002, ARC-003, refresh UX) | — | UNRESOLVED (static evidence only) |
| U4 SEC-010 security vs product scope | P2 security (Agent 3) vs product scope (Agent 1) | UNRESOLVED by design: it is both; product owner decides before any multi-user release |
| Parallel feature branches during prerequisites | Agent 5 proposed allowing isolated feature branches to proceed in parallel with the prerequisites | **Lead decision: prerequisites come first** (section 27). Recorded as an unresolved disagreement |

### 7.3 P0 findings

#### SEC-001: Real MongoDB, mongo-express and Redis exposed on all interfaces with default or no credentials
- **Severity:** P0 · **Category:** Infrastructure / secrets · **Module:** `docker-compose.yml`; running `researchmind-*` containers; host firewall
- **Description:** MongoDB publishes 27017 with the root user and the compose default password; mongo-express publishes 8081 with default basic auth; Redis publishes 6379 with no password and protected mode off. All bind `0.0.0.0` and `[::]`. Docker Desktop's inbound Allow rules apply to the Public profile, and the host's active Wi-Fi profile is Public. All five service `.env` Mongo URIs connect as the root user with the default password (see SEC-014). The root `.env` uses `MONGO_ROOT_USER` instead of `MONGO_ROOT_USERNAME`, so compose silently uses its default user.
- **Evidence:** `docker-compose.yml:17-63`; `docker port`/`netstat` show `0.0.0.0`/`[::]` listeners owned by `com.docker.backend`; in-container boolean comparisons: credentials equal compose defaults; authenticated `ping` with the default works; Redis `CONFIG GET` shows empty `requirepass`, `protected-mode no`, `bind * -::*`; `Get-NetConnectionProfile` Public; effective firewall default Block overridden by "Docker Desktop Backend" Allow rules, 0 Docker block rules. Through the host's own LAN address, TCP connects to 27017, 6379 and 8081 succeed, and mongo-express returns 401 without and 200 with the default credentials (Agent 5). Exposed data (aggregate): 260 user accounts (254 match test patterns), 67 documents with full extracted text, 221 workspaces, 285 tasks, 43 AI sessions.
- **Reproduction:** From another host on the same network, connect to MongoDB with the compose default credentials, run `redis-cli -h <host> PING`, or open `http://<host>:8081` with the default basic auth. Not executed from a second host (none available); executed via the host's LAN address.
- **Expected:** Infrastructure bound to `127.0.0.1`, non-default credentials, Redis authentication, least-privilege database users.
- **Actual:** Reachable on every interface with publicly documented credentials.
- **Impact:** Anyone on the network can read or modify all data (password hashes, document text, workspaces, tasks), inject embedding jobs (SEC-006) or drop databases.
- **Root cause:** CONFIRMED (configuration). Exploitation from a second host: SUSPECTED, high confidence.
- **Remediation:** Publish ports as `127.0.0.1:<port>:<port>`; set non-default `MONGO_ROOT_PASSWORD` and mongo-express credentials and fix the root `.env` variable name; rotate credentials (recreate volumes or change users); enable Redis `requirepass` or ACLs and update every `REDIS_URL`; remove mongo-express or bind it to localhost; create one MongoDB user per service with `readWrite` on its own database (SEC-014); switch the network profile to Private or scope the Docker firewall rule. The repository part (compose binds 0.0.0.0 and ships weak fallback credentials) is a P1 configuration defect to fix in the same change.
- **Verification:** `docker ps` shows `127.0.0.1:` bindings only; connects through the LAN address fail; `redis-cli PING` without a password returns NOAUTH; the default credentials fail; each service user cannot read another service's database.
- **Confidence:** High.

### 7.4 P1 findings

#### SEC-002: DOCX decompression and parse amplification exhausts document-service
- **Severity:** P1 · **Category:** File security / availability · **Module:** document-service (`upload.middleware.ts`, `document.service.ts:116-123`, `utils/docx-extractor.ts:18-24`)
- **Description:** Uploads are parsed synchronously in the HTTP process. mammoth/JSZip inflate the whole archive and build a DOM with no limit on decompressed size, entry count or XML node count. The 10 MB cap applies to the compressed file only.
- **Evidence (Agent 5, applied):** standalone mammoth is linear (180k paragraphs, 19 KB compressed, 6.1 MB XML: 11.5 s, 773 MB peak RSS). Through the service: a 9 KB file took 7.9 s (RSS 111 to 522 MB, 1 health timeout); a 19 KB file took 11.7 s (RSS 504 to 996 MB, 3 `/health` timeouts over 2 s); RSS was not released between uploads. With `--max-old-space-size=256` the 19 KB file produced "JavaScript heap out of memory", the process exited, the client got `ECONNRESET`, and the temp upload was left behind. Agent 3 measured 213 s and RSS to about 1.2 GB on a contended host (not reproducible; see 7.2).
- **Reproduction:** Register, create a workspace, upload a DOCX whose `word/document.xml` repeats `<w:p><w:r><w:t>a</w:t></w:r></w:p>` 180,000 times, compressed at level 9.
- **Expected:** Rejected in under 1 s, or parsed in an isolated worker with time and memory limits; `/health` stays responsive.
- **Actual:** Event loop blocked for seconds per upload, memory grows about 0.5 GB per upload and is retained, crash under a constrained heap.
- **Impact:** Any authenticated member can take document-service offline; there is no supervisor, so it stays down. Extrapolated (not run): a file of roughly 150 to 200 KB likely exceeds the default heap; on this low-memory host co-located processes are also affected. Crafted PDFs were not tested.
- **Root cause:** CONFIRMED.
- **Remediation:** Before mammoth, inspect the zip central directory and cap total uncompressed size (for example 50 MB), entry count and compression ratio; run extraction in a `worker_thread` or child process with `resourceLimits` and a timeout; cap extracted text length; clean up temp files after failures; add per-user upload rate limits.
- **Verification:** Regression test with the 19 KB / 180k-paragraph DOCX expects 413 or 422 in under 1 s with `/health` responsive throughout.
- **Confidence:** High.

#### SEC-003: Gateway rate limiters bypassed with a doubled slash (login, register, AI caps)
- **Severity:** P1 (re-graded from P2 by Agent 5) · **Category:** Authentication / abuse · **Module:** api-gateway `app.ts:75-76`, `:133-135`
- **Description:** Each limiter is mounted on an exact route. `POST /api/auth//login` does not match, but http-proxy normalises the URL when joining it to the target, so auth-service handles it as a normal login. The same applies to `//register` and `/api/ai//query`. Called directly, auth-service returns 404 for `//login`, so the gateway's forwarding creates the bypass.
- **Evidence:** Agent 3 and Agent 5 (independent): `/api/auth/login` wrong password gives 401 five times then 429; `/api/auth//login` gives 401 eight times, never 429, and the correct password then returns 200 with a token; `///login` is also unlimited; `/login/`, upper-case and `/./` variants are limited; `/api/auth//register` returned 201 five times (limit 3 per hour) and the bypassed requests were not counted; `/api/ai/query` 200 thirty times then 429, while `/api/ai//query` returned 200 ten more times after the cap.
- **Reproduction:** As above against a gateway with Redis.
- **Expected:** Every path variant is limited (or rejected).
- **Actual:** Unlimited password guessing per IP, unlimited registration, AI per-user caps bypassed (only the general 100 per minute remains).
- **Impact:** Credential stuffing, account spam, and LLM/embedding cost exhaustion (unlimited accounts multiplied by 100 requests per minute each).
- **Root cause:** CONFIRMED.
- **Remediation:** Before routing, reject (400) or normalise any path containing repeated slashes or dot segments; or mount limiters by prefix on the normalised path; add per-account login throttling in auth-service.
- **Verification:** Regression tests with a real Redis: every variant (`//`, `///`, trailing slash, case, dot segments) on login, register and AI routes returns 429 or 400 once the limit is reached.
- **Confidence:** High.

### 7.5 P2 findings

#### RT-001: A Redis outage turns fail-open rate limiting into 9 to 31 s of added latency per request
- **Severity:** P2 (promoted to a development prerequisite by lead decision) · **Category:** Reliability / availability · **Module:** `services/api-gateway/src/middlewares/rate-limit.middleware.ts`
- **Description:** Limiters are configured to fail open and the code comment promises fast failure, but while Redis is down every limited request waits for the store command to fail. AI routes pass through two limiters and pay twice. Routes without a limiter are unaffected.
- **Evidence:** Agent 2: three sequential `GET /api/workspaces` took 10.4, 14.4, 16.1 s; five concurrent about 15 s each; `POST /api/ai/query` 31.4 s (first run exceeded a 30 s client timeout); `GET /api/auth/me` 163 ms; 258 ms after recovery. Agent 5 (Redis down via TCP proxy): 9.2 to 15.5 s for workspaces, 30.8 s for AI query, 15.2 s for login, 27 ms for `/me`, 21 ms when back up; log shows `MaxRetriesPerRequestError: Reached the max retries per request limit (which is 2)`.
- **Reproduction:** Run the gateway against a Redis, stop Redis (or the proxy), time limited routes.
- **Expected:** Requests forwarded in well under 1 s while Redis is unavailable.
- **Actual:** 9 to 31 s added per request.
- **Impact:** A Redis blip becomes an API-wide brown-out; SSE answers start 30 s late or the client gives up.
- **Root cause:** CONFIRMED: ioredis keeps the offline queue with `maxRetriesPerRequest: 2`, default reconnect backoff and no `commandTimeout`; each command waits for two to three reconnect cycles.
- **Remediation:** Skip the store immediately when the limiter client is not `ready` (custom `skip` or wrapper store); set `commandTimeout` around 250 to 500 ms; keep the offline queue only until the first `ready`. Decide separately whether auth limiters should fail closed (SEC-025).
- **Verification:** Outage-latency regression test: with Redis down, limited routes respond in under 1 s; with Redis back, limits apply again.
- **Confidence:** High.

#### SEC-005: Documents stored as public, unauthenticated Cloudinary assets
- **Severity:** P2 · **Category:** File security / data exposure · **Module:** `document-service/src/services/document.service.ts:18-39`, `:235-262`; frontend `DocumentCard.tsx:36-40`, `PdfViewerModal.tsx:34`
- **Description:** Uploads use the default public delivery type; `public_id` is `Date.now()-originalname` (partly guessable); the URL is given to every member and opened directly, bypassing application authorization; a failed `destroy` is only logged, so the file stays public after deletion.
- **Evidence:** Code as cited. Real data (aggregate): 67 of 67 document URLs are public `upload` delivery (58 image, 9 raw), 0 authenticated or private.
- **Reproduction:** Open a document's `cloudinaryUrl` in a private window with no session. Inferred from the delivery type; no real URL was fetched.
- **Expected:** Authenticated or private delivery, served via short-lived signed URLs after a membership check.
- **Actual:** Permanent public URLs.
- **Impact:** Anyone who obtains a URL (forwarded link, browser history, logs, former collaborators) can read the document indefinitely.
- **Root cause:** CONFIRMED (code and data).
- **Remediation:** Upload with `type: "authenticated"` and a random `public_id`; add `GET /api/documents/:id/file` returning a signed short-lived URL after membership; migrate existing assets; retry or sweep failed destroys.
- **Verification:** An unsigned URL returns 401/404; signed URLs expire; integration test for the file endpoint's membership check.
- **Confidence:** High.

#### SEC-006: Embedding jobs carry full document text through Redis, and the worker trusts it (merged with ARC-007)
- **Severity:** P2 while SEC-001 is open; P3 once Redis is private and authenticated (Agent 5 resolution C8) · **Category:** RAG / data integrity / operational · **Module:** `document-service/src/queues/embedding.queue.ts:5-21`, `services/document.service.ts:166-172`, `:597-613`; `ai-service/src/workers/embedding.worker.ts:137-180`
- **Description:** Each job contains the entire `extractedText`. The worker claims the document, checks that the claimed workspace matches the job, then embeds the job's text as given. The sweep can enqueue up to 100 such jobs per run. Anyone with Redis access can read queued document text or push a job for any `pending`/`failed` document id with arbitrary text, poisoning that workspace's index while answers stay attributed to the legitimate document. Cross-workspace injection is refused (runtime row 130). ARC-007 (Agent 1) describes the same design from the memory-pressure angle.
- **Evidence:** Code as cited; real Redis has no password and is LAN-reachable (SEC-001); queue empty at inspection.
- **Reproduction:** Not executed against real Redis (it would be a write); statically clear; a forged cross-workspace job was refused at runtime.
- **Expected:** Queue carries the document id only; the worker fetches text over the authenticated internal API after the claim.
- **Actual:** Text carried and trusted from the queue; a second plaintext copy of every queued document in Redis.
- **Impact:** Content disclosure and integrity loss of RAG answers; Redis memory pressure.
- **Root cause:** CONFIRMED (design).
- **Remediation:** Pointer-only jobs; return text and workspace from the claim response (or a new internal endpoint); secure Redis (SEC-001).
- **Verification:** Unit test: an injected job with forged text produces vectors from the stored text; `LRANGE` of the queue after an upload shows small id-only payloads.
- **Confidence:** High.

#### SEC-010: No role model, no member removal, no invite rotation
- **Severity:** P2 (also product scope S7/S8; disagreement U4 unresolved) · **Category:** Authorization · **Module:** `workspace-service/src/routes/workspace.routes.ts`; document and task delete handlers
- **Description:** Every member can delete any document (with vectors and file) and cascade-delete boards and their tasks. The permanent invite code is visible to all members. Members cannot be removed and cannot leave.
- **Evidence:** Agent 3 runtime: after joining, member B deleted A's document (200) and cascade-deleted A's board (200); `DELETE /api/workspaces/:id/members/:userId` returns 404 (route absent). Real data: 221 workspaces whose invite codes cannot be rotated.
- **Reproduction:** Join a workspace by code, then delete another member's document or board.
- **Expected:** Owner/admin roles for destructive operations; member removal; invite rotation and expiry.
- **Actual:** None of these exist.
- **Impact:** A leaked invite code or departing collaborator keeps permanent access to all documents and AI history; any member can destroy shared data.
- **Root cause:** CONFIRMED (design).
- **Remediation:** Add `role` to membership; restrict destructive routes to owner/admin; add remove-member, leave and rotate-invite endpoints; optional expiry or single-use invites.
- **Verification:** Integration tests: non-admin delete returns 403; a removed member loses access immediately; the old invite code fails after rotation.
- **Confidence:** High.

#### ISS-037: Embedding provider calls have no timeout; a hung call stalls the only in-process consumer
- **Severity:** P2 (original Medium retained) · **Category:** Reliability · **Module:** ai-service embedding (`embedding.service.ts:28-33`, `query-embedding.service.ts:37-41`, LangChain `@langchain/community/.../embeddings/voyage.cjs:104`)
- **Description:** LangChain's Voyage client calls `fetch` with no abort signal or timeout. Document embedding backs off 20 s / 40 s, query embedding 15 s / 30 s. There is no SSE heartbeat. ai-service runs a single in-process consumer, so one hung provider call blocks indexing for all workspaces until restart (shutdown waits up to 30 s).
- **Evidence:** Static reading of the cited lines (Agent 1). Not exercised at runtime (no slow provider stub was run).
- **Reproduction:** Point the Voyage base URL at a server that accepts and never responds, then upload a document.
- **Expected:** Each provider call bounded (for example 30 s), the job fails with a reason, and the worker moves on; SSE clients receive heartbeats.
- **Actual:** Unbounded wait.
- **Impact:** Indexing stalls silently; SSE clients may time out during long embedding waits.
- **Root cause:** CONFIRMED (static).
- **Remediation:** Wrap embedding calls with `AbortSignal.timeout` (custom fetch or `Promise.race`); add a worker watchdog; send SSE comment heartbeats every 15 s.
- **Verification:** Test with a hanging stub: the job fails within the timeout and the next job is processed.
- **Confidence:** High.

### 7.6 P3 findings

#### ARC-001: Unused metadata-only `POST /api/documents` creates file-less documents that the sweep keeps re-queuing
- **Severity:** P3 · **Category:** Dead endpoint / data integrity · **Module:** document-service
- **Description:** Any member can create a document with no file and no text. No frontend code calls the route. The sweep re-queues it after 10 minutes; each attempt fails "Document contains no usable text"; after 3 attempts it shows as `failed` in everyone's library.
- **Evidence:** `document.routes.ts:12-17`; `document.controller.ts:143-153`; `document.service.ts:587-603`; runtime rows 95, 126-127, 184.
- **Reproduction:** `POST /api/documents` with metadata only; wait for the sweep.
- **Expected:** Route removed, or file-less records never queued. **Actual:** Junk records and three wasted worker claims each.
- **Impact:** Workspace clutter, wasted worker cycles; no data exposure.
- **Root cause:** CONFIRMED (legacy route; sweep has no content condition).
- **Remediation:** Remove the route and schema, or exclude documents without a stored file/text from the queue and sweep.
- **Verification:** Route returns 404/410; sweep test with a file-less pending document asserts it is not enqueued.
- **Confidence:** High.

#### ARC-002: RAG answers requested as Markdown/LaTeX but rendered as plain text
- **Severity:** P3 · **Category:** Frontend/backend contract, UX · **Module:** `ai-service/src/prompts/rag.prompt.ts:12-15`; `frontend/src/pages/SemanticSearchPage.tsx:290-291`
- **Description:** The system prompt asks for headers, bold, tables and `$$` LaTeX; the page renders the answer in a `whitespace-pre-wrap` div. A Markdown/KaTeX renderer (`MathMarkdown.tsx`) exists but has no importer.
- **Evidence:** Cited lines; grep shows no importer.
- **Reproduction:** Ask a question whose answer contains a table or formula (needs a live LLM; not run).
- **Expected:** Prompt and renderer agree. **Actual:** Raw markup shown.
- **Impact:** Degraded readability of the main AI feature; no security impact.
- **Root cause:** CONFIRMED.
- **Remediation:** Render with `MathMarkdown` (react-markdown without raw HTML) or remove the formatting rule from the prompt.
- **Verification:** Component test rendering a fixture answer.
- **Confidence:** High (static).

#### ARC-003: Task due dates display one day early west of UTC
- **Severity:** P3 · **Category:** Bug (date handling) · **Module:** frontend Kanban (`CreateTaskModal.tsx:167`, `TaskDetailModal.tsx:236`, `KanbanPage.tsx:176-179`)
- **Description:** A date-only input is stored as UTC midnight and displayed with local `toLocaleDateString()`.
- **Evidence:** With `TZ=America/Los_Angeles`, `new Date('2026-11-12T00:00:00.000Z').toLocaleDateString('en-US')` gives `11/11/2026` (executed).
- **Reproduction:** Set the OS timezone to UTC-5, create a task due 12 Nov; the card shows 11 Nov.
- **Expected:** The chosen calendar date everywhere. **Actual:** Off by one day for negative UTC offsets.
- **Impact:** Wrong deadlines for some users.
- **Root cause:** CONFIRMED.
- **Remediation:** Format with `timeZone: "UTC"` or store date-only strings.
- **Verification:** Unit test of the display helper under a negative-offset timezone.
- **Confidence:** High.

#### ARC-004: Member hydration (workspace to auth) has no timeout and degrades silently
- **Severity:** P3 · **Category:** Error handling / resilience · **Module:** `workspace-service/src/services/workspace.service.ts:120-162`
- **Description:** `getWorkspaceMembers` calls auth-service `/internal/users/bulk` with plain `fetch` and no signal. If `INTERNAL_SERVICE_TOKEN` is unset or auth answers non-2xx, names silently become "Researcher" with no log line.
- **Evidence:** No signal at lines 133-140; `if (internalToken)` at 131; non-OK ignored at 142-147. Runtime with the token configured: real names returned (row 39). The user's local auth/workspace `.env` lack the token (names-only check).
- **Reproduction:** Unset the token, or point `AUTH_SERVICE_URL` at a server that never answers.
- **Expected:** 3 s timeout (as the membership checker) and a warning. **Actual:** Possible hang; silent placeholders.
- **Impact:** Unreadable assignee picker and activity history; hard to diagnose.
- **Root cause:** CONFIRMED.
- **Remediation:** `AbortSignal.timeout(3000)`; log once on missing token or non-OK; consider requiring the token at startup.
- **Verification:** Unit tests with a stub that never answers and one that answers 401.
- **Confidence:** High.

#### ARC-005: CI quality gates incomplete, and CI has never been green
- **Severity:** P3 (gate 4 condition; prerequisite 3) · **Category:** CI / test coverage · **Module:** `.github/workflows/ci.yml`, `tests/`
- **Description:** CI typechecks, builds and runs `npm test` with MongoDB, but has no lint step, coverage, `npm audit`, Redis service, E2E or component tests. Gateway limiters are never exercised (tests point Redis at a dead port). The workflow triggers only on push/PR to `develop`/`main`; the only run ever (2026-11-11, phase-4 branch) failed at the frontend typecheck/build; no fix-wave commit has a run, and no pull request exists.
- **Evidence:** `ci.yml:3-58`; `gh run list` shows one run, failed (`JoinWorkspaceModal.tsx` TS2345 and TS6133 errors at that commit); `gh pr list --state all` empty; no `*.tsx` tests.
- **Reproduction:** `gh run list --limit 20`.
- **Expected:** A green CI run on the current code with lint (or a ratchet), audit and coverage reporting. **Actual:** No CI evidence for the current code.
- **Impact:** Regressions in UI, routing, rate limits and lint go unnoticed; SEC-003 and RT-001 could not have been caught.
- **Root cause:** CONFIRMED.
- **Remediation:** Open a PR from `fix/wave-4` into `develop`; add lint with a baseline, coverage, a Redis service with a limiter test, and a Playwright smoke test (login, upload, ask).
- **Verification:** A green CI run on the PR showing the new jobs.
- **Confidence:** High.

#### ARC-006: Skipped MongoDB suites are invisible in the test summary
- **Severity:** P3 · **Category:** Test reliability · **Module:** `tests/helpers/test-mongo.ts`, Node test runner
- **Description:** Without `TEST_MONGO_URI`, 11 suites (69 tests) are skipped at suite level, yet the summary prints `# pass 170`, `# skipped 0` and exit 0.
- **Evidence:** 170 vs 239 tests between runs; `# SKIP TEST_MONGO_URI is not set` diagnostics only.
- **Reproduction:** `npm test` without the variable.
- **Expected:** In CI, a missing variable fails the run. **Actual:** Green run with 29% fewer tests.
- **Impact:** A CI change could silently remove all integration coverage.
- **Root cause:** CONFIRMED (suite-level skip not counted in the TAP summary).
- **Remediation:** Fail fast when `CI` is set and `TEST_MONGO_URI` is not.
- **Verification:** `CI=true npm test` without the variable exits non-zero.
- **Confidence:** High.

#### RT-002: Services log "running on port N" on EADDRINUSE and stay alive without listening
- **Severity:** P3 (re-graded from P2 by Agent 5) · **Category:** Reliability / operability · **Module:** `services/*/src/server.ts` with Express 5.2.1
- **Description:** Express 5 `app.listen` registers its callback as the `error` handler too; the callback ignores the error and logs success. The process keeps MongoDB connections and, for document/ai services, the sweep timer and the embedding worker.
- **Evidence:** Agents 2 and 5: a second workspace-service on an occupied port logged "MongoDB Connected" and "Workspace Service running on port …", held 4 Mongo connections, and `netstat` showed only the original PID listening. Express `application.js:601-603`.
- **Reproduction:** Start any service twice on the same port.
- **Expected:** Error logged, exit 1. **Actual:** False success; live non-serving process.
- **Impact:** On this host port 5000 (gateway default) is already taken by a foreign process; the gateway would claim success while another program answers. No data impact (claim/fencing protects the queue).
- **Root cause:** CONFIRMED.
- **Remediation:** `app.listen(PORT, (err) => { if (err) { log; process.exit(1); } … })` or a `server.on("error")` handler that exits.
- **Verification:** Startup test for a port conflict expects exit 1 with EADDRINUSE.
- **Confidence:** High.

#### RT-003: Gateway has no upstream timeout
- **Severity:** P3 · **Category:** Reliability · **Module:** `services/api-gateway/src/app.ts` (`createProxyMiddleware` without `proxyTimeout`/`timeout`)
- **Description:** If an upstream accepts the connection and never answers, the gateway never answers either.
- **Evidence:** Agent 2: no response after 150 s; Agent 5: no response after 90 s; no timeout option anywhere in `services/api-gateway/src`.
- **Reproduction:** Stub upstream that never responds behind a gateway; call `GET /api/ai/sessions/workspace/<id>`.
- **Expected:** 504/503 after a bounded time. **Actual:** Hang.
- **Impact:** Accumulating sockets; endless spinners.
- **Root cause:** CONFIRMED.
- **Remediation:** `proxyTimeout` (for example 30 s) on non-streaming routes mapped to 504; an idle-gap timeout for `/api/ai/query`.
- **Verification:** Re-run the stub test; expect 504 within the configured time.
- **Confidence:** High.

#### RT-004: Bulk-import `importKey` replay compares only the task count
- **Severity:** P3 · **Category:** Data integrity / API correctness · **Module:** `task-service/src/services/task.service.ts:249`, `:346` (`bulkCreateTasks`)
- **Description:** Reusing a key with different tasks of the same count returns `200 replayed:true` with the original tasks, dropping the new content. With a different count, the reply is a misleading 409 "Only part of this import exists".
- **Evidence:** Runtime row 78 (different titles submitted, originals returned) and row 70; code `if (previous.tasks.length === tasks.length) return previous;`.
- **Reproduction:** Bulk-create `{importKey:K, tasks:[A,B]}`, then `{importKey:K, tasks:[C,D]}`.
- **Expected:** 409/422 "key reused with a different payload". **Actual:** Silent replay.
- **Impact:** A client reusing keys loses action items without any error.
- **Root cause:** CONFIRMED.
- **Remediation:** Store a canonical payload hash with the import and compare before replaying; distinct mismatch error.
- **Verification:** Repeat the reproduction; expect 409/422 with a mismatch message.
- **Confidence:** High.

#### RT-005: ai-service validates requests with zod 3 while everything else uses zod 4
- **Severity:** P3 · **Category:** Build/runtime consistency, test fidelity · **Module:** ai-service packaging, `packages/validation`
- **Description:** The built shared validation under `services/ai-service/dist/packages/validation/` resolves `zod` to ai-service's nested copy 3.25.76 (a transitive dependency of `@langchain/*`). ai-service does not declare `zod`. Other services, dev mode and `npm test` use 4.6.7.
- **Evidence:** `require.resolve('zod')` from the dist folder; `package-lock.json`; runtime error messages differ ("Required", "Expected number, received string") from other services' zod 4 messages.
- **Reproduction:** Send a missing body or a string `topK` to the built ai-service.
- **Expected:** One zod major everywhere. **Actual:** Built and tested code differ; the built copy is the one flagged by `npm audit` (not practically exploitable; see SEC-022).
- **Impact:** Inconsistent errors; validation semantics can drift without any test failing.
- **Root cause:** CONFIRMED (undeclared dependency; ISS-032).
- **Remediation:** Declare `"zod": "^4.6.7"` in ai-service, or make `packages/validation` a workspace package; add a smoke test against `dist`.
- **Verification:** `require.resolve('zod')` from ai-service dist resolves 4.x; messages match other services.
- **Confidence:** High.

#### RT-006: Invalid provider credentials reported as "unreachable"; `/health` stays healthy
- **Severity:** P3 · **Category:** Operability / configuration validation · **Module:** `ai-service/src/utils/verify-pinecone.ts`; ai and document `/health`
- **Description:** When Pinecone rejects the key at startup, the service logs "Could not verify the Pinecone index at startup; continuing" and starts; `/health` checks only Mongo and Redis. Voyage, Groq and Cloudinary key errors surface only per request.
- **Evidence:** Runtime row 174 and the startup log.
- **Reproduction:** Start ai-service with an invalid Pinecone key.
- **Expected:** 401/403 is fatal or reported as degraded, distinct from a transient network error. **Actual:** Healthy while every upload, search and query fails.
- **Impact:** A misconfigured deployment looks healthy to probes.
- **Root cause:** CONFIRMED (catch-all treats every error as unreachable).
- **Remediation:** Treat 401/403 as fatal at startup, or expose provider readiness in `/health`.
- **Verification:** Bad key gives exit or degraded health.
- **Confidence:** High.

#### RT-008: Register limiter counts every request per IP; no `trust proxy`
- **Severity:** P3 · **Category:** Availability / deployment · **Module:** api-gateway `rate-limit.middleware.ts`, `app.ts`
- **Description:** Register is limited to 3 requests per hour per `req.ip`, counting 400 and 409 responses. Without `trust proxy`, every user behind a reverse proxy shares one IP: the site would allow 3 registrations per hour and share one login lockout bucket.
- **Evidence:** Runtime rows 27-29 (409, 400 and 201 each consumed a slot; the 4th got 429).
- **Reproduction:** Send four register requests from one IP within an hour.
- **Expected:** A per-client limit meaningful behind a proxy. **Actual:** 3 per hour per egress IP.
- **Impact:** Sign-up outages once deployed behind a proxy (topology unknown).
- **Root cause:** CONFIRMED (behaviour); deployment impact SUSPECTED.
- **Remediation:** Configure `trust proxy` for the deployment (after upgrading proxy-addr, SEC-022); consider counting only successful or failed registrations as intended.
- **Verification:** Requests with `X-Forwarded-For` behind the configured proxy are keyed per client.
- **Confidence:** Medium.

#### SEC-004: Every service listens on 0.0.0.0 with permissive CORS; the gateway can be bypassed
- **Severity:** P3 · **Category:** Architecture / exposure · **Module:** all `server.ts` (`app.listen(PORT)`); `document-service/app.ts:15-16`, `task-service/app.ts:16-17`, `ai-service/app.ts:12`
- **Description:** Services bind every interface and accept direct traffic; only the gateway applies rate limits. Services still verify JWTs and membership.
- **Evidence:** `netstat` showed `0.0.0.0` listeners; a direct call to document-service with a valid token returned 200 with no limiter; document-service reflects any `Origin`.
- **Reproduction:** Call a service port directly.
- **Expected:** Internal services bound to localhost or a private network. **Actual:** Directly reachable.
- **Impact:** No limits on direct calls; SEC-002 reachable without the gateway. Depends on network exposure (no deployment config exists).
- **Root cause:** CONFIRMED.
- **Remediation:** `app.listen(PORT, process.env.HOST ?? "127.0.0.1")` for internal services; explicit `CORS_ORIGIN`; network policy in deployment.
- **Verification:** `netstat` shows `127.0.0.1` for ports 5001 to 5006.
- **Confidence:** High.

#### SEC-007: Access tokens remain valid after logout and after reuse-triggered revocation
- **Severity:** P3 · **Category:** Authentication / session · **Module:** `packages/shared/auth/authenticate.ts`; `auth.service.ts:168`, `:220-234`
- **Description:** Access JWTs are stateless (15 min). Logout and reuse-triggered revocation delete only refresh records.
- **Evidence:** After logout, `GET /api/auth/me` and `GET /api/workspaces` return 200 with the old access token (Agents 2 and 3).
- **Reproduction:** Log in, log out, reuse the access token.
- **Expected:** Revoked sessions stop promptly. **Actual:** Valid until expiry.
- **Impact:** A stolen access token survives logout and the theft response.
- **Root cause:** CONFIRMED.
- **Remediation:** `sid`/`jti` in access tokens with a Redis denylist, or a per-user token version; shorter TTL (about 5 min).
- **Verification:** After logout the old access token gets 401.
- **Confidence:** High.

#### SEC-008: Access and refresh tokens in localStorage, with no CSP (historical ISS-021)
- **Severity:** P3 · **Category:** Token storage / client · **Module:** `frontend/src/store/auth.store.ts:85-94`; `api-gateway/src/app.ts:21-25`; `frontend/index.html`
- **Description:** Any script on the frontend origin can read the 7-day refresh token; no CSP limits XSS impact. The original specification requires an httpOnly, Secure, SameSite=Strict cookie (REQ-004).
- **Evidence:** Code as cited. No XSS sink found (answers render as plain text, ReactMarkdown without raw HTML, URL guard).
- **Reproduction:** Inspect `localStorage` after login.
- **Expected:** Refresh token in an httpOnly cookie scoped to the refresh route; access token in memory; strict CSP. **Actual:** Both tokens in `localStorage`.
- **Impact:** A single XSS, including in a dependency, becomes 7-day account takeover.
- **Root cause:** CONFIRMED.
- **Remediation:** Cookie transport with CSRF protection and CORS credentials (requires a deployment topology decision); CSP at the static host.
- **Verification:** No tokens in `localStorage`; CSP header present.
- **Confidence:** High.

#### SEC-009: Account enumeration via register response and login timing
- **Severity:** P3 · **Category:** Authentication · **Module:** `auth-service/src/services/auth.service.ts:37-41`, `:78-91`
- **Description:** Register on an existing e-mail returns 409 "User already exists"; login runs bcrypt only when the user exists.
- **Evidence:** Login average 23.8 ms (unknown e-mail) vs 1,076.6 ms (known e-mail, wrong password); absolute numbers inflated by tsx and contention, gap decisive.
- **Reproduction:** Time logins for known and unknown e-mails.
- **Expected:** Uniform responses and timing. **Actual:** Distinguishable.
- **Impact:** Confirms which e-mails have accounts; amplified by SEC-003.
- **Root cause:** CONFIRMED.
- **Remediation:** Compare against a dummy bcrypt hash when the user is absent; generic registration response or monitored rate limit.
- **Verification:** Timing difference below 10%.
- **Confidence:** High.

#### SEC-011: RAG prompt injection; document text not isolated as untrusted (historical ISS-022)
- **Severity:** P3 · **Category:** AI/RAG · **Module:** `ai-service/src/services/context.service.ts:17-29`, `prompts/rag.prompt.ts:2-39`
- **Description:** Chunk text is interpolated between plain separators; the system prompt does not mark context as untrusted. Document text can forge `[Source N]` markers and headers. Citation audit checks only that marker numbers are in range.
- **Evidence:** Static only; no LLM was called.
- **Reproduction:** Upload a document containing instructions and fake source markers; ask a related question.
- **Expected:** Context fenced with unique delimiters and labelled as data; instruction-hierarchy rule. **Actual:** Raw concatenation.
- **Impact:** Within one workspace: manipulated answers and spoofed citations for other members. No tools and plain-text rendering, so no exfiltration path today.
- **Root cause:** CONFIRMED (design).
- **Remediation:** Randomised per-chunk tags; escape tag-like sequences and source markers in chunk text; explicit "never follow instructions in documents" rule; validate citations against the cited chunk.
- **Verification:** Red-team prompt set.
- **Confidence:** Medium (impact depends on the model).

#### SEC-012: Deleted-document retrieval window, orphaned vectors, session retention
- **Severity:** P3 · **Category:** Data integrity / RAG · **Module:** `ai-service/src/services/retrieval.service.ts:5-31`, `workers/embedding.worker.ts:66-83`, `services/ai-session.service.ts`
- **Description:** Retrieval does not check document state, so a document is retrievable between the start of deletion and the vector delete (up to the 15 s cleanup timeout). If the worker's cleanup after an in-flight delete fails, vectors persist with only a log line. Nothing reconciles Pinecone against MongoDB. AI sessions keep answers derived from deleted documents.
- **Evidence:** Code as cited. Real data: 1 of 19 distinct document ids cited in AI sessions no longer exists.
- **Reproduction:** Delete a document during indexing with vector cleanup failing.
- **Expected:** Retrieval drops matches whose document is missing; periodic reconciliation. **Actual:** As described.
- **Impact:** "Deleted" content can still appear in answers; retention/compliance gap.
- **Root cause:** CONFIRMED (design); Pinecone orphans SUSPECTED (no Pinecone access).
- **Remediation:** Batch existence check on retrieved document ids; durable "vector cleanup pending" record; periodic reconciliation; redact sessions citing deleted documents.
- **Verification:** Integration test: cleanup failure followed by a later successful sweep removes vectors.
- **Confidence:** Medium-High.

#### SEC-013: No Cloudinary compensation on upload failure; colliding public ids
- **Severity:** P3 · **Category:** Data integrity / file · **Module:** `document.service.ts:18-39`, `:131-163`; `upload.middleware.ts:19-24`
- **Description:** The asset is uploaded before `Document.create`; a database failure orphans a public asset. `public_id = Date.now()-originalname` can collide across tenants in the same millisecond, and the signed-upload default overwrites.
- **Evidence:** Code. Real data: 0 shared public ids today.
- **Reproduction:** Fail the database insert after a successful upload (not executed).
- **Expected:** Random ids, `overwrite:false`, compensating destroy. **Actual:** Orphan and overwrite possible.
- **Impact:** Orphaned public files; rare cross-tenant overwrite.
- **Root cause:** CONFIRMED (code); collision not reproduced.
- **Remediation:** UUID `public_id`, `overwrite:false`, try/catch with destroy, orphan sweep.
- **Verification:** Unit test with a failing create asserts destroy is called.
- **Confidence:** Medium.

#### SEC-014: Every service connects to MongoDB as the root user with the default password
- **Severity:** P3 · **Category:** Secrets / least privilege · **Module:** `services/*/.env` (real configuration)
- **Description:** All five data services use the root user with `authSource=admin`.
- **Evidence:** Boolean-only checks of the real configuration.
- **Reproduction:** `db.getUsers()` per database (only root exists).
- **Expected:** One user per service with `readWrite` on its own database. **Actual:** Shared root.
- **Impact:** Database-per-service isolation (ADR 0003) is only logical; one compromised service compromises all databases; compounds SEC-001.
- **Root cause:** CONFIRMED.
- **Remediation:** Per-service users; rotate root credentials (part of prerequisite 1).
- **Verification:** Each service's credentials fail against other databases.
- **Confidence:** High.

#### SEC-022: Vulnerable production dependencies (historical ISS-026)
- **Severity:** P3 · **Category:** Dependencies · **Module:** root `package-lock.json`
- **Description:** 30 advisories: 2 critical (proxy-addr, handlebars), 14 high, 9 moderate, 5 low. Fixes available for all; shadcn and zod need major changes.
- **Evidence:** `npm audit --omit=dev --json` run by Agents 1, 3 and 5 with identical totals. Agent 5 correction: the flagged zod 3.25.76 is on ai-service's runtime validation path (RT-005), contrary to Agent 3's statement; not practically exploitable.
- **Reproduction:** `npm audit --omit=dev`.
- **Expected:** No high/critical advisories in production dependencies. **Actual:** 16 high/critical.
- **Impact:** No reachable exploit path identified; latent risk (proxy-addr becomes relevant if `trust proxy` is enabled, as RT-008 recommends).
- **Root cause:** CONFIRMED.
- **Remediation:** `npm audit fix`; upgrade express (proxy-addr) before enabling `trust proxy`; upgrade axios, react-router, @langchain packages; declare zod 4 in ai-service; re-run tests.
- **Verification:** `npm audit --omit=dev` shows 0 critical/high, tests green.
- **Confidence:** Medium (reachability is a static judgement).

#### REQ-128: Workspace-scoped Q&A deep link ignores its workspace id
- **Severity:** P3 (Agent 5 grading) · **Category:** Bug (routing) · **Module:** `frontend/src/routes/AppRouter.tsx:179`; `frontend/src/pages/SemanticSearchPage.tsx:29-30`
- **Description:** `/app/workspace/:id/search` is declared and documented as the Q&A alias, but the page uses the stored `currentWorkspace` and never reads `:id`.
- **Evidence:** Cited lines; no `useParams` (static, Agents 4 and 5).
- **Reproduction:** With workspace A selected, open a link for workspace B.
- **Expected:** Page switches to B or warns. **Actual:** Shows and queries A, labelled A, with no notice.
- **Impact:** Shared links and bookmarks query the wrong workspace (within the user's own memberships).
- **Root cause:** CONFIRMED (static).
- **Remediation:** Read `:id`, verify membership, switch the current workspace or show an error.
- **Verification:** Component/E2E test opening the link for a non-current workspace.
- **Confidence:** High (not run in a browser).

#### ISS-015: SSE generation is not aborted on client disconnect
- **Severity:** P3 · **Category:** Reliability / cost · **Module:** `ai-service/src/controllers/query.controller.ts:73-103`, `services/grok.service.ts:97-126`
- **Description:** No `close` handler; the LLM abort controller is not linked to the request. Generation continues (and the session is saved) after the client leaves. README:60 overstates this (ARC-012).
- **Evidence:** Static; `docs/reference/api.md:405` acknowledges it.
- **Reproduction:** Start a query and close the tab (needs a streaming LLM; not run).
- **Expected:** Generation aborted on disconnect. **Actual:** Continues.
- **Impact:** Wasted provider cost and rate budget.
- **Root cause:** CONFIRMED (static).
- **Remediation:** `req.on("close")` aborts the controller; decide whether partial answers are persisted.
- **Verification:** Test with a fake streaming LLM asserting abort on disconnect.
- **Confidence:** High.

#### ISS-027: Retrieval does not compare the embedding model (residual)
- **Severity:** P3 · **Category:** RAG correctness · **Module:** `ai-service/src/services/retrieval.service.ts:10-14`; `docs` ADR-0004 lines 26, 45
- **Description:** Model is pinned and stored per vector, but queries do not filter or compare `embeddingModel`; ADR-0004's body still says voyage-4.
- **Evidence:** Static.
- **Reproduction:** Change `VOYAGE_MODEL` with existing vectors and query (not run).
- **Expected:** Mismatched vectors excluded or refused. **Actual:** Silently mixed.
- **Impact:** Silent retrieval degradation after a model change.
- **Root cause:** CONFIRMED.
- **Remediation:** Metadata filter on `embeddingModel` or a startup refusal on mismatch; correct the ADR.
- **Verification:** Unit test with mixed-model matches.
- **Confidence:** High.

#### ISS-028: No relevance threshold in retrieval (residual)
- **Severity:** P3 · **Category:** RAG quality · **Module:** `ai-service/src/services/retrieval.service.ts:18-30`
- **Description:** Query validation is fixed; topK matches are used regardless of score.
- **Evidence:** Static; validation verified at runtime (rows 105-110).
- **Reproduction:** Ask an off-topic question in a workspace with documents (needs live providers).
- **Expected:** Low-score matches dropped; "no relevant documents" answer. **Actual:** Irrelevant chunks cited.
- **Impact:** Misleading citations; wasted tokens.
- **Root cause:** CONFIRMED.
- **Remediation:** Minimum score threshold calibrated on an evaluation set.
- **Verification:** Unit test with low-score matches; evaluation set.
- **Confidence:** High.

#### ISS-029: Weak citation provenance (residual)
- **Severity:** P3 · **Category:** RAG quality · **Module:** `context.service.ts:21`, `chunking.service.ts:13`, `vector-service.ts`
- **Description:** UI resolves file names, but vectors carry no title/page metadata, the prompt labels sources by ObjectId, and page markers are stripped. Page-level citation is product scope (REQ-067).
- **Evidence:** Static.
- **Reproduction:** Inspect the prompt for any query.
- **Expected:** Title and page in source metadata. **Actual:** ObjectId only.
- **Impact:** README "source plus page" unmet; harder verification by users.
- **Root cause:** CONFIRMED.
- **Remediation:** Store title and page in chunk metadata; label sources by title.
- **Verification:** Unit test of chunk metadata.
- **Confidence:** High.

#### ISS-030: Meeting summarizer has no JSON mode and is not persisted (residual)
- **Severity:** P3 · **Category:** AI robustness · **Module:** `ai-service/src/services/meeting-summarizer.service.ts`
- **Description:** Normalisation and truncation handling are fixed; the LLM is not asked for JSON response mode; summaries are not stored (persistence is also scope REQ-085).
- **Evidence:** Static plus fixture tests; runtime row 120 (502 with dummy key).
- **Reproduction:** Not reproducible without a live LLM.
- **Expected:** Provider JSON mode where supported. **Actual:** Free-form output parsed.
- **Impact:** Occasional 502s on malformed output; summaries lost.
- **Root cause:** CONFIRMED.
- **Remediation:** Enable `response_format` JSON where the provider supports it; persist summaries (scope decision).
- **Verification:** Contract test against the provider.
- **Confidence:** Medium.

#### ISS-032: Shared code is not packaged; services rely on undeclared hoisted dependencies
- **Severity:** P3 · **Category:** Build / packaging · **Module:** `packages/shared`, service `package.json` files
- **Description:** `packages/shared` has no `package.json` and is imported by deep relative paths. auth-service lacks express/cors/helmet/morgan/dotenv declarations; workspace-service lacks express/mongoose/dotenv; gateway/task/ai lack jsonwebtoken; version drift (dotenv 16/17, ioredis 5/6). RT-005 is a direct consequence.
- **Evidence:** Static reading of the package files; RT-005 runtime.
- **Reproduction:** Install a single service in isolation (`npm ci -w <svc>`), then start it (not run).
- **Expected:** Each service declares what it imports. **Actual:** Relies on hoisting.
- **Impact:** Isolated installs and per-service Docker images fail; version skew between built and tested code.
- **Root cause:** CONFIRMED.
- **Remediation:** Make `packages/shared` and `packages/validation` workspace packages; declare dependencies; align versions.
- **Verification:** Isolated install and start of each service succeeds.
- **Confidence:** High.

#### ISS-043: Unbounded list endpoints, no pagination
- **Severity:** P3 · **Category:** Scalability · **Module:** `document.service.ts:201-212`, `task.service.ts:364-386`, `board.service.ts:31-37`; AI sessions capped at 20
- **Description:** Lists return every row; AI history is hard-capped at 20 with no paging.
- **Evidence:** Static.
- **Reproduction:** Create thousands of tasks and list them (not run).
- **Expected:** Cursor pagination with indexes. **Actual:** Full scans.
- **Impact:** Latency and memory growth with data size.
- **Root cause:** CONFIRMED.
- **Remediation:** Cursor pagination plus supporting indexes; `meta` in the envelope.
- **Verification:** API tests for page size and cursor.
- **Confidence:** High.

#### ISS-044: Gateway health is static; no request IDs (residual)
- **Severity:** P3 · **Category:** Operability · **Module:** `api-gateway/src/app.ts:150-155`
- **Description:** Services report Mongo/Redis in `/health`; the gateway returns a static 200; no request-ID propagation; structured logging only in document-service.
- **Evidence:** Runtime row 142 (gateway 200 while Redis down).
- **Reproduction:** Stop Redis; `GET /health` on the gateway.
- **Expected:** Readiness reflects the limiter store and upstreams; `X-Request-ID` propagated. **Actual:** Static.
- **Impact:** Probes cannot detect a degraded gateway; no cross-service log correlation.
- **Root cause:** CONFIRMED.
- **Remediation:** Gateway readiness endpoint; request-ID middleware propagated to services and logs.
- **Verification:** Health shows Redis down; logs share a request id.
- **Confidence:** High.

#### ISS-051: Frontend lint not enforced; TypeScript project duplication
- **Severity:** P3 · **Category:** Code quality · **Module:** `frontend/`, `frontend/tsconfig.node.json`
- **Description:** ESLint reports 42 problems (38 errors, 4 warnings; mostly `no-explicit-any` and React hooks rules), not gated. `tsconfig.node.json` includes `src` instead of `vite.config.ts` and shares a build-info file with `tsconfig.app.json`. notification-service is not typechecked.
- **Evidence:** `npm run lint -w frontend` exit 1 (R).
- **Reproduction:** Run the lint command.
- **Expected:** Lint gated or ratcheted in CI. **Actual:** Not gated.
- **Impact:** Quality drift; several errors are in dead files (ARC-009).
- **Root cause:** CONFIRMED.
- **Remediation:** Fix or baseline the 42 problems; add a CI lint step; correct `tsconfig.node.json`.
- **Verification:** CI lint job green.
- **Confidence:** High.

### 7.7 P4 findings

#### ARC-008: ai-service `/health` reports 503 when Redis is down although its HTTP API does not need Redis
- **Severity:** P4 · **Category:** Operational · **Module:** `ai-service/src/routes/health.routes.ts:13-16`
- **Description:** Liveness and worker readiness are combined. **Evidence:** cited lines; runtime row 141. **Reproduction:** stop Redis, `GET /health`. **Expected:** 200 with `redis:"down"` or separate readiness. **Actual:** 503.
- **Impact:** An orchestrator would evict a working Q&A API during a Redis blip. **Root cause:** CONFIRMED. **Remediation:** split liveness/readiness. **Verification:** Redis down gives 200 liveness. **Confidence:** High.

#### ARC-009: Dead code with maintenance risk
- **Severity:** P4 · **Category:** Maintainability · **Module:** frontend, packages, notification-service
- **Description:** Unused wizard components (collect invite e-mails that are never sent), three dashboard mock cards, `MathMarkdown.tsx`, `App.css`, assets, `packages/shared-config`, 0-byte notification files, `verifyPineconeIndex`. **Evidence:** grep shows 0 importers. **Reproduction:** grep. **Expected:** deleted or wired. **Actual:** present.
- **Impact:** Lint noise; misleading building blocks. **Root cause:** CONFIRMED. **Remediation:** delete or wire up. **Verification:** grep and build. **Confidence:** High.

#### ARC-010: Deprecated APIs in use
- **Severity:** P4 · **Category:** Dependency hygiene · **Module:** `task-service/src/services/board.service.ts:69`, `task.service.ts:481`
- **Description:** Mongoose `new: true` deprecated (5 warnings per run); DEP0060 `util._extend` from the proxy chain. **Evidence:** test run warnings. **Reproduction:** `npm test`. **Expected:** no deprecation warnings. **Actual:** warnings.
- **Impact:** Breaks on a future major. **Root cause:** CONFIRMED. **Remediation:** `returnDocument: "after"`. **Verification:** clean test log. **Confidence:** High.

#### ARC-011: Single 1.56 MB JavaScript bundle
- **Severity:** P4 · **Category:** Performance · **Module:** frontend build
- **Description:** KaTeX, pdf.js and react-markdown are eagerly bundled. **Evidence:** build output 1,561.74 kB (gzip 459.65 kB), Vite warning. **Reproduction:** `npm run build -w frontend`. **Expected:** route-level chunks. **Actual:** one chunk.
- **Impact:** Slow first load. **Root cause:** CONFIRMED. **Remediation:** `lazy()` for the PDF viewer, meeting summarizer, Q&A page. **Verification:** chunk sizes. **Confidence:** High.

#### ARC-012: README claims verified SSE "abort handling"
- **Severity:** P4 · **Category:** Documentation accuracy · **Module:** `ResearchMind_readme.md:60`
- **Description:** Reads as client-abort support; only gateway end-on-upstream-abort exists (ISS-015 open). **Evidence:** README:60 vs `docs/reference/api.md:405`, `docs/architecture/security.md:241`. **Reproduction:** read. **Expected:** accurate wording. **Actual:** overstated.
- **Impact:** Misleading status. **Root cause:** CONFIRMED. **Remediation:** reword. **Verification:** docs review. **Confidence:** High.

#### ARC-013: Numeric LLM timeout settings not validated
- **Severity:** P4 · **Category:** Configuration robustness · **Module:** `ai-service/src/services/grok.service.ts:8-20`, `meeting-summarizer.service.ts:156`
- **Description:** `Number(env)` of a non-numeric value yields `NaN`; Node treats a `NaN` timer as 1 ms, so the idle watchdog would abort every stream. **Evidence:** static; listed in `docs/architecture/security.md:250`. **Reproduction:** set `LLM_STREAM_IDLE_TIMEOUT_MS=abc` (not run). **Expected:** bounded parse with defaults. **Actual:** `NaN`.
- **Impact:** Misconfiguration breaks all streams. **Root cause:** CONFIRMED (static). **Remediation:** parse with bounds as `refreshReuseGraceMs` does. **Verification:** unit test. **Confidence:** Medium.

#### RT-007: Provider errors leak into logs and the user-visible `embeddingError`
- **Severity:** P4 · **Category:** Security hygiene / information exposure · **Module:** document-service upload controller (`console.error("Cloudinary upload failed:", storageError)`), ai-service LLM error logging, worker `describeFailure`
- **Description:** A rejected Cloudinary key is echoed in logs (identifier, not the secret; only when rejected); LLM SDK errors dump provider headers including `set-cookie`; raw provider reasons are stored in `embeddingError` and shown to all members.
- **Evidence:** Agent 2 and Agent 5 logs show only dummy key identifiers; Agent 5 boolean scan of the user's existing git-ignored logs found none of the 19 credential values and no tokens; runtime row 129. **Reproduction:** upload with a bad Cloudinary key; read the log. **Expected:** redacted logs; generic user reason. **Actual:** raw errors.
- **Impact:** Credential identifiers and internal details exposed. **Root cause:** CONFIRMED. **Remediation:** log `http_code` and name only; store a user-safe reason. **Verification:** grep logs and API responses after repeating the tests. **Confidence:** High.

#### RT-009: auth-service holds an unused Redis connection and floods its log during outages
- **Severity:** P4 · **Category:** Operability · **Module:** `auth-service/src/config/redis.ts`
- **Description:** No auth route uses Redis. **Evidence:** 129 of 173 log lines were Redis errors during outage tests. **Reproduction:** stop Redis. **Expected:** no client, or one log per outage. **Actual:** log flood.
- **Impact:** Noise. **Root cause:** CONFIRMED. **Remediation:** remove the client. **Verification:** quiet log during outage. **Confidence:** High.

#### RT-010: A never-indexed document cannot be deleted while the vector store is unavailable
- **Severity:** P4 · **Category:** Resilience (design trade-off) · **Module:** `document.service.ts` delete path; `vector-cleanup.client.ts`
- **Description:** Delete always calls vector cleanup, so a document that was never claimed returns 503 and rolls back when Pinecone is unavailable. **Evidence:** runtime rows 137-139. **Reproduction:** delete with a dummy Pinecone key. **Expected:** skip cleanup when `embeddingAttempts` and `claimSequence` are 0. **Actual:** 503.
- **Impact:** Minor; fail-safe and truthful. **Root cause:** CONFIRMED. **Remediation:** skip cleanup for never-claimed documents. **Verification:** integration test. **Confidence:** Medium (on whether to change it).

#### RT-011: `POST /api/ai/search` returns a generic 500 for provider failures
- **Severity:** P4 · **Category:** Error mapping · **Module:** `ai-service/src/controllers/query.controller.ts` (`searchHandler`)
- **Description:** The SSE path and summarize return truthful 502/SSE errors for the same failure. **Evidence:** runtime row 114. **Reproduction:** search with a dummy Voyage key. **Expected:** 502/503 with the SSE message. **Actual:** 500.
- **Impact:** Low (frontend does not call it). **Root cause:** CONFIRMED. **Remediation:** map retrieval failures. **Verification:** route test. **Confidence:** High.

#### SEC-015: CORS wildcard at the gateway and origin reflection in services
- **Severity:** P4 · **Category:** Headers / CORS · **Module:** `api-gateway/src/app.ts:20`; auth, ai, document, task `app.ts`
- **Description:** `cors()` wildcard; `origin: true` when `CORS_ORIGIN` is unset (unset in the real configuration). **Evidence:** `ACAO: *` at the gateway; arbitrary origin reflected by document-service. **Reproduction:** send an `Origin` header. **Expected:** allow-list. **Actual:** any origin.
- **Impact:** Low with bearer tokens; significant if cookies are adopted (SEC-008). **Root cause:** CONFIRMED. **Remediation:** explicit allow-list. **Verification:** foreign origin not reflected. **Confidence:** High.

#### SEC-016: Swagger UI publicly served
- **Severity:** P4 · **Category:** Information exposure · **Module:** `api-gateway/src/app.ts:28`, `document-service/app.ts:21`, `task-service/app.ts:22`
- **Description:** `/api-docs/` is public and partly stale (missing several routes). **Evidence:** `GET /api-docs/` 200 without authentication. **Reproduction:** open it. **Expected:** disabled in production or authenticated. **Actual:** public.
- **Impact:** Reconnaissance. **Root cause:** CONFIRMED. **Remediation:** environment flag or auth. **Verification:** 404/401 in production mode. **Confidence:** High.

#### SEC-017: Security headers incomplete
- **Severity:** P4 · **Category:** Headers · **Module:** `workspace-service/src/app.ts` (no helmet); gateway CSP disabled
- **Description:** `x-powered-by: Express` passes through the gateway; no CSP. **Evidence:** response headers. **Reproduction:** `GET /api/workspaces`. **Expected:** helmet everywhere; header stripped. **Actual:** missing.
- **Impact:** Fingerprinting. **Root cause:** CONFIRMED. **Remediation:** helmet in workspace-service; strip header at the gateway. **Verification:** headers absent. **Confidence:** High.

#### SEC-018: `INTERNAL_SERVICE_TOKEN` missing in auth and workspace configuration; member e-mails visible to all members
- **Severity:** P4 · **Category:** Configuration / privacy · **Module:** real `.env`; `workspace.service.ts:114-163`
- **Description:** With the token missing, member hydration degrades silently (names "Researcher", empty e-mails). With it configured, every member sees every other member's e-mail. **Evidence:** boolean configuration check; runtime row 39 with the token configured. **Reproduction:** `GET /api/workspaces/:id/members`. **Expected:** token configured in all four services; e-mails shown only where needed. **Actual:** missing; e-mails to all members.
- **Impact:** Unreadable member lists today; privacy question once fixed. **Root cause:** CONFIRMED. **Remediation:** configure the token; decide e-mail visibility. **Verification:** names returned; policy documented. **Confidence:** High.

#### SEC-019: JWT hardening gaps (includes historical ISS-049)
- **Severity:** P4 · **Category:** Authentication · **Module:** `packages/shared/config/secrets.ts`, `auth-service/src/utils/jwt.ts:29-38`, `auth.service.ts:19-20`, all `authenticate` implementations
- **Description:** No `iss`/`aud`/`typ`; access/refresh secret inequality not enforced; tokens without a well-formed `userId` accepted; `REFRESH_TOKEN_EXPIRES` ignored by the stored 7-day record; several near-duplicate `authenticate` copies. **Evidence:** static; a signed token without `userId` got 200 with 0 rows (no leak). **Reproduction:** sign such a token with the secret. **Expected:** rejected. **Actual:** accepted.
- **Impact:** Low (requires the secret); defence in depth. **Root cause:** CONFIRMED. **Remediation:** typed/audience claims, secret inequality check at boot, 24-hex `userId` validation, derive stored expiry, consolidate middleware. **Verification:** unit tests. **Confidence:** High.

#### SEC-020: File signature check accepts polyglots
- **Severity:** P4 · **Category:** File validation · **Module:** `document-service/src/utils/file-signature.ts:17-25`
- **Description:** `%PDF-` anywhere in the first 1 KB passes. **Evidence:** an HTML/PDF polyglot reached the storage step. **Reproduction:** upload such a file. **Expected:** `%PDF-` at offset 0; DOCX structure check before parsing. **Actual:** accepted.
- **Impact:** Low (served from Cloudinary's domain). **Root cause:** CONFIRMED. **Remediation:** stricter signature checks. **Verification:** polyglot rejected with 415. **Confidence:** High.

#### SEC-021: No rate limiting on `/api/auth/refresh`, `/me`, `/logout`
- **Severity:** P4 · **Category:** Abuse · **Module:** `api-gateway/src/app.ts`
- **Description:** `/api/auth` sits outside the general limiter. **Evidence:** 30 invalid refresh attempts, 30 x 401, no 429. **Reproduction:** repeat refresh calls. **Expected:** per-IP limit. **Actual:** none.
- **Impact:** Low (high-entropy tokens); unthrottled load on auth-service. **Root cause:** CONFIRMED. **Remediation:** apply a per-IP limiter to `/api/auth/*`. **Verification:** 429 after the limit. **Confidence:** High.

#### SEC-023: All members can read every member's AI question history
- **Severity:** P4 · **Category:** Privacy · **Module:** `ai-service/src/services/ai-session.service.ts:34-36`
- **Description:** Sessions endpoint returns the last 20 sessions of the whole workspace. **Evidence:** static. **Reproduction:** list sessions as another member. **Expected:** per-user filter unless shared history is intended. **Actual:** shared.
- **Impact:** Privacy expectation mismatch. **Root cause:** CONFIRMED. **Remediation:** filter by `userId` or document the choice. **Verification:** route test. **Confidence:** High.

#### SEC-024: Legacy data hygiene
- **Severity:** P4 · **Category:** Data integrity · **Module:** user's MongoDB/Redis data; `services/document-service/uploads/`
- **Description:** 135 of 221 invite codes come from a legacy generator (2 are 13 characters) and cannot be rotated; unused collections (`workspacemembers` with 2 records, an empty `workspaces` in the document DB); stale temp upload files on disk; a Redis key `test` with no TTL. **Evidence:** aggregate counts. **Reproduction:** aggregate queries. **Expected:** clean data. **Actual:** as listed.
- **Impact:** Low. **Root cause:** CONFIRMED (counts); legacy generator origin SUSPECTED. **Remediation:** rotate codes once SEC-010 exists; drop unused collections after confirmation; delete stale uploads; use an OS temp directory. **Verification:** counts return 0. **Confidence:** High.

#### SEC-025: Login limiter design: per-IP only, fails open, no proxy awareness
- **Severity:** P4 · **Category:** Authentication / abuse · **Module:** `api-gateway/src/middlewares/rate-limit.middleware.ts:88`, `:100-112`
- **Description:** Keyed only by IP, skips successful requests (no per-account lockout); no limiting while Redis is down; behind a proxy every user shares one bucket. **Evidence:** static plus RT-001 runtime. **Reproduction:** distributed guessing across IPs (not run). **Expected:** account-keyed throttle; auth limiters fail closed. **Actual:** IP only, fail open.
- **Impact:** Distributed guessing not slowed. **Root cause:** CONFIRMED. **Remediation:** account-keyed limiter in auth-service; fail closed for auth limiters; correct `trust proxy`. **Verification:** tests per account. **Confidence:** High.

#### REQ-082: 50,000-character meeting notes conflict with the 100 KB JSON body limit
- **Severity:** P4 · **Category:** Validation boundary · **Module:** `packages/validation/schemas/ai.schema.ts:40-41`; `ai-service/src/app.ts:14`
- **Description:** The documented limit is 50,000 characters; `express.json()` keeps the 100 KB default; 50,000 characters of 3-byte UTF-8 text is about 150 KB. **Evidence:** cited lines; runtime row 125 (413 above 100 KB). **Reproduction:** submit 40,000 characters of Tamil or CJK text. **Expected:** accepted. **Actual:** 413.
- **Impact:** Non-English users rejected inside the documented limit. **Root cause:** CONFIRMED (by composition). **Remediation:** raise the body limit for this route to about 200 KB. **Verification:** route test with multi-byte text. **Confidence:** High.

#### ISS-008: `docs` still git-ignored (residual)
- **Severity:** P4 · **Category:** Repository hygiene · **Module:** `.gitignore:40`
- **Description:** Existing docs are force-added; new files under `docs/` are silently untracked. **Evidence:** `.gitignore:40`. **Reproduction:** create a file under `docs/`; `git status` does not show it. **Expected:** docs tracked. **Actual:** ignored.
- **Impact:** New documentation can be lost. **Root cause:** CONFIRMED. **Remediation:** remove the `docs` entry. **Verification:** `git check-ignore` returns nothing. **Confidence:** High.

#### ISS-031: Documentation residuals
- **Severity:** P4 · **Category:** Documentation · **Module:** `docs/` ADR-0004, `ResearchMind_readme.md`
- **Description:** ADR-0004 lines 26, 45 (voyage-4), 49, 61 (gateway membership claim), 63 (33-phase test suite) remain under correction notes; README:2231 mentions Joi; README:2115-2141 compose example uses `./apps/*` and ports 3000 to 3006; README:60 (ARC-012). **Evidence:** static. **Reproduction:** read. **Expected:** accurate docs. **Actual:** residual inaccuracies.
- **Impact:** Misleads readers. **Root cause:** CONFIRMED. **Remediation:** edit the cited lines. **Verification:** docs review. **Confidence:** High.

#### ISS-039: Client registration validation weaker than server
- **Severity:** P4 · **Category:** UX / validation drift · **Module:** `frontend/src/lib/validations/auth.schema.ts:15-34` vs `packages/validation/schemas/auth.schema.ts:3-16`
- **Description:** Client name `min(1)`, password length only; server name `min(2)` plus letter and digit rules. **Evidence:** static. **Reproduction:** register with a one-letter name. **Expected:** same rules client-side. **Actual:** server rejects late.
- **Impact:** Late errors. **Root cause:** CONFIRMED. **Remediation:** share or mirror the schema. **Verification:** unit test. **Confidence:** High.

#### ISS-041: No machine-readable error codes in the response envelope
- **Severity:** P4 · **Category:** API contract · **Module:** `packages/validation/validation.ts:15-19`
- **Description:** README now documents the real envelope; `error.code` and `meta` remain absent (documented design choice; REQ-020 PARTIAL). **Evidence:** static. **Reproduction:** any 400. **Expected (original spec):** `{error:{code,message,field}}`. **Actual:** `{success:false,message}`.
- **Impact:** Clients match on message text. **Root cause:** CONFIRMED. **Remediation:** add codes when external clients need them. **Verification:** contract tests. **Confidence:** High.

#### ISS-046: No cross-service lifecycle for workspace or user deletion (product scope)
- **Severity:** P4 (scope tracking) · **Category:** Product scope (S8) · **Module:** workspace-service, ai-service
- **Description:** No workspace or user delete; no Pinecone namespace cleanup. **Evidence:** static. **Reproduction:** n/a. **Expected (spec):** delete with data and namespace purge (REQ-034). **Actual:** absent.
- **Impact:** Future orphans when deletion is built. **Root cause:** CONFIRMED (not built). **Remediation:** design with S8. **Verification:** integration test of the purge. **Confidence:** High.

#### ISS-047: Duplicated verifiers and guards (residual)
- **Severity:** P4 · **Category:** Maintainability · **Module:** `packages/shared/auth/authenticate.ts`, gateway, auth-service and workspace-service middlewares; `document-service/src/middlewares/internal-auth.middleware.ts`
- **Description:** 4 JWT verifiers, 2 internal-token guards, unused auth Redis (RT-009), empty notification stubs. **Evidence:** static. **Reproduction:** grep. **Expected:** one shared implementation. **Actual:** duplicates.
- **Impact:** Divergent fixes (for example SEC-019). **Root cause:** CONFIRMED. **Remediation:** consolidate on the shared middleware. **Verification:** grep shows one implementation. **Confidence:** High.

#### ISS-048: Roadmap features not built (product scope)
- **Severity:** P4 (scope tracking) · **Category:** Product scope (S1 to S15) · **Module:** whole product
- **Description:** No AI agent, chat, notifications, analytics, literature review, report drafter or deployment. **Evidence:** section 19 (71 NOT IMPLEMENTED requirements). **Reproduction:** n/a. **Expected (spec):** built. **Actual:** absent.
- **Impact:** Scope gap versus the README; not a defect. **Root cause:** CONFIRMED (not built). **Remediation:** product planning (section 25.6). **Verification:** per-feature acceptance. **Confidence:** High.

#### ISS-050: Miscellaneous security hygiene (residual)
- **Severity:** P4 · **Category:** Hygiene · **Module:** `auth-service/src/utils/hash.ts:3`, `frontend/src/components/documents/PdfViewerModal.tsx:17`, `packages/validation/schemas/workspace.schema.ts:5-10`
- **Description:** bcrypt cost 10; pdf.js worker loaded from unpkg at runtime; workspace name has no maximum length. (Other parts are tracked as SEC-009, SEC-016, SEC-019, SEC-023.) **Evidence:** static. **Reproduction:** read. **Expected:** cost 12, self-hosted worker, bounded names. **Actual:** as listed.
- **Impact:** Minor. **Root cause:** CONFIRMED. **Remediation:** adjust each item. **Verification:** unit tests and build. **Confidence:** High.

---

## 8. Security assessment

**Overall:** the application layer is substantially stronger than the infrastructure around it. Gate 2 (Security) is **FAIL** because of one live P0 exposure and two P1 defects.

**Controls that hold (runtime-verified by Agents 2, 3 and 5)**
- JWT: HS256 pinned; `alg=none`, HS512 with the same key, expired, wrong-key and refresh-as-access tokens all rejected (401) at gateway, auth, workspace, document and task services.
- Workspace isolation: 21 cross-tenant probes returned 403, 404 or 400; by-id routes check the stored record's workspace.
- Internal routes: require a constant-time shared token; unreachable through the gateway with dot-segment and encoded traversal (404).
- Mass assignment: forged server-owned fields are ignored; `{$ne:null}` payloads rejected by zod; Express 5's simple query parser neutralises `?field[$ne]=x`.
- Refresh rotation: atomic; 6 concurrent refreshes of one token gave exactly one success; reuse within grace keeps sessions, reuse after grace revokes the family.
- Deletion: ordered and compensating; 4 concurrent deletes gave one 200 and three 404s.
- Secrets: services refuse to start with weak or known-insecure secrets and name only the variable (runtime row 171). The real `.env` secrets are at least 32 characters, not known-weak, and consistent across services (boolean checks only).
- Uploads: extension, MIME distrust, magic bytes, empty and oversize files handled (runtime rows 81-91); multer reduced a path-traversal filename to its basename.
- No XSS sink found in the frontend (plain-text answers, ReactMarkdown without raw HTML, URL guard before `window.open`).

**Problems, by severity**

| ID | Severity | Summary |
|---|---|---|
| SEC-001 | P0 | Real infrastructure on all interfaces with default credentials; Public network profile; Docker Allow rule |
| SEC-002 | P1 | DOCX parse amplification crashes document-service |
| SEC-003 | P1 | `//` bypasses login, register and AI limiters |
| SEC-005 | P2 | Public Cloudinary assets (67 of 67 real documents) |
| SEC-006 | P2 | Document text through unauthenticated Redis; worker trusts it |
| SEC-010 | P2 | No roles, removal or invite rotation |
| SEC-004, 007, 008, 009, 011, 012, 013, 014, 022 | P3 | Direct service exposure, stateless revocation, localStorage tokens, enumeration, prompt injection, deleted-document window, Cloudinary compensation, root DB user, dependencies |
| SEC-015 to 021, 023 to 025, RT-007 | P4 | CORS, Swagger, headers, config/privacy, JWT hardening, polyglots, unthrottled refresh, shared AI history, legacy data, limiter design, log leakage |

**Real infrastructure (aggregate, read-only):** databases `researchmind-ai` (aisessions 43), `researchmind-auth` (users 260, refreshtokens 0), `researchmind-document` (documents 67), `researchmind-task` (tasks 285, taskactivities 371, boards 160), `researchmind-workspace` (workspaces 221). 254 of 260 accounts match test-like patterns. Redis 7.4.9 with empty `requirepass` and protected mode off. Credentials equal compose defaults. No values were printed.

**Disagreements applied:** SEC-003 P2 to P1; SEC-001 confidence raised to High; SEC-002 magnitude restated; SEC-022 zod reachability corrected (section 7.2).

---

## 9. Authentication and authorization assessment

**Authentication**

| Control | Result | Evidence |
|---|---|---|
| Register, login, `/me` over HTTP | PASS | Runtime rows 1-8; wrong password and unknown e-mail both 401 "Invalid credentials" |
| Algorithm pinning and expiry | PASS | Agent 3 probes; rows 10-11, 159-161 (5 s access token expired, 401) |
| Refresh rotation and reuse detection | PASS | Rows 12-17; Agent 3 six-way race |
| Logout scoped to caller | PASS | Rows 19-24 (another user's bearer cannot revoke a token) |
| Access token after logout/revocation | Valid until expiry | Row 18; SEC-007 |
| Brute-force and registration limits | PASS on canonical paths; **bypassed with `//`** | Rows 27-29; SEC-003; refresh/me/logout unthrottled (SEC-021) |
| Account enumeration | Present | SEC-009 (409 on register; 24 ms vs 1,077 ms login timing) |
| Password storage | bcrypt cost 10 | 0 of 260 real hashes non-bcrypt; ISS-050 |
| Token storage in the client | `localStorage`, no CSP | SEC-008 / REQ-004 NOT IMPLEMENTED |
| Client refresh coordinator and cross-tab sync | Module tests PASS; browser NOT VERIFIED | `client-auth-refresh.test.ts` |

**Authorization**

| Control | Result | Evidence |
|---|---|---|
| Membership check (document, task, ai) | PASS: 400 malformed, 403 non-member, 503 when unavailable (fail closed) | Rows 92, 99-103, 111-112, 165-167; `workspace-membership.test.ts` |
| Workspace endpoints for non-members | PASS: 404 | Rows 40-41 |
| Cross-workspace task/board ids | PASS: 400/404 | Rows 52, 62-65 |
| Assignee must be a member | PASS | Rows 50-51, 71 |
| Roles, removal, invite rotation | ABSENT | SEC-010 (any member deletes any document or board) |
| Token without `userId` | Accepted (no data returned) | SEC-019 / ISS-049 |
| Member e-mails visible to all members | By design | SEC-018 |
| AI history visible to all members | By design | SEC-023 |

---

## 10. Data integrity assessment

Gate 3 (Data integrity) is **CONDITIONAL PASS**.

**Verified mechanisms**
- Document deletion: soft delete, vector delete, Cloudinary destroy, hard delete, with rollback (503) when vector cleanup fails (runtime rows 137-139; Agent 3 with a cleanup stub: 3 calls, correct internal token).
- Embedding jobs: atomic claim with fencing (`claimSequence`), at most 3 attempts, 15-minute stale-claim window, 5-minute sweep; forged cross-workspace jobs refused; manual reindex resets attempts (rows 126-136, 184).
- Bulk import: all-or-nothing with compensation; unique `(workspaceId, importKey, importIndex)`; three concurrent imports with one key produced exactly 2 tasks (rows 66-69).
- Join: atomic, case-insensitive, 409 for existing members including concurrent attempts (rows 33-35).
- Subtask cycles rejected (rows 57-58); parent delete removes subtasks (rows 75-76).

**Real data (aggregate):** 67 of 67 documents `indexed`; 0 with `deletedAt`, 0 stuck in `indexing`, 0 exhausted, 0 empty text; 0 shared `cloudinaryPublicId`; 0 orphan documents or tasks; 0 duplicate e-mails (case-insensitive); 0 duplicate member ids; 0 workspaces whose owner is not a member; 0 non-hex assignee ids; 1 of 19 distinct document ids cited by AI sessions no longer exists; Redis AOF off (queue loss on restart is recovered by the sweep after 10 minutes while retries remain).

**Open items:** RT-004 (silent replay of a different payload), SEC-006 (trusted queue text), SEC-012 (deleted-document retrieval window, orphaned vectors, stale citation), SEC-013 (Cloudinary compensation), ARC-001 (phantom documents), SEC-024 (legacy invite codes, unused collections), ISS-001 not verified on a live Pinecone index.

---

## 11. Document processing and RAG assessment

**Ingestion (runtime with dummy Cloudinary/Voyage/Pinecone):** every rejection path returned the documented status: 415 type, 415 MIME-only, 415 spoofed PDF, 422 spoofed DOCX, 422 empty, 422 corrupt PDF, 413 oversize, 400 field/file/workspace errors, 403 non-member. Valid PDF and DOCX uploads reached storage and returned 502 "File storage is temporarily unavailable" with no record created and no temp file left (rows 79-94). A Cloudinary 401 took 10.2 s on the first call.

**Parser robustness:** SEC-002 (P1). DOCX expansion is unbounded and in-process; crafted PDFs untested. SEC-020 polyglots (P4).

**Embedding pipeline (runtime):** worker claimed and failed an empty-text document truthfully; a job with a dummy Voyage key failed with the provider reason (RT-007: raw reason shown to members); retry limit enforced; sweep re-queued a failed document; the worker resumed BLPOP after Redis recovery within about 1 s. Two concurrent reindex requests both returned 200 and caused two processing runs (INFO; harmless given claims). Not verified: chunking quality, Voyage batching and retries against the real API, Pinecone upsert and delete-by-metadata. Open: ISS-037 (no provider timeout, P2), SEC-006 (text in queue, P2), ARC-001.

**RAG:** namespace = `workspaceId`, validated as 24-hex and used only after the membership check; vector delete scoped by namespace plus `documentId` filter. No relevance threshold (ISS-028), model not compared at query time (ISS-027), weak provenance (ISS-029), prompt injection (SEC-011), deleted-document window (SEC-012). The chunker, citation validator and the SSE success path have no tests (REQ-057, REQ-065).

**Live provider status:** Voyage, Pinecone and Cloudinary NOT VERIFIED. The happy path (upload, indexed, cited answer, session saved) is BLOCKED without real providers.

---

## 12. AI research assessment

| Capability | State | Evidence |
|---|---|---|
| Q&A request validation | PASS (runtime) | Rows 105-110 (whitespace, 2001 chars, malformed id, topK 11, string topK, missing body all 400 JSON before any stream) |
| SSE error path | PASS (runtime) | Row 104: `start` then `error` with a truthful message and `partial:false`; no fabricated tokens; no session persisted (row 117) |
| SSE truncation at the gateway | PASS (runtime) | Row 157: gateway ended the client response 1.5 s after upstream death, no terminal event |
| SSE success path (sources, tokens, done, session) | NOT VERIFIED | No live or fake LLM run |
| Client stream parsing and truncation detection | Module tests PASS; browser NOT VERIFIED | `client-ai-stream.test.ts` |
| Client disconnect | Generation not aborted | ISS-015 |
| Answer rendering | Raw Markdown/LaTeX shown | ARC-002 |
| Citations | Range-checked only; not semantically verified | SEC-011, ISS-029 |
| Session history | Workspace-wide, last 20, no pagination | SEC-023, ISS-043 |
| `/api/ai/search` | Generic 500 on provider failure (unused by the frontend) | RT-011 |
| Workspace deep link | Ignores `:id` | REQ-128 |
| Runtime validator | zod 3 in the built ai-service | RT-005 |
| Cost controls | 30/h query and search, 20/h summarize per user; bypassable | SEC-003 |
| Meeting summarizer | 502 with dummy LLM in 358 ms; 400 for short notes; 413 above 100 KB | Rows 120-125; ISS-030; REQ-082 |
| AI agent, literature review, report drafter, onboarding brief | NOT IMPLEMENTED | Product scope S1 to S3 |

---

## 13. Meeting and task workflow assessment

**Tasks and boards (runtime, rows 45-78):** board create/list, member access, non-member 403; task create with trimmed title, member assignee only (non-member and display-name assignees rejected), cross-workspace board rejected, invalid status rejected, status updates, unassign, subtasks with cycle and self-parent protection, top-level listing hides subtasks, activity log records created/assigned/status_changed/unassigned, non-empty board delete without cascade gives 409, cascade delete and parent-with-subtask delete work. Bulk import: idempotent replay, concurrent safety, 50-item cap, invalid key characters rejected, one bad assignee rejects the whole batch.

**Defects:** RT-004 (replay compares count only; misleading 409 message), ARC-003 (due date off by one west of UTC), ISS-043 (no pagination).

**Meeting workflow:** paste notes, structured JSON via LLM (live provider NOT VERIFIED), select action items, bulk-create tasks with `importKey`. Tasks arrive unassigned (REQ-079 not implemented); summaries are not persisted (REQ-085, ISS-030); multi-byte notes within the documented limit can get 413 (REQ-082).

**UI:** Kanban drag-and-drop, task modals and the meeting page are implemented but never exercised in a browser. Activity entries are displayed as raw JSON payloads (REQ-104). No `review` column or `urgent` priority (REQ-097, REQ-098); boards cannot be renamed or deleted from the UI (REQ-094).

---

## 14. Frontend assessment

| Area | Result |
|---|---|
| Typecheck and build | `tsc -b && vite build` exit 0 (68 s and 136 s in two runs) |
| Bundle | One 1.56 MB chunk (459.65 kB gzip); Vite warning (ARC-011) |
| Lint | 42 problems (38 errors, 4 warnings), not gated (ISS-051) |
| Preview | `vite preview` served `/` and deep links (200 index fallback); bundle contains the `/api` default `http://localhost:5000/api` because `frontend/.env` is absent (rows 186-188) |
| Routing | Core pages real; 5 placeholders; REQ-128 deep link broken |
| Auth/session | Tokens in `localStorage` (SEC-008); single-flight refresh with Web Locks and cross-tab sync (module tests) |
| Rendering | Plain-text AI answers (ARC-002); no XSS sink found |
| Dates | Off-by-one west of UTC (ARC-003) |
| Dead code | Wizard, mock cards, `MathMarkdown`, assets (ARC-009) |
| Client/server validation | Drift on register (ISS-039) |
| Tests | 0 component or browser tests; plain-module tests only. All browser journeys NOT VERIFIED (row 189) |
| External loads | pdf.js worker from unpkg (ISS-050) |
| Default API URL | Points at port 5000, which on this host belongs to another process; combined with RT-002 the gateway could appear to start while another program answers |

---

## 15. Backend assessment

| Area | Result |
|---|---|
| Typecheck | 6 services `tsc --noEmit` exit 0 |
| Start path | All six services built to `dist/` and started from `dist/services/<svc>/src/server.js` (ISS-017 fixed) |
| Error mapping | Documented statuses at runtime (400, 401, 403, 404, 409, 413, 415, 422, 502, 503); `/api/ai/search` 500 (RT-011) |
| Startup fail-closed | Weak secret exit 1 naming the variable; missing Voyage key exit 1; MongoDB unreachable exit 1 after about 30 s server selection; Redis unreachable: document and ai start with `/health` 503 |
| Startup defects | False success on EADDRINUSE (RT-002); invalid Pinecone key reported as unreachable while healthy (RT-006) |
| Shutdown | SIGTERM/SIGINT graceful in 1.5 to 3.2 s for all services, including ai-service with Redis down; second signal forces exit 1 |
| Resilience | Killed task-service gives fast gateway 503; workspace-service down gives fail-closed 503 in dependent services |
| Gateway | No upstream timeout (RT-003); slow fail-open (RT-001); static health (ISS-044); `//` bypass (SEC-003) |
| Packaging | Shared code not packaged; undeclared dependencies (ISS-032); zod split (RT-005) |
| Exposure | 0.0.0.0 binding, permissive CORS, public Swagger (SEC-004, SEC-015, SEC-016) |
| Hygiene | Duplicate verifiers (ISS-047), unused auth Redis (RT-009), deprecated Mongoose option (ARC-010), phantom metadata endpoint (ARC-001) |

---

## 16. Database, Redis, Pinecone and external integration assessment

| Integration | Verification in this audit | Findings |
|---|---|---|
| MongoDB (disposable) | Verified: all services, 239 tests, runtime journeys | No retry on initial connect (exit 1 by design); MongoDB runtime outage and reconnection NOT VERIFIED (shared disposable instance) |
| MongoDB (user's) | Read-only aggregate checks | SEC-001, SEC-014, SEC-024; refresh-token indexes correct (ISS-045 not reproducible) |
| Redis (disposable) | Verified: limiter, queue, outage and recovery | RT-001; reconnect and BLPOP resume work; health reports Redis correctly in document/ai |
| Redis (user's) | Read-only configuration and counts | SEC-001 (no auth, LAN-reachable), AOF off, 1 stray key |
| Pinecone | NOT VERIFIED (dummy key rejected) | Startup check continues on auth failure (RT-006); delete-by-metadata on the live index unverified (ISS-001); orphan reconciliation absent (SEC-012) |
| Voyage | NOT VERIFIED (dummy key, 401) | No timeout (ISS-037); retries only on 429 (REQ-058) |
| Groq / xAI | NOT VERIFIED (dummy key) | Error dumps include provider headers (RT-007); timeouts not exercised against a slow provider |
| Cloudinary | NOT VERIFIED (dummy credentials, 401) | Public delivery (SEC-005), no compensation (SEC-013), key identifier echoed on rejection (RT-007); credentials not validated at startup |
| GitHub Actions | Read-only history | One run ever, failed; never run on current code (ARC-005) |

---

## 17. Build, test and CI assessment

**Commands executed on `e6d68ad`** (`git status --porcelain` empty before and after)

| # | Command | Exit | Result |
|---|---|---|---|
| 1-6 | `./node_modules/.bin/tsc --noEmit -p services/<svc>` for api-gateway, auth, workspace, document, task, ai | 0 each | No diagnostics |
| 7 | `npm run build -w frontend` | 0 | Built; 1.56 MB chunk warning |
| 8 | `npm run lint -w frontend` | 1 | 42 problems: no-explicit-any 25, set-state-in-effect 6, incompatible-library 2, exhaustive-deps 2, preserve-caught-error 2, only-export-components 1, immutability 1, no-misleading-character-class 1, no-empty 1, no-unused-vars 1 |
| 9 | `npm test` (no `TEST_MONGO_URI`) | 0 | 50 suites, 170 pass, 0 fail; 11 suites skipped silently (`# skipped 0`), 156 s |
| 10 | `TEST_MONGO_URI=mongodb://127.0.0.1:27094 npm test` | 0 | 50 suites, **239 pass, 0 fail, 0 skip**; 323 s (Agent 1), 202 s (Agent 2), about 346 s (Agent 4); warnings: Mongoose `new` deprecated x5, DEP0060 x1 |
| 11 | `npm run build -w <svc>` for six services, then `node dist/services/<svc>/src/server.js` | 0 / ran | All started; used for runtime tests |
| 12 | `npm audit --omit=dev --json` | 1 | 30 advisories (2 critical, 14 high, 9 moderate, 5 low) |
| 13 | Security-relevant subset without MongoDB (Agent 3) | 0 | 78 pass, 0 fail |
| 14 | `gh run list`, `gh run view --log-failed`, `gh pr list --state all` | 0 | 1 run ever (failed); no PRs |

**Coverage of the 239 tests:** JWT pinning and expiry, refresh rotation and reuse with real MongoDB, logout; membership 400/403/503 and isolation; error mapping; upload validation and extraction errors; deletion ordering and rollback; claim, fencing and sweep; bulk import and subtask cycles; SSE pass-through and truncation; client refresh coordinator, SSE parser and helpers.

**Not covered:** any React component, page, route or guard; gateway rate limiting (Redis pointed at a dead port); the chunker; the citation validator; the SSE success path; AI-session persistence; member hydration; live providers; resource limits (SEC-002); port conflicts (RT-002); built-artefact behaviour (RT-005). No coverage measurement.

**CI history and configuration:** `.github/workflows/ci.yml` triggers on push and PR to `develop` and `main`; steps are `npm ci`, typecheck of 6 services, frontend build, `npm test` with a `mongo:7` service. Exactly one run exists (2026-11-11, branch `phase-4-meeting-summarizer-task-creatio`), which failed at "Typecheck & Build Frontend" (TS2345 in `JoinWorkspaceModal.tsx`, TS6133 errors), and at that commit the triggers differed. No fix-wave commit has a CI run. Missing: lint, coverage, audit, Redis service, E2E, a guard against silent skips (ARC-005, ARC-006).

---

## 18. Dependency security assessment

`npm audit --omit=dev`: **30 advisories** (critical 2, high 14, moderate 9, low 5), unchanged from the wave-3 baseline and down from 47 in the 2026-11-10 audit. Parser packages (multer, mammoth, pdf-parse, xmldom) no longer appear. Fixes exist for all; shadcn and zod need major-version changes.

| Package (severity) | Pulled in by | Reachability |
|---|---|---|
| proxy-addr (critical) | express | Not reachable: needs `trust proxy`, which is unset. Upgrade before enabling it (RT-008) |
| handlebars (critical) | @langchain/classic via @langchain/community | No template compilation in the code |
| axios (high, frontend) | frontend | Low: prototype-pollution gadgets, no pollution source found |
| react-router (high, frontend) | frontend | Low: navigation targets are internal paths |
| follow-redirects (high) | axios, http-proxy | Gateway proxy does not follow redirects |
| ip-address (high) | express-rate-limit | IPv6 subnet keying of the socket IP only |
| zod (high) | shadcn CLI; ai-service nested copy | **On ai-service's runtime validation path** (Agent 5 correction of Agent 3); not practically exploitable (no constrained arrays in user-input schemas; 100 KB body cap). Fix with RT-005 |
| fast-uri, js-yaml, brace-expansion, nanoid, postcss, source-map-js, browserslist (high) | ajv, langchain, build tooling | No untrusted input path found |
| @modelcontextprotocol/sdk, shadcn (high) | shadcn CLI | Not runtime |

No critical or high advisory is a blocker by reachability; batch upgrades with tests (SEC-022).

---

## 19. README requirements traceability matrix

Source: `ResearchMind_readme.md` at `e6d68ad` (sections 1 to 23 and the Master Checklist) and, where wave 4 rewrote a requirement into "as implemented" text, the original specification at commit `31ef58d`. The README's own status section was not accepted as evidence. Agent 5 corrections applied: **REQ-023 and REQ-134 changed from COMPLETE to PARTIAL**; annotations added for REQ-015, REQ-001/002/006/029/147 ("backend runtime-verified"), REQ-064 and REQ-039.

**Status totals (157):** COMPLETE **15** · NOT VERIFIED **44** · PARTIAL **26** · BROKEN **1** · NOT IMPLEMENTED **71**. No user-facing journey is COMPLETE, because there is no browser E2E and no live-provider execution.

### 19.1 Authentication and session

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-001 | Register account and sign in | NOT VERIFIED | Backend runtime-verified (rows 1-3); no UI journey run |
| REQ-002 | Login: bcrypt, access 15 min + refresh 7 d | NOT VERIFIED | Backend runtime-verified (rows 4-6); no UI journey run |
| REQ-003 | Refresh rotation; reuse revokes all sessions | COMPLETE | 8 integration tests with real MongoDB; runtime rows 12-17 |
| REQ-004 | Refresh token in httpOnly, Secure, SameSite=Strict cookie | NOT IMPLEMENTED | Tokens in JSON body and `localStorage` (SEC-008) |
| REQ-005 | Logout invalidates refresh token | COMPLETE | Integration test; runtime rows 19-24 |
| REQ-006 | `GET /auth/me` | NOT VERIFIED | Backend runtime-verified (row 7); no test file |
| REQ-007 | Update profile (`PUT /auth/me`) | NOT IMPLEMENTED | No route |
| REQ-008 | Forgot / reset password | NOT IMPLEMENTED | "coming soon" link |
| REQ-009 | Google sign-in | NOT IMPLEMENTED | Disabled button |
| REQ-010 | Protected routes and auto-refresh interceptor | NOT VERIFIED | Interceptor module tests; `ProtectedRoute` untested |
| REQ-011 | Account settings page | NOT IMPLEMENTED | No route |

### 19.2 Gateway, security and non-functional

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-012 | Gateway is the only entry point | PARTIAL | Services reachable directly (SEC-004) |
| REQ-013 | JWT verified at gateway and in each service, HS256 | COMPLETE | Tests and Agent 3 probes |
| REQ-014 | Membership enforced (400/403/503) | COMPLETE | Tests; runtime rows 92-112, 165-167 |
| REQ-015 | Redis rate limits per route | PARTIAL | 429s observed at runtime on canonical paths, but no regression test; bypassable (SEC-003); slow fail-open (RT-001); refresh/me/logout unthrottled |
| REQ-016 | Sliding-window algorithm | PARTIAL | Fixed windows used |
| REQ-017 | Request-ID tracing | NOT IMPLEMENTED | ISS-044 |
| REQ-018 | Gateway injects user/role headers | NOT IMPLEMENTED | Replaced by per-service JWT verification; no roles |
| REQ-019 | CORS, Helmet, Morgan; structured logging | PARTIAL | Wildcard CORS, CSP off, Winston only in document-service |
| REQ-020 | Envelope with `meta` and error codes | PARTIAL | `{success,data}` / `{success:false,message}`; no codes or pagination |
| REQ-021 | HTTP error mapping | COMPLETE | `error-middleware.test.ts` and runtime |
| REQ-022 | Strong secrets; internal service token | COMPLETE | Tests; runtime row 171 |
| REQ-023 | Health, graceful shutdown, resilient connections | **PARTIAL** (corrected) | Shutdown and reconnect verified; gateway health static, Redis brown-out (RT-001), listen errors swallowed (RT-002) |
| REQ-024 | Redis pub/sub event bus | NOT IMPLEMENTED | HTTP only |
| REQ-025 | Caching layer | NOT IMPLEMENTED | — |

### 19.3 Workspaces, roles and permissions

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-026 | Create workspace | NOT VERIFIED | Backend runtime-verified (rows 30-32); UI not run |
| REQ-027 | List workspaces; switcher | NOT VERIFIED | Backend runtime-verified (row 38); UI not run |
| REQ-028 | Join by invite code | NOT VERIFIED | Backend fully covered (7 integration tests; rows 33-37); UI not run |
| REQ-029 | Workspace detail and member names | NOT VERIFIED | Backend runtime-verified (row 39 with token configured); UI not run |
| REQ-030 | E-mail invites with expiring tokens | NOT IMPLEMENTED | Wizard step is dead code |
| REQ-031 | Roles lead/member/advisor | NOT IMPLEMENTED | Plain id array (SEC-010) |
| REQ-032 | Read-only advisor | NOT IMPLEMENTED | No permission model |
| REQ-033 | Remove member | NOT IMPLEMENTED | No route |
| REQ-034 | Workspace settings, rename, delete with namespace purge | NOT IMPLEMENTED | Placeholder (ISS-046) |
| REQ-035 | Workspace domain and slug | NOT IMPLEMENTED | Unused wizard steps |
| REQ-036 | Tenant isolation at the API | COMPLETE | Tests; 21 runtime probes |

### 19.4 Documents and ingestion

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-037 | Upload PDF/DOCX up to 10 MB, status `pending` | NOT VERIFIED | Route tested with stubbed Cloudinary; live and UI not run |
| REQ-038 | Upload validation (415/422/413) | COMPLETE | Tests; runtime rows 81-91 |
| REQ-039 | Text extraction (pdf-parse, mammoth) | COMPLETE | Real route tests; robustness defect SEC-002 linked |
| REQ-040 | Markdown and TXT ingestion | NOT IMPLEMENTED | 415 |
| REQ-041 | Original stored on Cloudinary | NOT VERIFIED | Stubbed in every test |
| REQ-042 | Library with status, search, filters | NOT VERIFIED | Client-side search/filter; no UI test |
| REQ-043 | Drag-and-drop upload | NOT VERIFIED | Native DnD; no UI test |
| REQ-044 | In-app PDF viewer | NOT VERIFIED | Needs browser and Cloudinary |
| REQ-045 | View documents in-app, DOCX included | PARTIAL | DOCX opens the raw file in a new tab |
| REQ-046 | Live embedding status badge | NOT VERIFIED | Helpers unit-tested |
| REQ-047 | Delete: vectors first, 503 on failure | NOT VERIFIED | Orchestration tested and runtime rollback (rows 137-139); live Pinecone not exercised |
| REQ-048 | Manual reindex | NOT VERIFIED | Backend tests and runtime rows 126-133; UI not run |
| REQ-049 | Get document metadata and content | NOT VERIFIED | Negative paths tested; happy path not asserted |
| REQ-050 | Metadata create with server-owned fields | COMPLETE | Tests; runtime row 95 (see ARC-001) |
| REQ-051 | Content, file-stream and status endpoints | NOT IMPLEMENTED | Original only via public URL |
| REQ-052 | Re-upload with incremental vector update | NOT IMPLEMENTED | — |
| REQ-053 | Rich document metadata and generated types | NOT IMPLEMENTED | — |
| REQ-054 | "Ask about this" on a document card | NOT IMPLEMENTED | — |

### 19.5 RAG, embeddings and semantic search

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-055 | Background embedding pipeline | NOT VERIFIED | Fakes in tests; runtime worker with dummy providers; live chain not run |
| REQ-056 | Job reliability (claim, fencing, 3 attempts, sweep) | COMPLETE | Integration tests; runtime rows 126-136, 184 |
| REQ-057 | Chunking (about 400 tokens, 60 overlap) | NOT VERIFIED | Chunker stubbed in every test |
| REQ-058 | Voyage voyage-3 1024-d, batched, retried | PARTIAL | Retries only on 429; batch 20 not 8; dimension check complete |
| REQ-059 | Pinecone upsert with namespace and metadata | NOT VERIFIED | Stubbed |
| REQ-060 | Namespace isolation per workspace | NOT VERIFIED | Namespace asserted with stub |
| REQ-061 | Query: embed, topK, namespace-scoped | NOT VERIFIED | Validation complete; retrieval never live |
| REQ-062 | Query validation | COMPLETE | Tests; runtime rows 105-110 |
| REQ-063 | Filter search by document type | PARTIAL | Client-side filter after topK |
| REQ-064 | Streamed answer via SSE | NOT VERIFIED | SSE error path runtime-verified (row 104); success path not run |
| REQ-065 | Grounded answer with citations; unverified flagged | NOT VERIFIED | Validator untested |
| REQ-066 | Source chips with name and link | NOT VERIFIED | No UI test |
| REQ-067 | Page-level citations | NOT IMPLEMENTED | No page metadata |
| REQ-068 | Q&A sessions logged and listed | NOT VERIFIED | No persistence test |
| REQ-069 | `POST /api/ai/search` | NOT VERIFIED | Validation only; RT-011 |
| REQ-070 | Context-aware prompting | NOT IMPLEMENTED | Chunks and question only |
| REQ-071 | Answers only from workspace documents | NOT VERIFIED | Prompt rules; no evaluation set |
| REQ-072 | Scales to hundreds of documents | NOT VERIFIED | No load test |

### 19.6 AI agent

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-073 | `/ai/agent` ReAct loop with function calling | NOT IMPLEMENTED | — |
| REQ-074 | 8 agent tools | NOT IMPLEMENTED | — |
| REQ-075 | Agent step streaming | NOT IMPLEMENTED | — |
| REQ-076 | Agent page and route | NOT IMPLEMENTED | — |
| REQ-077 | Agent session logging | NOT IMPLEMENTED | — |
| REQ-078 | Agent system prompt with project context | NOT IMPLEMENTED | — |
| REQ-079 | AI creates and assigns tasks | NOT IMPLEMENTED | Meeting import sends no assignee |
| REQ-080 | Overdue reports, channel posts, agent limit | NOT IMPLEMENTED | — |

### 19.7 Meeting summarizer, literature review, report drafter, onboarding

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-081 | Meeting notes to structured JSON | NOT VERIFIED | Fixture tests; live LLM and UI not run |
| REQ-082 | Notes accepted at 10 to 50,000 characters | PARTIAL | Multi-byte text over 100 KB gets 413 (finding REQ-082) |
| REQ-083 | Structured output validated by zod | COMPLETE | Tests |
| REQ-084 | Summarize from a workspace document | NOT IMPLEMENTED | Paste only |
| REQ-085 | Save summary as a document | NOT IMPLEMENTED | Not persisted |
| REQ-086 | Create tasks from action items (bulk, idempotent) | NOT VERIFIED | Backend complete (9 tests; runtime rows 66-73); UI not run |
| REQ-087 | Literature review generator | NOT IMPLEMENTED | Placeholder |
| REQ-088 | Literature review page | NOT IMPLEMENTED | — |
| REQ-089 | References from paper metadata | NOT IMPLEMENTED | — |
| REQ-090 | Report section drafter | NOT IMPLEMENTED | Placeholder |
| REQ-091 | New-member onboarding brief | NOT IMPLEMENTED | — |
| REQ-092 | explain-document, suggest-tasks, embed endpoints | NOT IMPLEMENTED | — |
| REQ-093 | SSE on all writing AI endpoints | PARTIAL | Only Q&A streams |

### 19.8 Tasks and Kanban

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-094 | Board CRUD | PARTIAL | Backend full; UI list/create only |
| REQ-095 | Task CRUD | NOT VERIFIED | Backend runtime rows 49-64, 75-77; UI not run |
| REQ-096 | Kanban drag-and-drop status | NOT VERIFIED | No browser test |
| REQ-097 | Columns including `review` | PARTIAL | No `review` |
| REQ-098 | Priority including `urgent` | PARTIAL | No `urgent` |
| REQ-099 | Reorder within a column | NOT IMPLEMENTED | No position field |
| REQ-100 | estimatedHours, linkedDocId, tags | NOT IMPLEMENTED | — |
| REQ-101 | Assignee is a member's user id, shown by name | COMPLETE | Tests; runtime rows 49-51 |
| REQ-102 | Due dates | NOT VERIFIED | No test; ARC-003 |
| REQ-103 | Subtasks with cycle protection | NOT VERIFIED | Cycle protection complete (rows 56-58); UI not run |
| REQ-104 | Task activity log | NOT VERIFIED | Runtime row 60; shown as raw JSON |
| REQ-105 | Task comments | NOT IMPLEMENTED | Enum value only |
| REQ-106 | Task stats and overdue endpoints | NOT IMPLEMENTED | — |
| REQ-107 | Lead sees meeting-generated tasks assigned | PARTIAL | Unassigned; no provenance |

### 19.9 Real-time collaboration and chat

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-108 | Chat channel CRUD | NOT IMPLEMENTED | No chat service |
| REQ-109 | Socket.io messaging | NOT IMPLEMENTED | — |
| REQ-110 | Cursor-paginated history | NOT IMPLEMENTED | — |
| REQ-111 | Typing indicators | NOT IMPLEMENTED | — |
| REQ-112 | Reactions; message soft delete | NOT IMPLEMENTED | — |
| REQ-113 | Threads and attachments | NOT IMPLEMENTED | — |
| REQ-114 | @mention notifications | NOT IMPLEMENTED | — |
| REQ-115 | Online presence | NOT IMPLEMENTED | — |
| REQ-116 | Socket.io Redis adapter | NOT IMPLEMENTED | — |

### 19.10 Notifications

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-117 | Notification service on events | NOT IMPLEMENTED | Empty files |
| REQ-118 | Bell, unread count, mark read | NOT IMPLEMENTED | Disabled bell |
| REQ-119 | WebSocket push | NOT IMPLEMENTED | — |
| REQ-120 | E-mail notifications and digest | NOT IMPLEMENTED | — |
| REQ-121 | Notification preferences | NOT IMPLEMENTED | — |
| REQ-122 | AI-filtered notifications | NOT IMPLEMENTED | — |

### 19.11 Dashboard, analytics, sources

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-123 | Progress dashboard with charts and activity | NOT IMPLEMENTED | 3 counts; mock cards unused |
| REQ-124 | Analytics page | NOT IMPLEMENTED | Placeholder |
| REQ-125 | Sources page | NOT IMPLEMENTED | Placeholder; undefined in spec |
| REQ-126 | AI progress and risk monitoring | NOT IMPLEMENTED | — |
| REQ-127 | Workspace overview | NOT VERIFIED | Helper tested; member count can be stale |

### 19.12 Frontend structure and UX

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-128 | Workspace-scoped URLs; `/app/workspace/:id/search` alias | BROKEN | Ignores `:id` (finding REQ-128) |
| REQ-129 | Dark mode toggle | NOT VERIFIED | No browser test |
| REQ-130 | Loading, error and empty states | PARTIAL | 5 of 13 navigation entries are placeholders |
| REQ-131 | Mobile-responsive layout | PARTIAL | Never tested on devices |
| REQ-132 | Rich-text editor | NOT IMPLEMENTED | — |
| REQ-133 | Socket.io client | NOT IMPLEMENTED | — |

### 19.13 DevOps, testing and delivery

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-134 | Docker Compose local infrastructure | **PARTIAL** (corrected) | Works, but 0.0.0.0 bindings and default credentials (SEC-001) |
| REQ-135 | Dockerfile per service, full-stack compose | NOT IMPLEMENTED | — |
| REQ-136 | Independently deployable microservices | PARTIAL | 5 services and gateway; not containerised |
| REQ-137 | Production deployment and public URL | NOT IMPLEMENTED | — |
| REQ-138 | GitHub Actions CI | NOT VERIFIED | Workflow exists; only run failed; never run on current code |
| REQ-139 | CI lint, matrix, Redis | NOT IMPLEMENTED | — |
| REQ-140 | Unit tests for chunker, tokens, limiter, agent, validators | PARTIAL | Tokens and validators only |
| REQ-141 | Integration tests against a real DB | COMPLETE | 11 MongoDB suites, 239/239 |
| REQ-142 | Rate-limit demo test | NOT IMPLEMENTED | — |
| REQ-143 | k6 load test | NOT IMPLEMENTED | — |
| REQ-144 | Local setup from README | NOT VERIFIED | Dev scripts not executed |
| REQ-145 | Pinecone index setup | PARTIAL | Manual |
| REQ-146 | Demo seed data | NOT IMPLEMENTED | — |
| REQ-147 | Swagger UI at `/api-docs` | NOT VERIFIED | Backend runtime-verified (200, public; SEC-016) |
| REQ-148 | Architecture diagram image; demo video | NOT IMPLEMENTED | ASCII target design only |
| REQ-149 | PM2 in production | NOT IMPLEMENTED | — |

### 19.14 User stories and solution levels

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| REQ-150 | All project artefacts in one knowledge base | PARTIAL | PDF/DOCX only |
| REQ-151 | Upload a paper and ask about its methodology | NOT VERIFIED | Needs live providers end to end |
| REQ-152 | Cross-paper question with citations | NOT VERIFIED | Same |
| REQ-153 | Meeting notes to summary with action items | NOT VERIFIED | Live LLM |
| REQ-154 | Ask the agent to create tasks from a meeting | PARTIAL | Button-driven import only |
| REQ-155 | Lead/advisor asks about project state | PARTIAL | Documents only |
| REQ-156 | Advisor views knowledge base and progress | PARTIAL | Only as a full write-capable member |
| REQ-157 | New member asks what the team has done | PARTIAL | Documents only |

**COMPLETE (15):** REQ-003, 005, 013, 014, 021, 022, 036, 038, 039, 050, 056, 062, 083, 101, 141.

---

## 20. Feature completeness matrix

| Module | Implemented in code | Backend verified (executed) | Full journey verified | Assessment |
|---|---|---|---|---|
| Auth | Register, login, rotation with reuse detection, logout, me | Yes (integration and runtime) | No (UI) | About 55%: core works; profile, reset, Google, cookie transport missing |
| Workspaces | Create, list, detail, members, invite-code join | Yes | No | About 40%: no lifecycle management |
| Roles / permissions | None (flat membership) | Membership gate only | — | About 10% |
| Documents | PDF/DOCX upload, validation, extraction, library, PDF viewer, live status, delete, reindex | Yes (providers stubbed or dummy) | No (Cloudinary, UI) | About 65% |
| RAG / search | Full pipeline code, SSE, chunk-level citations, history | Job reliability, validation, SSE error path | No (Voyage, Pinecone, LLM never live) | About 60% in code, 0% live-verified |
| AI researcher page | Yes | Client helpers only | No | Implemented, unverified |
| AI agent | Nothing | — | — | 0% |
| Literature review | Placeholder | — | — | 0% |
| Report drafter | Placeholder | — | — | 0% |
| Onboarding brief | Nothing | — | — | 0% |
| Meeting notes | Paste to JSON; bulk task import (unassigned) | Normaliser, bulk import | No | About 55% |
| Tasks / Kanban | Boards (UI create/list), tasks CRUD, 3 columns, DnD, subtasks, activity, bulk import | Yes | No | About 55% |
| Chat | Nothing | — | — | 0% |
| Notifications | Empty service; disabled bell | — | — | 0% |
| Analytics / dashboard | 3-count overview; placeholders | — | — | About 10% |
| Sources | Placeholder | — | — | 0%, scope undefined |
| Settings | Placeholder / none | — | — | 0% |
| Integrations | Cloudinary, Voyage, Pinecone, Groq/xAI clients | All stubbed or dummy | No live call | 4 of 10 coded, 0 verified |
| Cross-cutting infrastructure | Gateway (PARTIAL per Agent 5), JWT, Redis limits, queue | JWT, membership, error mapping, lifecycle | — | About 45% |
| Deployment / operations | Infrastructure compose; CI workflow | Local tests pass; CI never green | — | About 20% |

---

## 21. Runtime and E2E test results

All runtime results come from services built and started from the current source (`e6d68ad`) against disposable MongoDB/Redis with dummy provider keys. Static findings are listed separately at the end of this section.

### 21.1 Agent 2 journey results (190 checks)

| Journey | PASS | FAIL | INFO | NOT VERIFIED | FAIL rows / notes |
|---|---|---|---|---|---|
| Auth (rows 1-29, 159-163) | 34 | 0 | 0 | 0 | Includes rotation, reuse, concurrent refresh, logout, expiry, register limiter |
| Workspace (30-44) | 15 | 0 | 0 | 0 | Join case-insensitivity, 409, isolation, member names |
| Tasks (45-78) | 32 | 1 | 1 | 0 | Row 78 FAIL (RT-004); row 70 INFO (misleading 409) |
| Documents (79-103, 137-139) | 27 | 0 | 1 | 0 | Row 93 INFO (path traversal reduced to basename) |
| AI (104-125) | 22 | 0 | 0 | 0 | Validation, membership, SSE error path, summarize errors |
| Embedding worker (126-136, 184) | 9 | 0 | 3 | 0 | Rows 134-136 INFO (concurrent reindex, queue length) |
| Redis outage and reconnect (140-151) | 9 | 3 | 0 | 0 | Rows 143, 144, 147 FAIL (RT-001) |
| Redis outage latency (152-156) | 0 | 0 | 5 | 0 | Measurements for RT-001 |
| Streaming interruption (157-158) | 1 | 1 | 0 | 0 | Row 158 FAIL (RT-003) |
| Resilience (164-168) | 5 | 0 | 0 | 0 | Fast 503s; fail-closed membership |
| Startup (169-175) | 5 | 2 | 0 | 0 | Row 174 FAIL (RT-006), row 175 FAIL (RT-002) |
| Shutdown (176-183) | 7 | 0 | 1 | 0 | Row 182 INFO (Windows `taskkill` without `/F`) |
| Frontend (185-189) | 4 | 0 | 0 | 1 | Row 189 NOT VERIFIED (no browser automation) |
| Tests (190) | 1 | 0 | 0 | 0 | 239/239 |
| **Total** | **171** | **7** | **11** | **1** | |

### 21.2 Agent 3 dynamic security tests

| Test | Result |
|---|---|
| JWT forgery (alg=none, HS512, expired, wrong key, refresh-as-access) on 5 services | PASS (all 401) |
| 21 cross-tenant probes | PASS |
| Internal routes with missing/wrong/empty token or user JWT; traversal through gateway | PASS (401 / 404) |
| Mass assignment on document create; operator injection on login/join | PASS |
| Refresh race (6 concurrent) | PASS (one success) |
| Concurrent deletes (4) | PASS (one 200) |
| Rate-limit variants | FAIL (SEC-003) |
| DOCX amplification | FAIL (SEC-002) |
| Enumeration timing | FAIL (SEC-009) |
| Access token after logout | Observation (SEC-007) |
| Polyglot PDF | Accepted (SEC-020) |
| Refresh without limiter (30 attempts) | No 429 (SEC-021) |
| Security-relevant test subset | 78/78 PASS |

### 21.3 Agent 5 independent reproductions

| Finding | Result |
|---|---|
| SEC-001 | CONFIRMED (LAN-address connects; mongo-express 200 with defaults) |
| SEC-002 | CONFIRMED (11.7 s, +0.5 GB RSS, heap-limit crash); magnitude of the original claim refuted |
| SEC-003 | CONFIRMED (login, register, AI) |
| RT-001 | CONFIRMED with root cause |
| RT-002 | CONFIRMED |
| RT-003 | CONFIRMED (no response after 90 s) |
| RT-007 | CONFIRMED and refined (dummy key identifiers only; user's logs clean) |
| RT-004 | CONFIRMED (static plus Agent 2 runtime) |
| SEC-022 | CONFIRMED totals; zod reachability statement refuted |
| REQ-128, REQ-082, SEC-005/006/010 | CONFIRMED (static or by composition) |
| Refuted findings | 0 |

### 21.4 BLOCKED and NOT VERIFIED

| Item | Status | Reason |
|---|---|---|
| Upload to indexed to cited answer to saved session | BLOCKED | Needs live Cloudinary, Voyage, Pinecone and LLM |
| Meeting summary with a real LLM | BLOCKED | Live LLM |
| Pinecone delete-by-metadata on a live index | BLOCKED | Live Pinecone |
| Client disconnect mid-generation; idle-timeout `partial:true`; SIGTERM during long stream or job | NOT VERIFIED | No streaming LLM |
| MongoDB runtime outage and reconnection | NOT VERIFIED | Disposable MongoDB shared by other agents |
| Exhaustion of ai-query, summarize, general and login limits | NOT VERIFIED | Cost and time (register limiter and headers verified) |
| All browser journeys (login UI, refresh UX, upload UI, status, SSE rendering, Kanban) | NOT VERIFIED | No browser automation installed |
| CORS through the gateway in a browser; multi-instance gateway | NOT VERIFIED | Out of scope |
| SEC-001 from a second host | NOT VERIFIED | No second host |
| Crafted PDF parser attacks | NOT VERIFIED | Not tested |
| Application Docker images | NOT APPLICABLE | No Dockerfiles |

### 21.5 Static-only findings (no runtime evidence)

ARC-002, ARC-009, ARC-012, ARC-013, ISS-015, ISS-027, ISS-028, ISS-029, ISS-031, ISS-032, ISS-037, ISS-039, ISS-041, ISS-043, ISS-046, ISS-047, ISS-048, ISS-050, SEC-005 (code and stored data; no URL fetched), SEC-006 (cross-workspace refusal runtime-verified; in-workspace injection static), SEC-008, SEC-011, SEC-012, SEC-013, SEC-019 (partly runtime), SEC-023, REQ-128. ARC-003 was verified by a Node date computation, not in a browser.

---

## 22. Performance and reliability assessment

**Measurements (this host, under memory pressure; indicative, not benchmarks)**

| Measurement | Value | Source |
|---|---|---|
| Limited request with Redis up | 21 to 258 ms | Agents 2, 5 |
| Limited request with Redis down | 9.2 to 16.1 s; 5 concurrent about 15 s each | RT-001 |
| AI query with Redis down (two limiters) | 30.8 to 31.4 s | RT-001 |
| Unlimited route with Redis down (`/me`) | 27 to 163 ms | Agents 2, 5 |
| DOCX 19 KB / 180k paragraphs via service | 11.7 s, RSS 504 to 996 MB, 3 health timeouts; not released | SEC-002 |
| Heap-limited (256 MB) service with the same file | Crash (out of memory) | SEC-002 |
| Login timing, unknown vs known e-mail | 23.8 ms vs 1,076.6 ms | SEC-009 |
| Cloudinary 401 | 10.2 s first call, about 2 s afterwards | Agent 2 |
| Summarize with dummy LLM | 358 ms | Row 121 |
| Reindex during Redis outage | 503 after 14 s at the service, 29 s via gateway | Row 145 |
| Health recovery after Redis returns | One probe (about 140 ms) | Row 148 |
| Cold start | auth/workspace/document/task about 3 min; auth restart 82 s; ai-service 35 s warm to 4 min; gateway about 5 s | Row 169 |
| Graceful shutdown | 1.5 to 3.2 s per service | Rows 176-181 |
| Service memory | About 60 to 120 MB working set each | Agent 2 |
| Frontend build | 68 to 136 s; 1.56 MB JS chunk | ARC-011 |
| `npm test` with MongoDB | 202 to 346 s | Section 17 |

**Reliability observations**
- Startup fails closed on bad configuration; MongoDB has a single bounded connect attempt (services started before MongoDB is ready exit; no compose healthcheck for ordering).
- Redis reconnection works (about every 4.4 to 5 s); auth and ai services log every attempt (RT-009).
- Gateway: slow fail-open (RT-001), no upstream timeout (RT-003), static health (ISS-044).
- Worker: single in-process consumer; no provider timeout (ISS-037); claim/fencing makes duplicates safe.
- Unbounded lists (ISS-043); full text in queue jobs (SEC-006).
- False success on port conflict (RT-002); invalid provider keys reported healthy (RT-006).
- Windows: graceful stop only with Ctrl+C in an attached console.
- Host: disk C: had 0.8 GB free at the end of the audit, and about 2.3 to 3.1 GB of free virtual memory; slow cold starts would trip supervisors with short start timeouts.
- No load testing exists (REQ-143); scalability is unmeasured.

---

## 23. Known limitations and unverified areas

1. **External providers:** Voyage, Pinecone (including delete-by-metadata on the serverless index), Groq/xAI and Cloudinary were never called with real credentials. Every verification of ISS-001, ISS-006, ISS-015, ISS-028, ISS-037 and of RAG answer quality is static or uses stubs/dummy keys.
2. **Browser:** no browser automation was available. Every UI journey, including the refresh UX, upload UI, SSE rendering, truncation display, Kanban drag-and-drop, REQ-128, ARC-002 and ARC-003, is verified only by code reading or module tests.
3. **SEC-001** exploitation from a second host was not executed; evidence is configuration, firewall evaluation and connects through the host's own LAN address.
4. **MongoDB runtime outage** and reconnection were not tested.
5. **Rate-limit exhaustion** for ai-query, summarize, general and login limits was not driven to 429 by Agent 2 (Agents 3 and 5 did reach 429 on login, register and ai-query).
6. **Crafted PDFs** (pdf.js parser) were not tested; the DOCX probe was bounded.
7. **Real Pinecone contents** (orphaned vectors) and **real Cloudinary URLs** were not inspected.
8. **CI** was not executed remotely; only history was read.
9. **Multi-instance behaviour** (several gateways, sweeps, workers in separate processes) beyond claim logic covered by tests.
10. **Local `.env` validity:** only variable names were inspected.
11. **Deployment-level controls** (TLS, reverse proxy, CSP at a static host): no deployment configuration exists.
12. **Run hygiene:** the disposable Redis was recreated during Agent 2's outage tests, so its queue contents are not evidence. Performance figures were measured on a contended, memory-starved host.
13. **Specification:** the README describes a much larger target system; 71 requirements are not implemented. These are product scope, not defects.

---

## 24. Development readiness gate assessment

| Gate | Result | Evidence |
|---|---|---|
| 1. Core stability | **CONDITIONAL PASS** | For: 171 of 190 runtime checks pass across auth, workspace, task, document, AI validation, worker, shutdown and reconnect; 239/239 tests (three runs); typecheck and build clean. Against: RT-001 (9 to 31 s brown-out), SEC-002 (crash by crafted upload), RT-002, RT-003; live-provider happy path NOT VERIFIED. Condition: SEC-002 and RT-001 fixed. |
| 2. Security | **FAIL** | SEC-001 is a live P0 exposure (default credentials verified through the LAN interface; Public profile with an Allow rule). SEC-003 (P1) bypasses login, register and AI limits. SEC-002 (P1). Application-layer controls hold (JWT pinning, 21 isolation probes, internal routes, atomic rotation, mass-assignment protection). |
| 3. Data integrity | **CONDITIONAL PASS** | For: deletion ordering and rollback, claim/fencing, atomic join, atomic idempotent bulk import verified by tests and runtime; 0 orphans and 0 duplicates in real data. Open: RT-004, SEC-006, SEC-012 (1 real stale citation), SEC-013, ISS-001 unverified on live Pinecone. |
| 4. Engineering quality | **CONDITIONAL PASS** | For: strong unit and integration suite; tsc clean. Against: CI never run on current code and its only run failed; lint not gated (42 problems); no coverage; no E2E; silent skips (ARC-006); built-artefact divergence (RT-005). Condition: green CI on a PR into `develop`. |
| 5. Architecture | **CONDITIONAL PASS** | Coherent gateway-plus-services design: per-service JWT verification, shared fail-closed membership checker, queue with claim/fencing and sweep, docs largely aligned. Debts: `packages/shared` not a package (ISS-032), 4 JWT verifiers (ISS-047), text-carrying jobs (SEC-006), no event bus. None blocks development. |
| 6. Operational readiness | **FAIL** | No Dockerfiles or deployment artefacts; insecure infrastructure defaults; static gateway health; no gateway timeout; Redis-outage brown-out; false startup success on port conflict; no request IDs or structured logging (except document-service); unbounded parser memory; Windows graceful stop only via Ctrl+C; 0.8 GB free disk on the development host. Blocks any exposure or production release, not local development. |

---

## 25. Prioritized debugging and stabilization roadmap

Roadmap tiers describe **when** work must happen; they can differ from a finding's severity where the lead promoted an item to a prerequisite. Bug fixes and stabilization are listed in 25.1 to 25.5; missing capabilities are listed separately in 25.6 as product scope.

### 25.1 P0: Immediate (this host, before any further work)

| # | Item | Actions | Done when |
|---|---|---|---|
| 1 | SEC-001 (host) | Bind MongoDB, Redis and mongo-express to `127.0.0.1` (or remove mongo-express); set non-default MongoDB and mongo-express credentials and fix `MONGO_ROOT_USERNAME` in the root `.env`; rotate credentials; enable Redis `requirepass`/ACL and update every `REDIS_URL`; create least-privilege per-service MongoDB users (SEC-014); switch the network profile to Private or scope the Docker firewall rule | `docker ps` shows `127.0.0.1:` only; LAN connects fail; Redis returns NOAUTH; default credentials fail; each service user is limited to its own database |
| 2 | Disk space | Free space on C: (0.8 GB at the end of the audit) | Enough headroom for builds, Docker volumes and logs |

### 25.2 P1: Required before development (prerequisites 2 and 3)

| # | Item | Severity | Actions | Done when |
|---|---|---|---|---|
| 3 | SEC-003 | P1 | Reject or normalise repeated slashes and dot segments before routing, or mount limiters by prefix on the normalised path; per-account login throttle in auth-service | Regression tests with real Redis: all path variants return 429/400 at the limit |
| 4 | SEC-002 | P1 | Zip central-directory pre-check (uncompressed size, entries, ratio); extraction in a worker/child process with memory and time limits; cap extracted text; temp-file cleanup on failure | Regression test with the 19 KB / 180k-paragraph DOCX: 413/422 in under 1 s, `/health` responsive |
| 5 | RT-001 | P2, promoted | Bypass the store when the limiter client is not ready; `commandTimeout` 250 to 500 ms | Outage-latency test: limited routes under 1 s with Redis down |
| 6 | SEC-001 (repository part) | P1 config defect | `docker-compose.yml`: `127.0.0.1` bindings, no weak fallback credentials (require them from `.env`), Redis password | Compose review; fresh `docker compose up` exposes nothing on 0.0.0.0 |
| 7 | CI green (ARC-005, ARC-006, ISS-051) | P3, gate condition | Open a PR from `fix/wave-4` (or the stabilization branch) into `develop`; add a guard that fails when `TEST_MONGO_URI` is missing in CI; add a lint step with a baseline or ratchet | A green GitHub Actions run on the PR including the new regression tests |

### 25.3 P2: Before work on upload, gateway or queue internals, and before any exposure beyond localhost

| Item | Area | Action |
|---|---|---|
| SEC-005 | Upload/storage | Authenticated Cloudinary delivery, signed short-lived URLs, random ids, migrate assets |
| SEC-006 (with ARC-007) | Queue | Pointer-only jobs; text fetched via internal API after claim |
| ISS-037 | Queue/worker | Timeouts around provider calls; worker watchdog; SSE heartbeat |
| SEC-010 | Authorization (also product scope S7) | Product decision on roles; at minimum owner-only destructive actions and member removal before any multi-user release |

**Recommended in the same stabilization PR (low cost, P3 severity):** RT-002 (exit on listen error), RT-003 (proxy timeout), RT-005 (declare zod 4 in ai-service), RT-004 (payload hash for import keys).

### 25.4 P3: Scheduled stabilization

| Area | Items |
|---|---|
| Gateway and operations | SEC-004 (bind internal services to localhost), RT-006 (provider readiness), RT-008 (`trust proxy` after the proxy-addr upgrade), ISS-044 (gateway readiness, request IDs) |
| Authentication | SEC-007 (access-token revocation), SEC-008 (cookie transport and CSP; requires a deployment decision), SEC-009 (enumeration) |
| RAG | SEC-011 (prompt isolation), SEC-012 (deleted-document filter and reconciliation), ISS-015 (abort on disconnect), ISS-027 (model check), ISS-028 (relevance threshold), ISS-029 (provenance), ISS-030 (JSON mode) |
| Data and storage | SEC-013 (Cloudinary compensation), SEC-014 (completed with P0 item 1), ARC-001 (remove phantom endpoint), ISS-043 (pagination) |
| Frontend | ARC-002 (render Markdown safely), ARC-003 (UTC date display), REQ-128 (deep link) |
| Engineering | ARC-004 (hydration timeout), ARC-005 (coverage, audit, Redis service, Playwright smoke), ARC-006, ISS-032 (packaging), ISS-051 (lint, tsconfig), SEC-022 (dependency upgrades) |

### 25.5 P4: Hygiene

ARC-008 (ai-service liveness), ARC-009 (dead code), ARC-010 (deprecated Mongoose option), ARC-011 (code splitting), ARC-012 and ISS-031 (documentation), ARC-013 (timeout parsing), RT-007 (log redaction, user-safe `embeddingError`), RT-009 (remove unused auth Redis), RT-010 (skip cleanup for never-claimed documents), RT-011 (search error mapping), SEC-015 (CORS allow-list), SEC-016 (Swagger), SEC-017 (headers), SEC-018 (internal token configuration, e-mail visibility), SEC-019 (JWT hardening), SEC-020 (strict signatures), SEC-021 (auth route limiter), SEC-023 (AI history visibility), SEC-024 (legacy data), SEC-025 (account-keyed limiter), REQ-082 (body limit), ISS-008 (`.gitignore`), ISS-039 (client validation), ISS-041 (error codes), ISS-047 (consolidate verifiers), ISS-050 (bcrypt cost, self-hosted pdf.js worker, name length).

### 25.6 Product development scope (missing capabilities, not bugs)

| # | Capability | Size | Requirements | Depends on |
|---|---|---|---|---|
| S1 | AI agent platform (ReAct loop, 8 tools, step streaming, UI, logging) | XL | REQ-073 to 080 | Tool layer with user identity; S7; generated documents (S11); task extensions (S13); chat for channel posts; verified LLM function calling |
| S2 | Literature review generator | L | REQ-087 to 089 | S11; server-side metadata filters; page citations; bibliographic metadata |
| S3 | Report section drafter and onboarding brief | M each | REQ-090, 091, 092 | S11; persisted summaries (REQ-085); context-aware prompting (REQ-070) |
| S4 | Real-time collaboration (chat, presence, typing, reactions, mentions, threads) | XL | REQ-108 to 116, 133 | WebSocket infrastructure with Redis adapter; event bus (REQ-024) |
| S5 | Notifications (service, bell, push, e-mail, digests, preferences) | L | REQ-117 to 122 | Event bus; e-mail provider; WebSocket infrastructure |
| S6 | Progress dashboard and analytics | M | REQ-123, 124, 126 | Task data (completedAt), AI usage capture |
| S7 | Roles and permissions | M | REQ-031 to 033 (SEC-010) | — |
| S8 | Workspace lifecycle and settings | M | REQ-030, 034, 035 (ISS-046) | S7; e-mail provider for invites |
| S9 | Account management (profile, reset, Google, settings) | M | REQ-007 to 009, 011 | E-mail provider |
| S10 | Session hardening with cookie transport | S to M | REQ-004 (SEC-008) | Deployment topology decision (CSRF, CORS credentials) |
| S11 | Knowledge-base breadth (MD/TXT, generated documents, edit/re-upload, metadata) | M | REQ-040, 051 to 054, 084, 085, 150 | SEC-002 fixed first (upload path) |
| S12 | Retrieval quality (server-side filters, page citations, context-aware prompts, caching, evaluation set) | M | REQ-025, 063, 067, 070, 071 | — |
| S13 | Task-model completeness (review column, urgent, ordering, estimates, links, tags, comments, stats, board UI) | M | REQ-094, 097 to 100, 105, 106 | — |
| S14 | Sources and Analytics pages | ? | REQ-124, 125 | Product definition (the spec does not define "Sources") |
| S15 | Delivery (Dockerfiles, full compose, cloud deployment, seed/demo data, CI matrix, load and limiter tests, browser E2E) | L | REQ-135 to 139, 142, 143, 146, 148, 149 | Gate 6 items |

Foundations to build first when product work starts: event bus (REQ-024), role model (S7), generated-document support (S11), task-model extensions (S13), e-mail provider, WebSocket infrastructure, and a browser E2E harness with provider sandbox or contract tests (needed to move any journey from NOT VERIFIED to COMPLETE).

---

## 26. Development entry conditions

**Prerequisites (all must be COMPLETED before any new feature development begins)**

| # | Condition | Required evidence | State at audit |
|---|---|---|---|
| 1 | SEC-001 remediated on the host: infrastructure bound to localhost or firewalled, non-default credentials, Redis authentication, least-privilege MongoDB users | `docker ps` bindings; failed LAN connects; NOAUTH from Redis; per-service users verified | NOT MET |
| 2 | SEC-003, SEC-002 and RT-001 fixed, each with a regression test | Tests in the repository; passing locally and in CI | NOT MET |
| 3 | CI green on a pull request into `develop` | A green GitHub Actions run on the PR (CI has never passed and has never run on fix-wave code) | NOT MET |

**Restrictions**
- Until gates 2 (Security) and 6 (Operational readiness) pass, nothing is exposed beyond localhost: no deployment, no shared or public URL, no LAN access to services or infrastructure.
- After the prerequisites, permitted scope is feature work that does not touch upload, gateway or queue internals until their P2 items (SEC-005, SEC-006/ARC-007, ISS-037; plus RT-001 already in the prerequisites) are fixed.
- Missing capabilities (section 25.6) are product scope, not bugs, and do not block entry.
- A production or internet-facing release additionally requires gate 6 items (Dockerfiles and deployment configuration, RT-002, RT-003, SEC-004, SEC-005, SEC-006, SEC-007/008, SEC-009, SEC-021, RT-005, REQ-128, dependency upgrades, gateway health) and live-provider plus browser E2E verification of the core RAG journey.

**Reversion:** if the prerequisites are not met before feature development begins, the decision reverts to **C**.

---

## 27. Final development readiness decision

### **B. READY FOR DEVELOPMENT WITH CONDITIONS**

**Strict prerequisites, to be COMPLETED BEFORE any new feature development begins:**
1. Remediate **SEC-001** on the host: bind the infrastructure to localhost or firewall it, use non-default credentials, enable Redis authentication, and create least-privilege MongoDB users.
2. Fix **SEC-003** (double-slash / path-normalisation rate-limit bypass), **SEC-002** (DOCX parser resource exhaustion) and **RT-001** (fail-open limiter latency when Redis is down), each with regression tests.
3. Get **CI green on a pull request into `develop`**. CI has never passed and has never run on fix-wave code.

**Restrictions:**
- Until gates 2 (Security) and 6 (Operational readiness) pass, nothing is exposed beyond localhost.
- Permitted scope after the prerequisites: feature work that does not touch upload, gateway or queue internals until their P2 items are fixed.
- Missing capabilities are product scope, not bugs.

**Recorded unresolved disagreement:** Agent 5 proposed allowing isolated feature branches (for example task-model completeness, roles, frontend fixes, an E2E harness) to proceed in parallel with the prerequisites, with merges held until the stabilization PR is green. The lead decided that the prerequisites come first. This report applies the lead's decision.

**Reversion:** if the prerequisites are not met, the decision reverts to **C**.

**Basis:** no core flow is broken in code, and the API-level journeys pass at runtime against the current source; the confirmed P0/P1 items are small, well localised and have known fixes (SEC-001 is environment configuration, SEC-003 a routing guard, SEC-002 an extraction wrapper, RT-001 limiter configuration). A live P0 exposure, two P1 defects and CI that has never run on this code rule out A. The two FAIL gates are driven by these items and by production-deployment scope, not by systemic instability, which rules out C provided the prerequisites are completed.
