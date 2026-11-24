# System Architecture — ResearchMind

ResearchMind is a research workspace for student teams. Members upload PDF/DOCX documents, ask questions answered from those documents, summarise meeting notes and manage tasks. The backend is a set of Node.js/Express (TypeScript) services behind an API gateway. Each service has its own MongoDB database. Redis is used for rate limiting and for the embedding job queue. Voyage AI provides embeddings, Pinecone stores vectors, and Groq or xAI provides the LLM through the OpenAI SDK.

This page describes what the code does today. Every statement was checked against the source; file paths are given so you can check them again. Related pages:

- [security.md](security.md): authentication, authorization and known risks
- [documents-and-ai.md](documents-and-ai.md): the document pipeline, retrieval and answer generation
- [../operations/background-jobs.md](../operations/background-jobs.md): the embedding worker, retries and recovery

> **External providers were not tested against live accounts.** Voyage AI, Pinecone, Groq/xAI and Cloudinary are called through their SDKs, but the automated tests (`tests/`) replace them with fakes. Wherever this page describes provider behaviour, it means what the code *asks* the provider to do. The provider's actual behaviour has not been verified.

---

## 1. What exists

| Area | Status | Where |
|---|---|---|
| API gateway (proxy, JWT check, Redis rate limits, Swagger UI) | Implemented | `services/api-gateway` |
| Auth: register, login, refresh rotation with reuse detection, logout, `/me` | Implemented | `services/auth-service` |
| Workspaces: create, list, join by invite code, membership check, member list | Implemented | `services/workspace-service` |
| Documents: PDF/DOCX upload, text extraction, Cloudinary storage, embedding status, re-index, delete | Implemented | `services/document-service` |
| Tasks: boards, tasks, subtasks, activity log, bulk import | Implemented | `services/task-service` |
| AI: embedding worker, semantic search, streamed RAG answers (SSE), session history, meeting summariser | Implemented (providers not tested live) | `services/ai-service` |
| Frontend SPA | Implemented; 5 sidebar routes are placeholders (section 9) | `frontend/` |
| Workspace roles, removing members, rotating or expiring invite codes | Not implemented | — |
| Password reset, email verification, OAuth sign-in | Not implemented | — |
| Notification service | Not implemented: `src/app.ts` and `src/server.ts` are empty, and there are no `dev`/`start` scripts | `services/notification-service` |
| Container images for the services | Not implemented: `docker-compose.yml` only runs MongoDB, Redis and mongo-express | `docker-compose.yml` |

---

## 2. Component view

```mermaid
flowchart LR
    Browser["Browser: React SPA (Vite, port 5173)"]

    subgraph Edge
        GW["api-gateway :5000"]
    end

    subgraph Services
        AUTH["auth-service :5001"]
        WS["workspace-service :5002"]
        DOC["document-service :5003"]
        TASK["task-service :5004"]
        AI["ai-service :5006 (HTTP + in-process embedding worker)"]
        AIW["ai-service standalone worker (optional, start:worker)"]
    end

    subgraph Data
        MAUTH[("MongoDB: auth DB")]
        MWS[("MongoDB: workspace DB")]
        MDOC[("MongoDB: document DB")]
        MTASK[("MongoDB: task DB")]
        MAI[("MongoDB: ai DB")]
        REDIS[("Redis")]
    end

    subgraph External["External providers (not tested live)"]
        CLD["Cloudinary"]
        VOY["Voyage AI embeddings"]
        PC[("Pinecone index")]
        LLM["Groq or xAI (OpenAI SDK)"]
    end

    Browser -->|"HTTPS JSON, multipart, SSE"| GW
    GW -->|"/api/auth"| AUTH
    GW -->|"/api/workspaces"| WS
    GW -->|"/api/documents"| DOC
    GW -->|"/api/tasks"| TASK
    GW -->|"/api/ai"| AI
    GW -->|"rate-limit counters"| REDIS

    DOC -->|"membership check, user bearer"| WS
    TASK -->|"membership and member ids, user bearer"| WS
    AI -->|"membership check, user bearer"| WS
    WS -->|"POST /internal/users/bulk, X-Internal-Token"| AUTH
    DOC -->|"DELETE /internal/vectors/..., X-Internal-Token"| AI
    AI -->|"POST claim, PATCH status, X-Internal-Token"| DOC
    AIW -->|"POST claim, PATCH status, X-Internal-Token"| DOC

    DOC -->|"RPUSH embedding job"| REDIS
    REDIS -->|"BLPOP"| AI
    REDIS -->|"BLPOP"| AIW

    AUTH --> MAUTH
    WS --> MWS
    DOC --> MDOC
    TASK --> MTASK
    AI --> MAI

    DOC --> CLD
    AI --> VOY
    AI --> PC
    AI --> LLM
    AIW --> VOY
    AIW --> PC
```

