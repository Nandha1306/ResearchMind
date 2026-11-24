# Environment variables reference

Every environment variable the code reads, taken from the source on branch `fix/wave-4` and updated for Wave 5 (`fix/wave-5-stabilization`). Line numbers are the line where the value is read. The values shown in this file are placeholders only.

- **Loading.** Each backend entrypoint calls `dotenv.config()` with no path, so it loads `.env` from the process working directory. The root scripts run `npm run dev --workspace=<service>`, so that directory is `services/<service>/`. Create `services/<service>/.env` from `services/<service>/.env.example` only if it does not exist yet (`cp -n`; PowerShell: `if (-not (Test-Path <path>/.env)) { Copy-Item ... }`); never copy over an existing `.env`.
- **Frontend.** Vite reads `VITE_*` variables from `frontend/.env*` and inlines them at build time.
- **notification-service** is an empty stub. Its `src/app.ts` and `src/server.ts` are 0 bytes, and it reads no variables.

## 1. Secret validation rules

`requireSecret(name)` in `packages/shared/config/secrets.ts:79-118` rejects a value in any of these cases:

| Check | Error (only the variable name is reported, never the value) |
|---|---|
| Unset, or only whitespace | `<NAME> is not configured…` |
| Matches `^<.*>$` (an `.env.example` placeholder) | `<NAME> is still set to a placeholder…` |
| In the known-insecure list (`secrets.ts:23-52`, case-insensitive; for example `secret`, `changeme`, `password`, and the old `researchmind_*_secret` literals) | `<NAME> is set to a known-insecure value…` |
| Shorter than 32 characters after trimming (`MIN_SECRET_LENGTH`, `secrets.ts:14`) | `<NAME> must be at least 32 characters (got N).` |

`assertRequiredSecrets(service, names)` (`secrets.ts:126-152`) runs `requireSecret` on each name. If any name fails, it logs `[<service>] refusing to start due to insecure secret configuration:` and calls `process.exit(1)`.

### Startup-required secrets per process

| Process | Entrypoint | Variables validated by `assertRequiredSecrets` |
|---|---|---|
| api-gateway | `services/api-gateway/src/preflight.ts` (imported first by `server.ts`, Wave 6) | `JWT_ACCESS_SECRET`; then `TRUST_PROXY` and `CORS_ORIGIN` (Wave 6: one `[api-gateway] refusing to start: <VARIABLE> ...` line, exit 1) |
| auth-service | `services/auth-service/src/preflight.ts` (imported first by `server.ts`, Wave 6) | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN` (Wave 5); then `assertDistinctSecrets`: the two JWT secrets must differ; then (Wave 6) `ACCESS_TOKEN_EXPIRES` / `REFRESH_TOKEN_EXPIRES` bounds (§2) |
| workspace-service | `services/workspace-service/src/server.ts:12` | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` (Wave 5) |
| document-service | `services/document-service/src/server.ts:10` | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` |
| task-service | `services/task-service/src/server.ts:12` | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` (Wave 6, W6-SEC-06) |
| ai-service (HTTP server) | `services/ai-service/src/server.ts:10` | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` |
| ai-service (standalone worker, `npm run dev:worker` / `start:worker`) | `services/ai-service/src/worker.ts:10` | `INTERNAL_SERVICE_TOKEN` |

**Since Wave 5 (SEC-018, SEC-019)** auth-service and workspace-service **refuse to start** without a valid `INTERNAL_SERVICE_TOKEN`, and auth-service also refuses to start when `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are equal (`assertDistinctSecrets`, `secrets.ts`). The messages name the variables only, never a value. Set the same `INTERNAL_SERVICE_TOKEN` in auth, workspace, document, ai (and task) before starting the new code.

**Since Wave 6 (startup requirements):** task-service also refuses to start without a valid `INTERNAL_SERVICE_TOKEN` (W6-SEC-06; the `.env.example` value is a `<placeholder>`, which is refused); auth-service refuses to start when `ACCESS_TOKEN_EXPIRES` or `REFRESH_TOKEN_EXPIRES` is invalid or out of bounds (W6-SEC-05); the gateway refuses an invalid `TRUST_PROXY` or `CORS_ORIGIN` with one line naming the variable (W6-SEC-01). Every message names the variable and the rule, never the value.

## 2. Runtime variables

Column key:
- **Req.** Required means the process or the feature cannot work without the variable. Optional means a default applies.
- **Sens.** Sensitive means it must never be committed or logged.

