# Environment variables reference

Every environment variable the code reads, taken from the source on branch `fix/wave-4`. Line numbers are the line where the value is read. The values shown in this file are placeholders only.

- **Loading.** Each backend entrypoint calls `dotenv.config()` with no path, so it loads `.env` from the process working directory. The root scripts run `npm run dev --workspace=<service>`, so that directory is `services/<service>/`. Copy `services/<service>/.env.example` to `services/<service>/.env`.
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
| api-gateway | `services/api-gateway/src/server.ts:10` | `JWT_ACCESS_SECRET` |
| auth-service | `services/auth-service/src/server.ts:11` | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` |
| workspace-service | `services/workspace-service/src/server.ts:10` | `JWT_ACCESS_SECRET` |
| document-service | `services/document-service/src/server.ts:10` | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` |
| task-service | `services/task-service/src/server.ts:10` | `JWT_ACCESS_SECRET` |
| ai-service (HTTP server) | `services/ai-service/src/server.ts:10` | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` |
| ai-service (standalone worker, `npm run dev:worker` / `start:worker`) | `services/ai-service/src/worker.ts:10` | `INTERNAL_SERVICE_TOKEN` |

`INTERNAL_SERVICE_TOKEN` is **not** validated at startup by auth-service or workspace-service. Section 2.1 describes what happens in those services when it is missing.

## 2. Runtime variables

Column key:
- **Req.** Required means the process or the feature cannot work without the variable. Optional means a default applies.
- **Sens.** Sensitive means it must never be committed or logged.

### 2.1 Secrets

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | gateway `src/middlewares/auth.middleware.ts:6`; auth `src/utils/jwt.ts:15`, `src/middlewares/auth.middleware.ts:12`; workspace `src/middlewares/auth.middleware.ts:10`; document, task, ai via `packages/shared/auth/authenticate.ts:6`; plus each `server.ts` assert (§1) | HS256 key used to sign access tokens (auth-service) and verify them (all six services) | Required: gateway, auth, workspace, document, task, ai server. Not read by the ai worker | none | ≥ 32 chars, passes §1. **Must be identical in all six services.** | yes | The process refuses to start (exit 1). A different value in one service makes every token fail there with 401. |
| `JWT_REFRESH_SECRET` | auth `src/utils/jwt.ts:16`; `src/server.ts:11` | HS256 key for refresh tokens, which only auth-service issues and verifies | Required (auth-service only) | none | ≥ 32 chars, passes §1. The `.env.example` says it must differ from `JWT_ACCESS_SECRET`; **the code does not check this.** | yes | auth-service refuses to start (exit 1). |
| `INTERNAL_SERVICE_TOKEN` | document `src/server.ts:10`, `src/middlewares/internal-auth.middleware.ts:52` (inbound), `src/services/vector-cleanup.client.ts:19` (outbound); ai `src/server.ts:10`, `src/worker.ts:10`, `packages/shared/auth/internal-auth.middleware.ts:24` (inbound), `src/services/document-status.service.ts:49` (outbound); auth via `packages/shared/auth/internal-auth.middleware.ts:24` (inbound); workspace `src/services/workspace.service.ts:122` (outbound) | Shared secret sent in the `X-Internal-Token` header on `/internal/*` calls (see `api.md` §7) | Required: document, ai server, ai worker. Optional at startup: auth, workspace | none | ≥ 32 chars, passes §1. **Must be identical in auth, workspace, document and ai.** | yes | **document, ai:** refuse to start. **auth:** starts. When the value is unusable, the shared middleware rejects every `/internal/*` request with 401 and logs the reason. **workspace:** when unset, it skips the auth-service lookup. Members are then listed as `name: "Researcher"`, `email: ""` (`workspace.service.ts:131-163`). A value that auth-service rejects has the same visible effect. |

### 2.2 Ports, environment mode, CORS

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `PORT` | gateway `src/server.ts:17`; auth `src/server.ts:19`; workspace `src/server.ts:17`; document `src/server.ts:22`; task `src/server.ts:17`; ai `src/server.ts:23` | HTTP listen port | Optional | `5000` / `5001` / `5002` / `5003` / `5004` / `5006` (same order) | integer | no | Falls back to the default. The ai worker does not listen. |
| `NODE_ENV` | document `src/utils/logger.ts:4`; task `src/config/db.ts:22`; workspace `src/config/db.ts:10` | document-service: winston level is `debug` when the value is `development`, otherwise `info`. task and workspace: `mongoose.connection.syncIndexes()` runs at startup unless the value is `production` | Optional | none (unset counts as "not production" and "not development") | `development` / `production` | no | Unset: document logs at `info`; task and workspace sync indexes on every start. |
| `CORS_ORIGIN` | document `src/app.ts:15`; task `src/app.ts:16` | Allowed origins for the `cors` middleware when the service is called directly | Optional | none (unset gives `origin: true`, which reflects any origin) | Comma-separated origins. Entries are split on `,` and **not trimmed** | no | Unset allows any origin. The gateway uses `cors()` with no options (`services/api-gateway/src/app.ts:20`). The effect of this variable on browser requests that go through the gateway is **Unverified**. |

### 2.3 Datastores

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `MONGO_URI` | auth `src/config/db.ts:5`; workspace `src/config/db.ts:7`; document `src/config/db.ts:9`, task `src/config/db.ts:16` and ai `src/config/db.ts:14` as a fallback, through `resolveMongoUri` (`packages/shared/lifecycle/mongo.ts:36-46`) | MongoDB connection string | Required: auth, workspace, document, task, ai server. The ai worker does not connect to MongoDB | none (no fallback URI) | `mongodb://[user:password@]host:port/<db>[?authSource=admin]` | yes (may contain credentials) | Unset: `connectMongo` throws `MongoDB is not configured: set …` and the service calls `process.exit(1)`. Unreachable: one connection attempt (Mongoose server selection, about 30 s), then exit 1. |
| `MONGODB_URI` | document `src/config/db.ts:9`; task `src/config/db.ts:16`; ai `src/config/db.ts:14` | Alternative name for the MongoDB URI. **Takes precedence over `MONGO_URI`** in these three services. auth and workspace do not read it | Optional | none | as `MONGO_URI` | yes | Unset or blank: `MONGO_URI` is used instead. |
| `REDIS_URL` | gateway `src/middlewares/rate-limit.middleware.ts:18`; document `src/config/redis.ts:16`; ai `src/config/redis.ts:12`, `src/config/redis-worker.ts:13` | Gateway: rate-limit store. document: producer for the embedding queue `researchmind:embedding:jobs`. ai: health check client and the worker's BLPOP consumer | Optional (has a default); the features above need a reachable Redis | `redis://127.0.0.1:6379` | `redis://[:password@]host:port[/db]` | yes when it contains a password | Unreachable: **gateway** rate limiters fail open, and the error is logged once. **document:** `/health` returns 503. An upload still returns 201, but the document is set to `embeddingStatus: "failed"`. Re-index returns 503. **ai:** a startup warning is logged and the worker waits for Redis. `/health` returns 503. |
| `REDIS_HOST` | auth `src/config/redis.ts:5` | node-redis client host | Optional (no auth-service route uses Redis; `server.ts:24-28`) | none (`undefined` is passed to node-redis) | hostname | no | The connection runs in the background. Failures are logged and do not block startup. The node-redis default when the value is `undefined` is **Unverified**. |
| `REDIS_PORT` | auth `src/config/redis.ts:6` | node-redis client port | Optional (as above) | none (`Number(undefined)` is `NaN`) | integer | no | As above. The behaviour with a `NaN` port is **Unverified**. |

### 2.4 Service URLs (service-to-service and gateway targets)

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `AUTH_SERVICE_URL` | gateway `src/app.ts:81`; workspace `src/services/workspace.service.ts:121` | Gateway proxy target for `/api/auth`. workspace-service calls `POST {url}/internal/users/bulk` | Optional | gateway `http://localhost:5001`; workspace `http://127.0.0.1:5001` | base URL with no path | no | Default is used. Unreachable: the gateway returns 503 (`Service temporarily unavailable. Please try again.`). workspace-service falls back to placeholder member names. |
| `WORKSPACE_SERVICE_URL` | gateway `src/app.ts:94`; document, task and ai via `packages/shared/auth/workspace-membership.ts:28` | Gateway proxy target for `/api/workspaces`. Membership checks (`GET /api/workspaces/:id/membership`) and member lists (`GET /api/workspaces/:id`) | Optional | gateway `http://localhost:5002`; shared module `http://127.0.0.1:5002` (trailing `/` removed) | base URL | no | Default is used. Unreachable, timeout (3 s) or 5xx: every membership-checked route returns **503** `Workspace access could not be verified right now. Please try again.` |
| `DOCUMENT_SERVICE_URL` | gateway `src/app.ts:107`; ai `src/services/document-status.service.ts:2` | Gateway proxy target for `/api/documents`. The ai worker calls document-service's `/internal/documents/...` | Optional | `http://localhost:5003` (both) | base URL | no | Default is used. Unreachable: the gateway returns 503, and the worker treats the error as transient. |
| `TASK_SERVICE_URL` | gateway `src/app.ts:120` | Gateway proxy target for `/api/tasks` | Optional | `http://localhost:5004` | base URL | no | Default is used. Unreachable: 503. |
| `AI_SERVICE_URL` | gateway `src/app.ts:141`; document `src/services/vector-cleanup.client.ts:24` | Gateway proxy target for `/api/ai`. document-service calls `DELETE {url}/internal/vectors/...` | Optional | gateway `http://localhost:5006`; document `http://127.0.0.1:5006` | base URL | no | Default is used. Unreachable: the gateway returns 503. Document deletion is rolled back and returns **503** (15 s timeout). |

### 2.5 Auth-service token settings

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `ACCESS_TOKEN_EXPIRES` | auth `src/utils/jwt.ts:31` | Access-token `expiresIn` | Optional | `"15m"` | jsonwebtoken / `ms` string, for example `15m`, `1h`. The value always arrives as a string, so a bare number such as `900` would be read as milliseconds by `ms` (**Unverified**) | no | Unset: `15m`. An invalid value makes `jwt.sign` throw while tokens are issued, so register/login return 500 (**Unverified**). |
| `REFRESH_TOKEN_EXPIRES` | auth `src/utils/jwt.ts:37` | Refresh-token JWT `expiresIn` | Optional | `"7d"` | as above | no | Unset: `7d`. **Caveat:** the stored refresh-token record always expires after 7 days (`src/services/auth.service.ts:19-20`, MongoDB TTL index). A value longer than 7 days does not extend sessions. Once the record is gone, presenting the token counts as reuse and revokes all of the user's sessions. |
| `REFRESH_REUSE_GRACE_MS` | auth `src/services/auth.service.ts:208` (read on every refresh) | Window in which a just-rotated refresh token is rejected (401) **without** revoking all sessions | Optional | `10000` | integer ms. Clamped to `0..60000`; `0` disables the window | no | Unset, empty, non-numeric or negative values fall back to `10000`. |

### 2.6 AI providers (ai-service)

The ai-service reads these at **module load**. When a required one is missing, the `throw` happens during `import`, before `app.listen`, and the process crashes with the message shown. The table shows which of the two ai-service processes load each module.

| Variable | Read by (file:line) | Purpose | Req. | Default | Format | Sens. | Missing / invalid |
|---|---|---|---|---|---|---|---|
| `XAI_API_KEY` | ai `src/config/grok.ts:3` | LLM API key for the OpenAI-compatible client. Used by `POST /api/ai/query` and `/summarize-meeting` | Required by the HTTP server (`XAI_API_KEY` or `GROQ_API_KEY`). The worker does not load `config/grok.ts` | none | A key starting with `gsk_` selects the Groq defaults below; any other key selects the xAI defaults | yes | Both unset: `Error: XAI_API_KEY (or GROQ_API_KEY) is not configured`, and the server does not start. A key that is wrong but present only fails per request: SSE `error` event, or 502. |
| `GROQ_API_KEY` | ai `src/config/grok.ts:3` | Alternative name, used only when `XAI_API_KEY` is unset or empty | Optional | none | as above | yes | See `XAI_API_KEY`. |
| `XAI_BASE_URL` | ai `src/config/grok.ts:18` | LLM API base URL | Optional | `https://api.groq.com/openai/v1` if the key starts with `gsk_`, else `https://api.x.ai/v1` | URL | no | Default is used. |
| `XAI_MODEL` | ai `src/config/grok.ts:22` | LLM model name. Logged at startup (`src/config/model-config.ts:10-12`) and stored on each AI session as `aiModel` | Optional | `openai/gpt-oss-120b` (Groq key) or `grok-4.5` (other key) | provider model id | no | Default is used. An unknown model fails per request (SSE `error` / 502). |
| `LLM_REQUEST_TIMEOUT_MS` | ai `src/services/grok.service.ts:9` (read once at load); `src/services/meeting-summarizer.service.ts:156` (read on every call) | Maximum time for one LLM request | Optional | `60000` | integer ms | no | Unset: 60 s. A non-numeric value produces `NaN`, and the SDK behaviour with `NaN` is **Unverified**. |
| `LLM_STREAM_IDLE_TIMEOUT_MS` | ai `src/services/grok.service.ts:19` | Maximum gap between streamed tokens before the stream is aborted | Optional | `30000` | integer ms | no | Unset: 30 s. When it trips, the SSE `error` event is emitted with `partial` set to whether tokens were already sent. |
| `VOYAGE_API_KEY` | ai `src/config/voyage.ts:3` | Voyage AI embeddings key | Required by the server and the worker | none | string | yes | `Error: VOYAGE_API_KEY is not configured` at load, and the process does not start. |
| `VOYAGE_MODEL` | ai `src/config/voyage.ts:29` (`resolveEmbeddingConfig(process.env)`, `:44`) | Embedding model for both documents and queries. Recorded on each vector as `embeddingModel` | Optional, but set it explicitly | `voyage-3` | Voyage model id | no | Unset: `voyage-3`, and the server logs a warning (`src/config/model-config.ts:14-19`). Changing it requires re-indexing every document. |
| `VOYAGE_EMBEDDING_DIMENSION` | ai `src/config/voyage.ts:32` | Embedding output dimension | Optional | `1024` | integer, 1..8192 | no | Not a positive integer ≤ 8192: throws at load. Different from the Pinecone index dimension: the server and worker exit 1 (`src/utils/verify-pinecone.ts`). If Pinecone is unreachable at startup, the check logs a warning and startup continues. |
| `PINECONE_API_KEY` | ai `src/config/pinecone.ts:3` | Pinecone key | Required by the server and the worker | none | string | yes | `Error: PINECONE_API_KEY is not configured` at load. |
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
| `VITE_API_URL` | `frontend/src/api/axios.ts:12` | Base URL for every API call, including the SSE `fetch` in `src/api/ai.api.ts` | Optional | `http://localhost:5000/api` | Gateway origin **including the `/api` path** (the client appends `/auth/login`, `/ai/query`, …) | **no**. It is inlined into the public JS bundle at build time | Unset: the default is used. If the `/api` path is missing, every call returns 404 from the gateway. |

## 3. Infrastructure (`docker-compose.yml`)

Docker Compose substitutes these from the shell or a root `.env`. No service code reads them. Their values must match the credentials inside `MONGO_URI`.

| Variable | Used at | Purpose | Default in compose | Sens. |
|---|---|---|---|---|
| `MONGO_ROOT_USERNAME` | `docker-compose.yml:24`, `:58` | MongoDB root user; mongo-express admin user | `admin` | yes |
| `MONGO_ROOT_PASSWORD` | `docker-compose.yml:25`, `:59` | MongoDB root password | an insecure literal fallback. **Override it** | yes |
| `MONGO_EXPRESS_USERNAME` | `docker-compose.yml:61` | mongo-express basic-auth user | `admin` | yes |
| `MONGO_EXPRESS_PASSWORD` | `docker-compose.yml:62` | mongo-express basic-auth password | an insecure literal fallback. **Override it** | yes |

The compose file publishes MongoDB (27017), Redis (6379, no password) and mongo-express (8081) on all interfaces (`docker-compose.yml:8-9`).

## 4. Tests and CI

These variables are read only by `tests/`. The test runner is `npm test`, which runs `tsx --test tests/*.test.ts`.

| Variable | Read at | Purpose | Default | Missing |
|---|---|---|---|---|
| `TEST_MONGO_URI` | `tests/helpers/test-mongo.ts:14` | **Disposable** MongoDB for `*.integration.test.ts`. Each file creates and then drops its own randomly named `rmtest_*` database | none | Integration suites are **skipped**, with a printed reason. |
| `CI` | `tests/helpers/test-mongo.ts:18` | Makes a missing `TEST_MONGO_URI` an error rather than a skip | none (GitHub Actions sets `CI=true`) | — |
| `RM_TEST_A`, `RM_TEST_B` | `tests/lifecycle.test.ts:196-201` | Scratch names used to test `resolveMongoUri`. They are set and restored inside the test | none | — |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN` | `tests/helpers/test-env.ts:11-13` | Set to random 64-hex values (`||=`) before the modules under test are imported | random per process | — |
| `AI_SERVICE_URL`, `DOCUMENT_SERVICE_URL`, `WORKSPACE_SERVICE_URL`, `REDIS_URL`, `REFRESH_REUSE_GRACE_MS`, `PINECONE_*`, `VOYAGE_API_KEY`, `XAI_API_KEY` | various `tests/*.test.ts` | Pointed at in-process stubs, or given dummy values, by individual tests | — | — |

CI (`.github/workflows/ci.yml:54-58`) sets only `TEST_MONGO_URI: mongodb://localhost:27017`, backed by a `mongo:7` service container (`ci.yml:15-24`). No other variables are set in CI.

## 5. Discrepancies: `.env.example` files vs. code

The ai-, auth-, document- and workspace-service examples were annotated in the documentation audit of 2026-11-11 (comments and commented-out optional variables only; no active setting changed). Every name in an `.env.example` file is read by its service. The table lists variables the code reads that are still **missing** from that service's example, and remaining comment caveats.

| Service | Read by code but not in `.env.example` | Comment in `.env.example` that differs from the code |
|---|---|---|
| ai-service | `MONGODB_URI` (preferred alternative). `GROQ_API_KEY`, `XAI_BASE_URL`, `XAI_MODEL` and the two `LLM_*` timeouts are now listed commented out. | — |
| api-gateway | — | — |
| auth-service | — (`REFRESH_REUSE_GRACE_MS` is present, commented out) | `INTERNAL_SERVICE_TOKEN` sits under the "REFUSE TO BOOT" header; its comment now states that auth-service does NOT check it at startup (requests are refused per call). `REDIS_HOST`/`REDIS_PORT` are listed, but no auth-service route uses Redis. |
| document-service | `MONGODB_URI` (preferred alternative), `CORS_ORIGIN` | — |
| task-service | `MONGODB_URI` (preferred alternative), `CORS_ORIGIN`, `NODE_ENV` | — |
| workspace-service | `NODE_ENV` | `INTERNAL_SERVICE_TOKEN` sits under the "REFUSE TO BOOT" header; its comment now states that workspace-service does NOT check it at startup (it only checks the value is non-empty before calling auth-service). |
| frontend | — | — |

Other code/doc mismatches found:

- `ResearchMind_readme.md` §22 "Vercel Deployment" previously set `VITE_API_URL` without the `/api` path and listed `VITE_SOCKET_URL`, which no code reads. Corrected in the documentation audit of 2026-11-11 (the sample now includes `/api` and marks `VITE_SOCKET_URL` as roadmap only).
- `JWT_REFRESH_SECRET` must differ from `JWT_ACCESS_SECRET` according to the examples and `docs/onboarding.md`. This is not enforced.
- `REFRESH_TOKEN_EXPIRES` longer than 7 days is silently capped (§2.5).