Browser-side connections that do not go through the gateway:

- None for document files: since SEC-005 the browser fetches a file only through `GET /api/documents/:id/file` (via the gateway, with the access token, through the axios client) and shows or saves it from an object URL. document-service streams it from private Cloudinary storage; no storage URL reaches the browser.
- None for scripts: since Wave 5 (ISS-050) the PDF.js worker is bundled and served from the app's own origin (it used to come from `unpkg.com`).

---

## 3. Services and responsibilities

| Service | Port (default) | Database (connection variable) | Redis | Responsibilities |
|---|---|---|---|---|
| api-gateway | 5000 | none | Rate-limit store (`REDIS_URL`) | Proxies 5 path prefixes. Verifies the access token on every prefix except `/api/auth`. Applies rate limits and the CORS allow-list (`CORS_ORIGIN`). Serves Swagger UI at `/api-docs` only when `API_DOCS_ENABLED=true`. Does **not** check workspace membership. |
| auth-service | 5001 | `MONGO_URI` (users, refresh tokens) | None (its unused Redis client was removed, RT-009) | Register, login, refresh rotation, logout, `/me`. Also serves internal `POST /internal/users/bulk` for workspace-service. |
| workspace-service | 5002 | `MONGO_URI` (workspaces) | none | Create, list, join by invite code, membership check, detail, member list. Member names come from auth-service. |
| document-service | 5003 | `MONGODB_URI` or `MONGO_URI` (documents) | Queue producer (`RPUSH`, `LLEN`) | Upload validation, text extraction (`pdf-parse`, `mammoth`), Cloudinary upload, document records, embedding status and claims, recovery sweep, delete, re-index. |
| task-service | 5004 | `MONGODB_URI` or `MONGO_URI` (boards, tasks, activity) | none | Boards, tasks, subtasks, activity log, bulk create (max 50, optional `importKey`). Checks that the assignee is a workspace member. |
| ai-service (HTTP) | 5006 | `MONGODB_URI` or `MONGO_URI` (AI sessions) | General client for `/health`. Worker client (`BLPOP`) for the in-process worker. | Semantic search, SSE RAG answers, session history, meeting summary. Serves internal vector deletion. Runs the embedding worker in-process. |
| ai-service (standalone worker) | — | none | Worker client (`BLPOP`) | Optional second consumer of the same queue (`src/worker.ts`). Does not connect to MongoDB. |
| notification-service | — | — | — | Empty placeholder |

Database names are not set in code. They come from the connection URI. The `.env.example` files use `researchmind-auth`, `researchmind-workspace`, `researchmind-document`, `researchmind-task` and `researchmind-ai`. No service reads another service's database. Data owned by another service is always read over HTTP.

---

## 4. Request flow through the gateway