### 2.1 Secrets

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | gateway `src/middlewares/auth.middleware.ts:6`; auth `src/utils/jwt.ts:15`, `src/middlewares/auth.middleware.ts:12`; workspace `src/middlewares/auth.middleware.ts:10`; document, task, ai via `packages/shared/auth/authenticate.ts:6`; plus each `server.ts` assert (§1) | HS256 key used to sign access tokens (auth-service) and verify them (all six services) | Required: gateway, auth, workspace, document, task, ai server. Not read by the ai worker | none | ≥ 32 chars, passes §1. **Must be identical in all six services.** | yes | The process refuses to start (exit 1). A different value in one service makes every token fail there with 401. |
| `JWT_REFRESH_SECRET` | auth `src/utils/jwt.ts:16`; `src/server.ts:11` | HS256 key for refresh tokens, which only auth-service issues and verifies | Required (auth-service only) | none | ≥ 32 chars, passes §1. Must differ from `JWT_ACCESS_SECRET`: **since Wave 5 auth-service refuses to start when they are equal** (SEC-019). | yes | auth-service refuses to start (exit 1). |
| `INTERNAL_SERVICE_TOKEN` | document `src/server.ts:10`, `src/middlewares/internal-auth.middleware.ts:52` (inbound), `src/services/vector-cleanup.client.ts:19` (outbound); ai `src/server.ts:10`, `src/worker.ts:10`, `packages/shared/auth/internal-auth.middleware.ts:24` (inbound), `src/services/document-status.service.ts:49` (outbound); auth via `packages/shared/auth/internal-auth.middleware.ts:24` (inbound); workspace `src/services/workspace.service.ts:122` (outbound) | Shared secret sent in the `X-Internal-Token` header on `/internal/*` calls (see `api.md` §7) | Required: auth, workspace (since Wave 5), document, ai server, ai worker, task (since Wave 6) | none | ≥ 32 chars, passes §1. **Must be identical in auth, workspace, document, ai and task.** | yes | **auth, workspace, document, ai, task:** refuse to start (exit 1; the variable name is printed, never the value). **workspace:** if auth-service rejects the value, members are listed as `name: "Researcher"`, `email: ""`. It is also sent to task-service when a member is removed (unassigning their tasks, SEC-010). **task:** inbound on `/internal/workspaces/:id/members/:userId/unassign`; a value different from workspace-service's still makes member removal leave the removed member's tasks assigned (logged), so keep them identical. document-service also uses it inbound on `GET /internal/documents/:id/embedding-source` (SEC-006). |

### 2.2 Ports, environment mode, CORS

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `PORT` | gateway `src/server.ts:17`; auth `src/server.ts:19`; workspace `src/server.ts:17`; document `src/server.ts:22`; task `src/server.ts:17`; ai `src/server.ts:23` | HTTP listen port | Optional | `5000` / `5001` / `5002` / `5003` / `5004` / `5006` (same order) | integer | no | Falls back to the default. The ai worker does not listen. **Port already in use (Wave 4, RT-002):** the service logs `[<service>] cannot listen on <host>:<port>: EADDRINUSE` and exits 1 (it used to keep running without a listener). |
| `HOST` | every service through `packages/shared/lifecycle/listen.ts` (`startHttpServer`, SEC-004) | Interface the HTTP server binds to | Optional | `127.0.0.1` for auth, workspace, document, task and ai; `0.0.0.0` for the gateway | IP address or host name | no | **Since Wave 4 the internal services listen on loopback only**, so they are not reachable from other machines on the network; only the gateway listens on every interface. Set `HOST=0.0.0.0` for a service that must be reachable from another host or container (for example when each service runs in its own container). |
| `TRUST_PROXY` | gateway `src/config/trust-proxy.ts` (`app.set("trust proxy")`, RT-008) | How many reverse proxies in front of the gateway may set `X-Forwarded-For`. Decides the client IP that the rate limiters count | Optional | off (the socket address is the client IP) | `off`/`false`/`0`; a hop count `1`..`10`; or a comma-separated list of IP addresses, CIDR ranges (at least `/8` for IPv4 and `/32` for IPv6) or the keywords `loopback`, `linklocal`, `uniquelocal` | no | `true`, any other value, and CIDR ranges that are too wide are refused: the gateway does not start (a blanket "trust everything" would let any client choose its rate-limit key). Too wide means a prefix below `/8` (IPv4) or `/32` (IPv6), so `0.0.0.0/0` and `::/0` are refused; an IPv6 range that contains the IPv4-mapped block `::ffff:0:0/96` is refused, and a range inside that block counts as IPv4 (`::ffff:10.0.0.0/104` is the narrowest-allowed equivalent of `10.0.0.0/8`). For the private ranges use the keywords. Set it only when the gateway really is behind that many proxies. **Behind a reverse proxy it is required:** otherwise every per-IP limiter (login, register and, since Wave 5, the 60-per-minute auth limiter for refresh, `/me` and logout, SEC-021) sees the proxy's address and treats all users as one client. |
| `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` | gateway `src/app.ts` (RT-003) | How long the gateway waits on an upstream service that sends nothing (no response and no data) before it answers **504** `The service took too long to respond. Please try again.` | Optional | `120000` (120 s) | integer ms `1000..600000` | no | Invalid: default with a warning. The timer restarts on every chunk of data, so long answer streams (which send a heartbeat every 15 s) are not cut. The upstream may still finish the work after a 504. |
| `NODE_ENV` | document `src/utils/logger.ts:4`; task `src/config/db.ts:22`; workspace `src/config/db.ts:10` | document-service: winston level is `debug` when the value is `development`, otherwise `info`. task and workspace: `mongoose.connection.syncIndexes()` runs at startup unless the value is `production` | Optional | none (unset counts as "not production" and "not development") | `development` / `production` | no | Unset: document logs at `info`; task and workspace sync indexes on every start. |
| `CORS_ORIGIN` | **gateway only** since Wave 5: `services/api-gateway/src/app.ts` through `packages/shared/http/cors-origins.ts` (SEC-015). document- and task-service no longer read it and send no CORS headers | Browser origins allowed to call the API | Optional for local development; **set it in production** | unset: any loopback origin over http (`http://localhost:<any port>`, `http://127.0.0.1:<any port>`), and the gateway logs one line saying the development default is in use | Comma-separated exact origins (`scheme://host[:port]`, no path), trimmed | no | A disallowed origin gets no CORS headers (the browser blocks the response). `*`, a value with a path, or any malformed entry: the gateway refuses to start (the message names `CORS_ORIGIN`). When set, loopback origins are **not** added implicitly. |
| `API_DOCS_ENABLED` | gateway, document and task `src/app.ts` (SEC-016) | Serve Swagger UI at `/api-docs` | Optional | off | exactly `true` enables it | no | Any other value or unset: `/api-docs` is not mounted and answers the JSON 404 (ISS-041). Turn it on for local exploration only. |
| `UPLOAD_TMP_DIR` | document `src/utils/upload-tmp.ts` (SEC-024) | Folder for in-flight uploads (random names `rm-upload-<uuid>.pdf\|docx`) | Optional | `<OS temp>/researchmind-uploads` (created on demand) | absolute path | no | At startup document-service deletes, in this folder only, top-level regular files whose names match its own temp pattern and that are older than 1 hour (no subfolders, no links). It refuses to sweep (warning, no deletion) when the folder is the repository or inside it, the legacy `services/document-service/uploads`, a filesystem root or the user's home directory. The legacy `uploads` folder is never touched automatically (see the user-run hygiene script in `docs/deployment/docker-process.md`). |

### 2.3 Datastores

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `MONGO_URI` | auth `src/config/db.ts:5`; workspace `src/config/db.ts:7`; document `src/config/db.ts:9`, task `src/config/db.ts:16` and ai `src/config/db.ts:14` as a fallback, through `resolveMongoUri` (`packages/shared/lifecycle/mongo.ts:36-46`) | MongoDB connection string | Required: auth, workspace, document, task, ai server. The ai worker does not connect to MongoDB | none (no fallback URI) | `mongodb://[user:password@]host:port/<db>[?authSource=admin]` | yes (may contain credentials) | Unset: `connectMongo` throws `MongoDB is not configured: set …` and the service calls `process.exit(1)`. Unreachable: one connection attempt (Mongoose server selection, about 30 s), then exit 1. |
| `MONGODB_URI` | document `src/config/db.ts:9`; task `src/config/db.ts:16`; ai `src/config/db.ts:14` | Alternative name for the MongoDB URI. **Takes precedence over `MONGO_URI`** in these three services. auth and workspace do not read it | Optional | none | as `MONGO_URI` | yes | Unset or blank: `MONGO_URI` is used instead. |
| `REDIS_URL` | gateway `src/middlewares/rate-limit.middleware.ts:18`; document `src/config/redis.ts:16`; ai `src/config/redis.ts:12`, `src/config/redis-worker.ts:13` | Gateway: rate-limit store. document: producer for the embedding queue `researchmind:embedding:jobs`. ai: health check client and the worker's BLPOP consumer | Optional (has a default); the features above need a reachable Redis | `redis://127.0.0.1:6379` | `redis://[:password@]host:port[/db]` | yes when it contains a password | Unreachable: **gateway** rate limiters fail open without waiting for Redis (each limiter command times out after 300 ms; while the client is not ready, or for 5 s after an error, Redis is skipped), log one line per outage, and resume within seconds once Redis answers again, also when the gateway was started without Redis. **document:** `/health` returns 503. An upload still returns 201, but the document is set to `embeddingStatus: "failed"`. Re-index returns 503. **ai:** a startup warning is logged and the worker waits for Redis. `/health` returns 503. |