The browser sends every API call to the gateway (`VITE_API_URL`, default `http://localhost:5000/api`). `services/api-gateway/src/app.ts` mounts global middleware first (canonical-path guard, request id `X-Request-ID`, `cors()` with the `CORS_ORIGIN` allow-list (SEC-015), `helmet()` with its default Content-Security-Policy, `morgan` with the shared access-log format including the request id), then Swagger UI at `/api-docs` when `API_DOCS_ENABLED=true` (SEC-016), then the routes below in this order, `/health`, and finally a JSON not-found handler (ISS-041). `trust proxy` comes from `TRUST_PROXY` (off by default):

| Path prefix | Gateway middleware before proxying | Target (env var, default) |
|---|---|---|
| `/api-docs` (mounted first, only when `API_DOCS_ENABLED=true`) | Swagger UI. No authentication. Off by default: then `/api-docs` is a JSON 404. | — |
| `POST /api/auth/login` | Login limiter: 5 failed attempts per 15 min per IP | — |
| `POST /api/auth/register` | Register limiter: 3 per hour per IP | — |
| `/api/auth/*` | No JWT check. Every auth route (refresh, `/me`, logout, and login/register after their own limiters) shares a per-IP limiter of 60 requests per minute (`authApiRateLimiter`, SEC-021). | `AUTH_SERVICE_URL`, `http://localhost:5001` |
| `/api/workspaces/*` | `authenticate`, then general limiter (100/min per user) | `WORKSPACE_SERVICE_URL`, `:5002` |
| `/api/documents/*` | `authenticate`, then general limiter | `DOCUMENT_SERVICE_URL`, `:5003` |
| `/api/tasks/*` | `authenticate`, then general limiter | `TASK_SERVICE_URL`, `:5004` |
| `/api/ai/*` | `authenticate`. `query` and `search` share a limit of 30/hour per user. `summarize-meeting` has its own 20/hour per user. Then the general limiter. | `AI_SERVICE_URL`, `:5006` |
| `/health` | Always 200. Reports the rate-limit Redis connection state: `status: "healthy"\|"degraded"`, `dependencies.rateLimitStore` (ISS-044). Upstream services are not checked. | — |
| anything else (mounted last) | `404 { success:false, message:"Route not found" }` (ISS-041). Every service ends with the same handler, so an unknown route behind a proxy is the same JSON 404. | — |

Points to note:

- **CORS (SEC-015).** Only the gateway sends CORS headers; the internal services no longer mount `cors()`. With `CORS_ORIGIN` unset, any loopback origin over http (`http://localhost:<port>`, `http://127.0.0.1:<port>`) is allowed and a startup line says so; this is a local-development default. With `CORS_ORIGIN` set (comma-separated), exactly those origins are allowed. `*` or a malformed entry stops the gateway at startup. **Production must set `CORS_ORIGIN`.**
- **Response fingerprint (SEC-017).** The gateway removes upstream `X-Powered-By` headers from proxied responses; workspace-service no longer sends one.

- **The gateway does not forward its verification result.** It verifies the JWT (HS256, `JWT_ACCESS_SECRET`) and passes the original `Authorization` header unchanged. Each service verifies the token again: `packages/shared/auth/authenticate.ts`, `services/auth-service/src/middlewares/auth.middleware.ts`, and `services/workspace-service/src/middlewares/auth.middleware.ts`.
- **`/internal/*` is never proxied.** The gateway only matches the five `/api/...` prefixes, and every internal router is mounted at `/internal` on its service. Internal routes can only be reached on a service's own port, and they require `X-Internal-Token`. Since Wave 4 (SEC-004) every service starts through `startHttpServer` (`packages/shared/lifecycle/listen.ts`): auth, workspace, document, task and ai-service bind `127.0.0.1` unless `HOST` is set; the gateway binds `0.0.0.0`. A listen error (for example `EADDRINUSE`) is logged and the process exits 1 (RT-002).
- **Proxy errors.** If a target cannot be reached, the gateway answers `503 { success:false, message:"Service temporarily unavailable..." }`. If a target sends nothing for `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` (default 120 s), the gateway answers `504` (RT-003); the timer restarts on every chunk, so streamed answers with heartbeats are not cut. If ai-service dies part-way through a streamed answer, the gateway ends the client response. The client then sees a stream with no terminal event and reports the answer as incomplete (`endClientResponseIfUpstreamAborts`).
- **Workspace authorization happens in the services.** document-, task- and ai-service ask workspace-service whether the caller belongs to the workspace (`packages/shared/auth/workspace-membership.ts`). They pass the caller's own bearer token and allow 3 s. Possible results: `400` (malformed id), `403` (not a member), `503` (the check could not complete). See [security.md](security.md#workspace-authorization).