`MONGO_URI` / `MONGODB_URI` for the compose MongoDB: connect as the service's **own** user (root `.env` `MONGO_<SERVICE>_USERNAME` / `_PASSWORD`), naming that service's database (`MONGO_<SERVICE>_DATABASE`): `mongodb://<user>:<password>@127.0.0.1:27017/<database>?authSource=admin`. The user has `readWrite` on that database only. `REDIS_URL` for the compose Redis must carry the password: `redis://:<REDIS_PASSWORD>@127.0.0.1:6379`. Without it, Redis answers `NOAUTH`, and the effect is the same as "Unreachable" above. The code default `redis://127.0.0.1:6379` has no password, so set `REDIS_URL` explicitly in api-gateway, document-service and ai-service. Use URL-safe passwords (hex) so no percent-encoding is needed. Both ioredis versions in use (5 in ai-service, 6 in gateway/document-service) take the password from the URL (`tests/compose-security.test.ts`).

`REDIS_HOST` / `REDIS_PORT` are no longer read: auth-service's unused Redis client was removed (RT-009). Delete them from `services/auth-service/.env`.

### 2.4 Service URLs (service-to-service and gateway targets)

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `AUTH_SERVICE_URL` | gateway `src/app.ts:81`; workspace `src/services/workspace.service.ts:121` | Gateway proxy target for `/api/auth`. workspace-service calls `POST {url}/internal/users/bulk` | Optional | gateway `http://localhost:5001`; workspace `http://127.0.0.1:5001` | base URL with no path | no | Default is used. Unreachable: the gateway returns 503 (`Service temporarily unavailable. Please try again.`). workspace-service falls back to placeholder member names. |
| `WORKSPACE_SERVICE_URL` | gateway `src/app.ts:94`; document, task and ai via `packages/shared/auth/workspace-membership.ts:28` | Gateway proxy target for `/api/workspaces`. Membership checks (`GET /api/workspaces/:id/membership`) and member lists (`GET /api/workspaces/:id`) | Optional | gateway `http://localhost:5002`; shared module `http://127.0.0.1:5002` (trailing `/` removed) | base URL | no | Default is used. Unreachable, timeout (3 s) or 5xx: every membership-checked route returns **503** `Workspace access could not be verified right now. Please try again.` |
| `DOCUMENT_SERVICE_URL` | gateway `src/app.ts:107`; ai `src/services/document-status.service.ts:2` | Gateway proxy target for `/api/documents`. The ai worker calls document-service's `/internal/documents/...` | Optional | `http://localhost:5003` (both) | base URL | no | Default is used. Unreachable: the gateway returns 503, and the worker treats the error as transient. |
| `TASK_SERVICE_URL` | gateway `src/app.ts:120`; workspace `src/services/workspace.service.ts` (`unassignRemovedMemberTasks`) | Gateway: proxy target for `/api/tasks`. workspace-service: where to unassign a removed member's tasks (`POST /internal/workspaces/:id/members/:userId/unassign`, SEC-010) | Optional | gateway `http://localhost:5004`; workspace `http://127.0.0.1:5004` | base URL | no | Gateway: unreachable gives 503. workspace-service: the removal still succeeds; `tasksUnassigned` is `null` and the failure is logged. |
| `AI_SERVICE_URL` | gateway `src/app.ts:141`; document `src/services/vector-cleanup.client.ts:24` | Gateway proxy target for `/api/ai`. document-service calls `DELETE {url}/internal/vectors/...` | Optional | gateway `http://localhost:5006`; document `http://127.0.0.1:5006` | base URL | no | Default is used. Unreachable: the gateway returns 503. Document deletion is rolled back and returns **503** (15 s timeout). |

### 2.5 Auth-service token settings

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `ACCESS_TOKEN_EXPIRES` | auth `src/config/token-lifetimes.ts` (checked at startup by `src/preflight.ts`; used by `src/utils/jwt.ts`) | Access-token `expiresIn` | Optional | `"5m"` (since Wave 4, SEC-007; was `15m`) | A jsonwebtoken / `ms` duration **with a unit**, for example `5m`, `900s`; **more than 0 and at most 15 minutes** (Wave 6, W6-SEC-05). Validated by signing a probe token with jsonwebtoken itself, so an accepted value can never fail at sign-in. A value without a unit (`900`) is refused, because jsonwebtoken would read it as milliseconds | no | Unset: `5m`. Invalid, unit-less, zero/negative or over 15 minutes: **auth-service refuses to start** (`[auth-service] refusing to start: ACCESS_TOKEN_EXPIRES ...`, exit 1, value never printed). **User action:** an existing `services/auth-service/.env` that still sets `ACCESS_TOKEN_EXPIRES=15m` still starts (15m is the maximum) but overrides the 5-minute default; remove the line or set `5m`. The frontend refreshes expired access tokens transparently. |
| `REFRESH_TOKEN_EXPIRES` | auth `src/config/token-lifetimes.ts` (as above) | Refresh-token JWT `expiresIn` | Optional | `"7d"` | A duration **with a unit**; **at most 30 days and longer than the access lifetime** (Wave 6) | no | Unset: `7d`. Invalid, unit-less (for example `604800`), over 30 days, or not longer than `ACCESS_TOKEN_EXPIRES`: **auth-service refuses to start** (variable name only). The stored refresh-token record expires with the token's own `exp` (Wave 5, SEC-019). |
| `REFRESH_REUSE_GRACE_MS` | auth `src/services/auth.service.ts:208` (read on every refresh) | Window in which a just-rotated refresh token is rejected (401) **without** revoking all sessions | Optional | `10000` | integer ms. Clamped to `0..60000`; `0` disables the window | no | Unset, empty, non-numeric or negative values fall back to `10000`. |
| `LOGIN_THROTTLE_MAX_FAILURES` | auth `src/services/login-throttle.ts` (read on every login) | Failed sign-ins per account (normalised e-mail, known or unknown) that lock it | Optional | `10` | integer `1..1000` | no | Invalid values log a warning once and use the default. |
| `LOGIN_THROTTLE_WINDOW_MS` | auth `src/services/login-throttle.ts` | Window in which failures add up | Optional | `900000` (15 min) | integer ms `1000..86400000` | no | as above |
| `LOGIN_THROTTLE_LOCK_MS` | auth `src/services/login-throttle.ts` | How long a locked account answers `429` to every sign-in (no password check) | Optional | `900000` (15 min) | integer ms `1000..86400000` | no | as above |

### 2.6 AI providers (ai-service)