### Service-to-service calls

| Caller → callee | Route | Authentication | Timeout | On failure |
|---|---|---|---|---|
| document/task/ai → workspace | `GET /api/workspaces/:id/membership` | Caller's bearer token | 3 s | `503` to the client |
| task → workspace | `GET /api/workspaces/:id` (member ids, used for assignee checks) | Caller's bearer token | 3 s | `503`; `403` if not a member |
| workspace → auth | `POST /internal/users/bulk` | `X-Internal-Token` (both services refuse to start without `INTERNAL_SERVICE_TOKEN`, SEC-018) | none set | Members are still returned, with name `"Researcher"` and an empty email |
| ai worker → document | `POST /internal/documents/:id/embedding/claim`, `PATCH /internal/documents/:id/embedding-status` | `X-Internal-Token` | 15 s | See [background-jobs.md](../operations/background-jobs.md) |
| document → ai | `DELETE /internal/vectors/workspaces/:workspaceId/documents/:documentId` | `X-Internal-Token` | 15 s | Deletion rolled back, `503` to the client |

---

## 5. Redis usage

| Client | Library | Purpose | Behaviour when Redis is down |
|---|---|---|---|
| api-gateway `limiterRedis` | ioredis via `rate-limit-redis` | Rate-limit counters (`rl:<name>:` prefixes) | Limiters **fail open** (`passOnStoreError: true`). The error is logged once. |
| document-service `redis` | ioredis | `RPUSH researchmind:embedding:jobs` on upload, re-index and recovery; `LLEN` for the sweep's backlog check | Reconnects forever (backoff capped at 5 s). Each command fails after `maxRetriesPerRequest: 3`. A failed upload enqueue sets the document to `failed`; a failed re-index answers `503`. `/health` returns 503. |
| ai-service `redis` | ioredis | `/health` and `/health/ready` only | `/health` stays 200 with `status: "degraded"`; `/health/ready` returns 503 (ARC-008) |
| ai-service `redisWorker` | ioredis, `maxRetriesPerRequest: null` | `BLPOP` with a 5 s timeout (embedding worker) | Waits and reconnects indefinitely |

auth-service has no Redis client (removed, RT-009).

The queue is a plain Redis list. `BLPOP` removes a job from the list as soon as a worker receives it. Delivery is therefore at-most-once. What makes the pipeline reliable is that MongoDB holds each document's status durably and the recovery sweep re-queues stalled work. See [background-jobs.md](../operations/background-jobs.md).

---

## 6. External providers

| Provider | Used by | Configuration | What the code checks | Live-tested? |
|---|---|---|---|---|
| Cloudinary | document-service upload and delete | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Nothing at startup. An upload failure becomes `502`. | No |
| Voyage AI | ai-service (document and query embeddings) | `VOYAGE_API_KEY` (required at import), `VOYAGE_MODEL` (default `voyage-3`), `VOYAGE_EMBEDDING_DIMENSION` (default 1024) | Each embedding's dimension is checked at runtime | No |
| Pinecone | ai-service (upsert, query, delete by metadata filter) | `PINECONE_API_KEY`, `PINECONE_INDEX` (both required at import) | At startup, the index dimension is compared with `VOYAGE_EMBEDDING_DIMENSION`. A mismatch or missing index aborts startup. If Pinecone cannot be reached, a warning is logged and startup continues. | No |
| Groq / xAI | ai-service (RAG answers, meeting summaries) | `XAI_API_KEY` or `GROQ_API_KEY` (required at import). A key starting `gsk_` selects Groq. `XAI_BASE_URL`, `XAI_MODEL` (defaults `openai/gpt-oss-120b` on Groq, `grok-4.5` on xAI). | The model name is logged at startup but **never checked** against the provider | No |

---

## 7. Startup and shutdown

All services call `dotenv.config()`. Then they call `assertRequiredSecrets()` (`packages/shared/config/secrets.ts`) before importing the app. A secret is rejected if it is missing, still an `.env.example` `<placeholder>`, a known weak value, or shorter than 32 characters. Rejection prints the variable name only and exits with code 1.

MongoDB connections go through `connectMongo()` (`packages/shared/lifecycle/mongo.ts`). It makes one attempt, bounded by the driver's server-selection timeout (Mongoose default 30 s). If that fails, the service exits with code 1. After a successful start, the driver reconnects by itself. Disconnects and reconnects are logged, and `/health` shows the live state.

| Service | Secrets checked at boot | Other startup steps | Shutdown steps (in order) |
|---|---|---|---|
| api-gateway | `JWT_ACCESS_SECRET` | none | stop HTTP → close rate-limit Redis |
| auth-service | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN`; the two JWT secrets must differ (SEC-018/SEC-019) | MongoDB (required) | stop HTTP → MongoDB |
| workspace-service | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` (SEC-018) | MongoDB (required); `syncIndexes()` when `NODE_ENV !== "production"` | stop HTTP → MongoDB |
| document-service | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` | MongoDB (required); upload temp-folder sweep (`UPLOAD_TMP_DIR`, files older than 1 h, SEC-024); recovery sweep immediately, then every 5 min | stop HTTP → clear sweep timer → MongoDB → Redis |
| task-service | `JWT_ACCESS_SECRET` | MongoDB (required); `syncIndexes()` outside production | stop HTTP → MongoDB |
| ai-service (HTTP) | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` | Provider keys must be set (a missing key throws on import, so the process crashes). MongoDB (required). Models logged. Pinecone index dimension check (exits on mismatch; skipped with a warning if Pinecone is unreachable). Redis ping (warns only). Worker started. | stop HTTP → stop worker (current job may finish) → MongoDB → Redis → worker Redis. Timeout 30 s. |
| ai-service (standalone worker) | `INTERNAL_SERVICE_TOKEN` | `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX` required at import; Pinecone index check (same rule as the HTTP service) | stop worker → worker Redis. Timeout 30 s. |

Graceful shutdown is handled by `packages/shared/lifecycle/shutdown.ts`, triggered by SIGINT or SIGTERM:

1. The HTTP server stops accepting connections. In-flight requests, including SSE streams, get `serverGraceMs`: the smaller of 5 s and half the timeout. After that, remaining connections are closed.
2. The steps run in order. Every step runs even if an earlier one failed.
3. The process exits with 0, or with 1 if any step failed or the overall timeout passed (default 10 s, 30 s for ai-service). A second signal forces `exit(1)`.

---

## 8. Health endpoints

| Service | Endpoint | Reports |
|---|---|---|
| api-gateway | `GET /health` | Always 200; `status: "degraded"` and `dependencies.rateLimitStore: "down"` while its rate-limit Redis is not ready (ISS-044) |
| auth, workspace, task | `GET /health` | 503 unless MongoDB is connected |
| document-service | `GET /health` | 503 unless MongoDB is connected and the producer Redis client is `ready` |
| ai-service | `GET /health` | 503 unless MongoDB is connected. While only the general Redis client is down: 200 with `status: "degraded"` and `redis: "down"` (ARC-008; questions and summaries still work, only indexing waits) |
| ai-service | `GET /health/ready` | Strict: 503 unless MongoDB is connected **and** the general Redis client is `ready`. Use this for monitors that must see the queue. The worker's own Redis client is not checked. |