The ai-service reads these at **module load**. When a required one is missing, the `throw` happens during `import`, before `app.listen`, and the process crashes with the message shown. The table shows which of the two ai-service processes load each module.

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `XAI_API_KEY` | ai `src/config/grok.ts:3` | LLM API key for the OpenAI-compatible client. Used by `POST /api/ai/query` and `/summarize-meeting` | Required by the HTTP server (`XAI_API_KEY` or `GROQ_API_KEY`). The worker does not load `config/grok.ts` | none | A key starting with `gsk_` selects the Groq defaults below; any other key selects the xAI defaults | yes | Both unset: `Error: XAI_API_KEY (or GROQ_API_KEY) is not configured`, and the server does not start. A key that is wrong but present only fails per request: SSE `error` event, or 502. |
| `GROQ_API_KEY` | ai `src/config/grok.ts:3` | Alternative name, used only when `XAI_API_KEY` is unset or empty | Optional | none | as above | yes | See `XAI_API_KEY`. |
| `XAI_BASE_URL` | ai `src/config/grok.ts:18` | LLM API base URL | Optional | `https://api.groq.com/openai/v1` if the key starts with `gsk_`, else `https://api.x.ai/v1` | URL | no | Default is used. |
| `XAI_MODEL` | ai `src/config/grok.ts:22` | LLM model name. Logged at startup (`src/config/model-config.ts:10-12`) and stored on each AI session as `aiModel` | Optional | `openai/gpt-oss-120b` (Groq key) or `grok-4.5` (other key) | provider model id | no | Default is used. An unknown model fails per request (SSE `error` / 502). |
| `LLM_REQUEST_TIMEOUT_MS` | ai `src/config/timeouts.ts` (used by `grok.service.ts`, read once at load, and `meeting-summarizer.service.ts`, read per call) | Maximum time for one LLM request | Optional | `60000` | integer ms `1000..600000` | no | Unset: 60 s. An invalid or out-of-range value (`abc`, `0`, `-5`, `30s`) logs a warning once and uses the default (it used to make every LLM call fail at once, ARC-013). |
| `LLM_STREAM_IDLE_TIMEOUT_MS` | ai `src/config/timeouts.ts` (`grok.service.ts`) | Maximum gap between streamed tokens before the stream is aborted | Optional | `30000` | integer ms `1000..600000` | no | Unset: 30 s. Invalid: default with a warning. When it trips, the SSE `error` event is emitted with `partial` set to whether tokens were already sent. |
| `VOYAGE_DOCUMENT_TIMEOUT_MS` | ai `src/config/timeouts.ts` (`embedding.service.ts`) | Limit for one Voyage document-embedding batch (ISS-037) | Optional | `30000` | integer ms `1000..300000` | no | Invalid: default with a warning. On timeout the embedding job fails and the recovery sweep retries it within the attempt limit. The LangChain client itself retries at most once. |
| `VOYAGE_QUERY_TIMEOUT_MS` | ai `src/config/timeouts.ts` (`query-embedding.service.ts`) | Limit for one query embedding | Optional | `15000` | integer ms `1000..120000` | no | Invalid: default with a warning. On timeout the answer stream reports the retrieval error. |
| `PINECONE_TIMEOUT_MS` | ai `src/config/timeouts.ts` (`vector-service.ts`, `retrieval.service.ts`) | Limit for one Pinecone upsert, delete or query call | Optional | `20000` | integer ms `1000..120000` | no | Invalid: default with a warning. |
| `DOCUMENT_SOURCE_TIMEOUT_MS` | ai `src/config/timeouts.ts` (`document-status.service.ts`) | Limit for fetching a document's text from document-service (`GET /internal/documents/:id/embedding-source`, SEC-006) | Optional | `30000` | integer ms `1000..120000` | no | Invalid: default with a warning. |
| `EMBEDDING_JOB_TIMEOUT_MS` | ai `src/config/timeouts.ts` (`workers/embedding.worker.ts`) | Deadline for one whole embedding job (watchdog, ISS-037). Must stay below document-service's 15 min claim lease | Optional | `600000` (10 min) | integer ms `10000..840000` | no | Invalid: default with a warning. At the deadline the job is reported failed with its claim token (refused if the claim was taken over) and the worker takes the next job. |
| `SSE_HEARTBEAT_MS` | ai `src/config/timeouts.ts` (`controllers/query.controller.ts`) | Interval of the `: ping` comment frames on `POST /api/ai/query` | Optional | `15000` | integer ms `1000..60000` | no | Invalid: default with a warning. |
| `VOYAGE_API_KEY` | ai `src/config/voyage.ts:3` | Voyage AI embeddings key | Required by the server and the worker | none | string | yes | `Error: VOYAGE_API_KEY is not configured` at load, and the process does not start. |
| `VOYAGE_MODEL` | ai `src/config/voyage.ts:29` (`resolveEmbeddingConfig(process.env)`, `:44`) | Embedding model for both documents and queries. Recorded on each vector as `embeddingModel` | Optional, but set it explicitly | `voyage-3` | Voyage model id | no | Unset: `voyage-3`, and the server logs a warning (`src/config/model-config.ts:14-19`). Changing it requires re-indexing every document: **since Wave 4 (ISS-027) retrieval ignores vectors labelled with a different model**, so after a change existing documents are not found until they are re-indexed. Vectors without a label (indexed before the label existed, with `voyage-3`) are still used. |
| `MIN_RELEVANCE_SCORE` | ai `src/services/retrieval.service.ts` (`minRelevanceScore()`, read per query, ISS-028) | Minimum similarity score for a retrieved chunk to be used as a source | Optional | `0.2` | decimal `0..1`; `0` disables the cut-off | no | Invalid or out of range: default with a warning. If no chunk reaches the threshold, the answer uses the "no relevant document context" path and cites nothing. The default is not calibrated against an evaluation set; tune it per deployment. |
| `VOYAGE_EMBEDDING_DIMENSION` | ai `src/config/voyage.ts:32` | Embedding output dimension | Optional | `1024` | integer, 1..8192 | no | Not a positive integer ≤ 8192: throws at load. Different from the Pinecone index dimension: the server and worker exit 1 (`src/utils/verify-pinecone.ts`). If Pinecone is unreachable at startup, the check logs a warning and startup continues. |
| `PINECONE_API_KEY` | ai `src/config/pinecone.ts:3` | Pinecone key | Required by the server and the worker | none | string | yes | `Error: PINECONE_API_KEY is not configured` at load. **A key that Pinecone rejects (401) at startup is fatal since Wave 4 (RT-006):** the server and the worker exit 1 with `Pinecone rejected PINECONE_API_KEY (invalid or revoked credentials)`. Network errors at startup still only log a warning. |
| `PINECONE_INDEX` | ai `src/config/pinecone.ts:4` | Pinecone index name. Each workspace uses its own namespace | Required by the server and the worker | none | index name | no | `Error: PINECONE_INDEX is not configured` at load. |

### 2.7 Document storage (document-service)

These are not validated at startup. `cloudinary.config()` runs with whatever values are present (`src/config/cloudinary.ts:3-7`).

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | document `src/config/cloudinary.ts:4` | Cloudinary account | Required for uploads | none | string | no | The service starts. `POST /api/documents/upload` returns **502** `File storage is temporarily unavailable. Please try again later.` |
| `CLOUDINARY_API_KEY` | document `src/config/cloudinary.ts:5` | Cloudinary API key | Required for uploads | none | string | yes | As above. Asset deletion only logs the failure. |
| `CLOUDINARY_API_SECRET` | document `src/config/cloudinary.ts:6` | Cloudinary API secret | Required for uploads | none | string | yes | As above. |

### 2.8 Frontend

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `VITE_API_URL` | `frontend/src/api/axios.ts:12`; `frontend/vite.config.ts` (CSP, SEC-008) | Base URL for every API call, including the SSE `fetch` in `src/api/ai.api.ts`. Its origin is also written into the production build's Content-Security-Policy `connect-src` | Optional | `http://localhost:5000/api` | Gateway origin **including the `/api` path** (the client appends `/auth/login`, `/ai/query`, …), or a relative path such as `/api` when the gateway is served from the same origin | **no**. It is inlined into the public JS bundle at build time | Unset: the default is used (and `http://localhost:5000` is allowed by the CSP). If the `/api` path is missing, every call returns 404 from the gateway. **Set it before `npm run build`:** a build made for one API origin blocks calls to another one (CSP). |

## 3. Infrastructure (`docker-compose.yml`, `docker-compose.tools.yml`)

Docker Compose substitutes these from the shell or the root `.env` (template: `.env.example` in the repository root). No service code reads them. **There are no default credentials.** Every variable marked "required" uses `${VAR:?message}`, so `docker compose` refuses to run while it is unset or empty and names the variable. Only the host ports have defaults. Check with `docker compose config --quiet`.

| Variable | Used at | Purpose | Default | Sens. |
|---|---|---|---|---|
| `MONGO_ROOT_USERNAME` | `docker-compose.yml` (mongodb), `docker-compose.tools.yml` (mongo-express) | MongoDB root user (administration only, never used by a service); mongo-express admin login. The old name `MONGO_ROOT_USER` was never read: for an existing volume set this to the root user that already exists in it (normally `admin`), not necessarily the old value | **required** | yes |
| `MONGO_ROOT_PASSWORD` | as above | MongoDB root password | **required** | yes |
| `REDIS_PASSWORD` | `docker-compose.yml` (redis `--requirepass`) | Redis password; services put it in `REDIS_URL` | **required** | yes |
| `MONGO_<SERVICE>_USERNAME`, `MONGO_<SERVICE>_PASSWORD`, `MONGO_<SERVICE>_DATABASE` (`<SERVICE>` = `AUTH`, `WORKSPACE`, `DOCUMENT`, `TASK`, `AI`) | `docker-compose.yml` (mongodb environment), read by `docker/mongo/provision-service-users.js` | One MongoDB user per service, `readWrite` on its own database only, created in `admin`. Passwords: at least 16 URL-safe characters (`A-Z a-z 0-9 . _ ~ -`). `_DATABASE` must match the database in that service's `MONGO_URI` | **required** | password: yes |
| `MONGO_EXPRESS_USERNAME` | `docker-compose.tools.yml` | mongo-express basic-auth user | **required** (tools file only) | yes |
| `MONGO_EXPRESS_PASSWORD` | `docker-compose.tools.yml` | mongo-express basic-auth password | **required** (tools file only) | yes |
| `MONGO_HOST_PORT` | `docker-compose.yml` | Host port for MongoDB (bound to `127.0.0.1`) | `27017` | no |
| `REDIS_HOST_PORT` | `docker-compose.yml` | Host port for Redis (bound to `127.0.0.1`) | `6379` | no |
| `MONGO_EXPRESS_HOST_PORT` | `docker-compose.tools.yml` | Host port for mongo-express (bound to `127.0.0.1`) | `8081` | no |