---

## 9. Frontend

**Stack.** React 19, React Router, React Query (`frontend/src/lib/queryClient.ts`, `retry: 1`), zustand stores persisted to `localStorage` (`researchmind-auth` and `researchmind-workspace`), and axios.

**Routing** (`frontend/src/routes/AppRouter.tsx`):

| Route | Guard | Page |
|---|---|---|
| `/login`, `/register` | Signed-out users only (`GuestOnly`) | Login and register |
| `/create-workspace` | `ProtectedRoute` | Create or join a workspace |
| `/dashboard` | `ProtectedRoute` → `OnboardingGuard` → `AppShell` | Overview |
| `/dashboard/tasks` | same | Kanban |
| `/dashboard/documents` | same | Documents (upload, list, status, PDF viewer, re-index, delete) |
| `/dashboard/ai-researcher` | same | Semantic search / RAG Q&A (answers rendered as hardened Markdown + KaTeX, ARC-002) |
| `/app/workspace/:id/search` | same | Deep link (REQ-128, Wave 4): selects workspace `:id` if the user is a member, then redirects to `/dashboard/ai-researcher` (router state such as `initialQuery` is kept); a non-member or malformed id redirects without switching. The server still enforces membership |
| `/dashboard/meeting-notes` | same | Meeting summariser and task import |
| `/dashboard/sources`, `/analytics`, `/literature-review`, `/report-drafter`, `/settings` | same | **Placeholder** ("module is currently in development") |
| `*` | — | Redirects to `/dashboard` when signed in, otherwise `/login` |

`ProtectedRoute` only checks the `isAuthenticated` flag held in the client. Every API call is still authenticated by the server. `OnboardingGuard` holds a loading screen until the workspace list has actually been fetched. If the fetch fails, it shows a retry screen with a sign-out button. Only a list that loaded successfully and is empty redirects to `/create-workspace`.

**API integration** (`frontend/src/api/`):