Every port is published on `127.0.0.1` only. mongo-express is opt-in: it lives in `docker-compose.tools.yml`, not in `docker-compose.yml`. MongoDB uses `MONGO_ROOT_*` and creates the service users only when its volume is first initialised. For existing volumes, see [deployment/docker-process.md](../deployment/docker-process.md#securing-an-existing-installation-host-remediation).

## 4. Tests and CI

These variables are read only by `tests/`. The test runner is `npm test`, which runs `tsx --test tests/*.test.ts`.

| Variable | Read at | Purpose | Default | Missing |
|---|---|---|---|---|
| `TEST_COMPOSE_RUNTIME` | `tests/compose-security.runtime.test.ts` | `1` starts the repository compose files as a **throwaway** project (MongoDB, Redis, mongo-express) and runs the SEC-001/SEC-014 runtime checks; needs Docker. Removes its containers and volumes afterwards | none | The runtime suite is **skipped** (reported). |
| `TEST_COMPOSE_PROJECT`, `TEST_COMPOSE_PORT_BASE` | `tests/compose-security.runtime.test.ts` | Throwaway project name (must look like `rm*test*`) and first of five consecutive host ports (MongoDB, Redis, mongo-express, auth-service, document-service) | `rmstabtest`, `5940` | — |
| `TEST_MONGO_URI` | `tests/helpers/test-mongo.ts:14` | **Disposable** MongoDB for `*.integration.test.ts`. Each file creates and then drops its own randomly named `rmtest_*` database | none | Integration suites are **skipped**, with a printed reason. |
| `CI` | `tests/helpers/test-mongo.ts`, `tests/helpers/test-redis.ts` | Makes a missing `TEST_MONGO_URI` / `TEST_REDIS_URL` an error rather than a skip (since Wave 6 it no longer relaxes the port-6379 refusal) | none (GitHub Actions sets `CI=true`) | — |
| `RM_TEST_A`, `RM_TEST_B` | `tests/lifecycle.test.ts:196-201` | Scratch names used to test `resolveMongoUri`. They are set and restored inside the test | none | — |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN` | `tests/helpers/test-env.ts:11-13` | Set to random 64-hex values (`||=`) before the modules under test are imported | random per process | — |
| `AI_SERVICE_URL`, `DOCUMENT_SERVICE_URL`, `WORKSPACE_SERVICE_URL`, `REDIS_URL`, `REFRESH_REUSE_GRACE_MS`, `PINECONE_*`, `VOYAGE_API_KEY`, `XAI_API_KEY` | various `tests/*.test.ts` | Pointed at in-process stubs, or given dummy values, by individual tests | — | — |

| `TEST_REDIS_URL` | `tests/helpers/test-redis.ts` | **Disposable** Redis for the Redis-backed suites. Its database index is the base (0 if omitted, at most 13); the suites use base, base + 1 and base + 2 | none | Redis suites are **skipped** (reported); under `CI` the run fails. |

Since Wave 6 (`tests/helpers/infra-guard.ts`) `TEST_MONGO_URI`, `TEST_REDIS_URL` and the test process's own `MONGO_URI` / `REDIS_URL` must point at loopback hosts on non-default ports (27017 / 6379 and omitted ports are refused, also in CI; `mongodb+srv://` is refused), and a `TEST_MONGO_URI` with credentials must carry `?authSource=admin`. `tests/helpers/test-env.ts` sets `REDIS_URL=redis://127.0.0.1:6399` and `MONGO_URI=mongodb://127.0.0.1:6598/rmtest_unused` (dead ports) when they are unset. Refusals name the variable and the rule, never the URI.

CI (`.github/workflows/ci.yml`, job `test`, Wave 6) sets `TEST_MONGO_URI=mongodb://ci_root:<generated>@127.0.0.1:27018/?authSource=admin` and `TEST_REDIS_URL=redis://:<generated>@127.0.0.1:6380/7` (a `mongo:7.0` and a `redis:7.4` container started with `docker run` on loopback, per-run masked passwords), `MONGO_URI` / `REDIS_URL` on dead ports, and the count floors `UNIT_MIN_TESTS` / `TIMING_MIN_TESTS`. Job `compose-runtime` sets `TEST_COMPOSE_RUNTIME=1`, `TEST_COMPOSE_PROJECT=rmcitest`, `TEST_COMPOSE_PORT_BASE=15940` and `TMPDIR` (the runner's temp folder). GitHub sets `CI=true`. No repository secrets are used.

## 5. Discrepancies: `.env.example` files vs. code

The ai-, auth-, document- and workspace-service examples were annotated in the documentation audit of 2026-11-11 (comments and commented-out optional variables only; no active setting changed). Every name in an `.env.example` file is read by its service. The table lists variables the code reads that are still **missing** from that service's example, and remaining comment caveats.

| Service | Read by code but not in `.env.example` | Comment in `.env.example` that differs from the code |
|---|---|---|
| ai-service | `MONGODB_URI` (preferred alternative). `GROQ_API_KEY`, `XAI_BASE_URL`, `XAI_MODEL` and the two `LLM_*` timeouts are now listed commented out. | — |
| api-gateway | — | — |
| auth-service | — (`REFRESH_REUSE_GRACE_MS` is present, commented out) | `INTERNAL_SERVICE_TOKEN` sits under the "REFUSE TO BOOT" header; its comment now states that auth-service does NOT check it at startup (requests are refused per call). |
| document-service | `MONGODB_URI` (preferred alternative), `CORS_ORIGIN` | — |
| task-service | `MONGODB_URI` (preferred alternative), `CORS_ORIGIN`, `NODE_ENV` | — |
| workspace-service | `NODE_ENV` | `INTERNAL_SERVICE_TOKEN` sits under the "REFUSE TO BOOT" header; its comment now states that workspace-service does NOT check it at startup (it only checks the value is non-empty before calling auth-service). |
| frontend | — | — |

Other code/doc mismatches found:

- `ResearchMind_readme.md` §22 "Vercel Deployment" previously set `VITE_API_URL` without the `/api` path and listed `VITE_SOCKET_URL`, which no code reads. Corrected in the documentation audit of 2026-11-11 (the sample now includes `/api` and marks `VITE_SOCKET_URL` as roadmap only).
- `JWT_REFRESH_SECRET` must differ from `JWT_ACCESS_SECRET` according to the examples and `docs/onboarding.md`. Enforced at auth-service startup since Wave 5 (`assertDistinctSecrets`).
- `REFRESH_TOKEN_EXPIRES` longer than 7 days was silently capped before Wave 5; since Wave 5 the stored record follows the token's `exp`, and since Wave 6 the value is bounded at 30 days at startup.