- `axios.ts`: one axios instance. The base URL is `VITE_API_URL` (default `http://localhost:5000/api`). Interceptors (`auth-interceptors.ts`) add `Authorization: Bearer <access token>`. On a `401` they refresh the token once through a shared coordinator (`lib/token-refresh.ts`) and retry. They never refresh for `/auth/login`, `/auth/register` or `/auth/refresh`.
- `ai.api.ts`: the RAG stream uses `fetch()` rather than axios, so it can read the response body as a stream. It gets the token from `ensureFreshToken()` and retries once after a `401`. `utils/sse.ts` and `utils/ai-stream.ts` parse the events. Only a `done` event counts as a complete answer.
- `document.api.ts`: upload is `multipart/form-data` with `file` and `workspaceId`. The documents hook polls the list every 5 s while any document is `pending` or `indexing`, every 60 s when all unfinished documents look stalled, and stops when every document is final (`utils/document-status.ts`).
- `workspace.api.ts`, `task.api.ts`, `auth.api.ts`: plain REST calls through the same axios instance.
- **List paging (ISS-043).** The document, board, task and activity lists are paged on the server; `api/paging.ts` (`fetchAllPages`) follows `meta.nextCursor` for up to 10 pages, so the UI still shows whole lists. When more exist, the Documents and Kanban pages show "Showing the first N …" and their counts refer to the loaded items. The task-activity timeline loads up to 10 × 200 entries without a notice.
- **Dates (ARC-003).** Due dates are calendar dates stored as UTC midnight and displayed with `formatDueDate` (`utils/meeting-tasks.ts`) in UTC, so they show the same day in every time zone.
- **Content-Security-Policy (SEC-008).** The production build carries a CSP meta tag generated by `frontend/csp.ts` (see [security.md](security.md#8-cors-and-http-headers)). Since Wave 5 it allows scripts and workers from the app's own origin only (ISS-050).
- **Code splitting (ARC-011, Wave 5).** `routes/AppRouter.tsx` lazy-loads the Documents, Q&A, Meeting Notes and Kanban pages, and both pages that open PDFs lazy-load `PdfViewerModal`, so pdf.js, react-pdf and KaTeX are not in the entry chunk (every JS chunk is under 500 kB; `tests/frontend-bundle.test.ts`). `AppShell` shows a spinner while a page chunk loads.
- `main.tsx` calls `installCrossTabSessionSync()` so that tabs share rotated tokens and sign-outs. See [security.md](security.md#client-session-handling).

---

## 10. Key sequences

### 10.1 Document upload → embedding → indexed

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant G as api-gateway
    participant D as document-service
    participant W as workspace-service
    participant C as Cloudinary
    participant M as MongoDB (documents)
    participant R as Redis list
    participant K as Embedding worker (ai-service)
    participant V as Voyage AI
    participant P as Pinecone

    B->>G: POST /api/documents/upload (multipart file + workspaceId, Bearer)
    G->>G: verify JWT, rate limit
    G->>D: proxy request
    D->>D: verify JWT, multer saves temp file (ext .pdf/.docx, max 10 MB)
    D->>W: GET /api/workspaces/:id/membership (caller Bearer, 3 s)
    W-->>D: isMember true
    D->>D: check magic bytes, extract text (pdf-parse or mammoth)
    D->>C: upload file (private "authenticated" asset, random UUID id; PDF as image, DOCX as raw)
    C-->>D: public_id, resource and delivery type
    D->>M: create Document (status pending, uploadedBy from JWT)
    D->>R: RPUSH job (documentId, workspaceId) -- pointer only, no text
    D-->>B: 201 Document (status pending)
    K->>R: BLPOP (5 s timeout)
    R-->>K: job
    K->>D: POST /internal/documents/:id/embedding/claim (X-Internal-Token)
    D->>M: atomic claim, status indexing, attempts +1, claimSequence +1
    D-->>K: 200 claimToken, workspaceId
    K->>K: refuse unless claim workspaceId equals job workspaceId
    K->>D: GET /internal/documents/:id/embedding-source (claimToken, X-Internal-Token)
    D-->>K: text, uploadedBy, fileType (current claim only)
    K->>K: chunk text (about 400 tokens, 60 overlap)
    K->>V: embed chunks (batches of 20)
    V-->>K: vectors
    K->>P: deleteMany documentId in namespace workspaceId
    K->>P: upsert ids documentId-chunk-N in namespace workspaceId
    K->>D: PATCH /internal/documents/:id/embedding-status indexed + claimToken
    D->>M: update only if still indexing with the same claimSequence
    D-->>K: 200
    B->>G: GET /api/documents/workspace/:id (polling every 5 s)
    G->>D: proxy
    D-->>B: documents with embeddingStatus indexed
```

If any step after the claim fails, the worker reports `failed` with a reason. The recovery sweep re-queues the document while it has attempts left. See [background-jobs.md](../operations/background-jobs.md).

### 10.2 RAG query over SSE

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant G as api-gateway
    participant A as ai-service
    participant W as workspace-service
    participant V as Voyage AI
    participant P as Pinecone
    participant L as Groq or xAI
    participant M as MongoDB (ai)

    B->>G: POST /api/ai/query (workspaceId, query, topK) via fetch
    G->>G: verify JWT, 30 per hour AI limit, general limit
    G->>A: proxy
    A->>A: verify JWT, validate body (query 1-2000 chars, topK 1-10)
    A->>W: GET /api/workspaces/:id/membership (caller Bearer)
    W-->>A: isMember true
    A-->>B: headers text/event-stream
    A-->>B: event start
    A->>V: embed query (inputType query)
    V-->>A: query vector
    A->>P: query namespace workspaceId, topK, includeMetadata
    P-->>A: matches with chunk text
    A-->>B: event sources (documentId, chunkIndex, score, fileType)
    A->>L: chat.completions stream (temperature 0.2, max_tokens 1500)
    loop each delta
        L-->>A: token
        A-->>B: event token
    end
    A->>A: audit [Source N] markers against retrieved count
    A->>M: save AISession (query, answer, sources, aiModel)
    A-->>B: event done (sessionId, unverifiedCitations)
```

If retrieval fails, the server sends `start` followed by `error`, with no `sources`. If generation fails or stalls, it sends `error` with `partial: true|false` and no `done`. Nothing is saved in either case. If the user presses Stop or the client disconnects, generation and saving continue: there is no disconnect handling in the controller. This comes from reading the code; it was not exercised against a live provider ([security.md](security.md#known-limitations-and-unresolved-risks)).

### 10.3 Refresh-token rotation

```mermaid
sequenceDiagram
    autonumber
    participant T as Browser tab
    participant L as Web Lock researchmind-token-refresh
    participant S as localStorage researchmind-auth
    participant G as api-gateway
    participant A as auth-service
    participant M as MongoDB (refreshtokens)

    T->>G: API request with expired access token
    G-->>T: 401
    T->>T: single-flight coordinator, join refresh in progress if any
    T->>L: request exclusive lock
    L-->>T: granted
    T->>S: read persisted tokens
    alt another tab already rotated for the same user
        S-->>T: newer token pair
        T->>T: adopt tokens, no network call
        T->>G: retry original request once with adopted access token
    else this tab must refresh
        T->>G: POST /api/auth/refresh (refreshToken in JSON body)
        G->>A: proxy (no JWT check, no rate limit)
        A->>A: verify refresh JWT (HS256, JWT_REFRESH_SECRET)
        A->>M: findOneAndUpdate tokenHash, rotatedAt null, set rotatedAt now, expiresAt now plus grace
        alt claimed
            A->>M: insert hash of new refresh token (new jti, expiresAt now plus 7 days)
            A-->>T: 200 new accessToken and refreshToken
            T->>S: persist new pair (other tabs adopt it via storage event)
            T->>G: retry original request once with new access token
        else server rejects with 401 or 403
            Note over A,M: bad signature or expired gives 401. Rotated within REFRESH_REUSE_GRACE_MS gives 401 with sessions kept. Otherwise deleteMany revokes all user sessions, then 401.
            A-->>T: 401
            Note over T: the client cannot tell these 401s apart
            T->>S: poll memory and storage for about 1.5 s for newer tokens of the same user
            alt newer tokens appear
                T->>T: adopt them
                T->>G: retry original request once with adopted access token
            else none appear
                T->>T: clearClientSession, redirect to login
            end
        else network error or 5xx
            A-->>T: no answer or 5xx
            T->>T: keep session, raise RefreshUnavailableError, original request fails
        end
    end
```

---

## 11. Architectural limitations

These are described in more detail in the linked pages. They are listed here because they affect how the system is put together.

- The queue is a Redis list with destructive `BLPOP`. A job is lost if the worker crashes mid-job or if Redis loses data. Recovery depends on the document-service sweep (up to 15–20 minutes for a crashed claim). Delivery is not exactly-once and the queue is not durable.
- Redis is a single point for both rate limiting and the queue. `docker-compose.yml` runs `redis:7` with its default persistence settings and a required password (`REDIS_PASSWORD`), and publishes port 6379 on `127.0.0.1` only.
- The services are reachable directly on their ports, which skips the gateway's rate limits. They still verify JWTs and the internal token themselves.
- Cross-service reads are synchronous HTTP calls on each request. Every workspace-scoped request depends on workspace-service being available, and answers `503` when it is not.
- There is no request tracing or correlation id. Each service logs separately with `morgan` or `console`.
