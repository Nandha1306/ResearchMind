# API Gateway (`api-gateway`)

Central reverse proxy, authentication verification, and API router for the **ResearchMind** microservices ecosystem.

---

## 1. Purpose
The API Gateway serves as the single public HTTP entry point (`http://localhost:5000/api`). It applies rate limiting, security headers via Helmet, CORS policies, validates JWT access tokens, and routes traffic downstream to target microservices. It does **not** check workspace membership: each downstream service verifies the JWT again and asks workspace-service whether the caller belongs to the workspace.

---

## 2. Responsibilities
- Proxying `/api/auth/*` traffic to Auth Service (port 5001).
- Authenticating and proxying `/api/workspaces/*` traffic to Workspace Service (port 5002).
- Authenticating and proxying `/api/documents/*` traffic to Document Service (port 5003).
- Authenticating and proxying `/api/tasks/*` traffic to Task Service (port 5004).
- Authenticating and proxying `/api/ai/*` traffic to AI Service (port 5006) with SSE streaming support.
- Rejecting non-canonical request paths with `400` before any other middleware (`src/middlewares/path-guard.middleware.ts`): repeated slashes, backslashes, `.`/`..` segments, percent-encoded `/` `\` `.` and other unreserved characters, NUL. Otherwise a variant such as `/api/auth//login` skipped the limiters while the proxy still delivered it. One trailing slash is accepted and counts against the same limit.
- Rate limiting with `express-rate-limit`, stored in Redis (`REDIS_URL`). If Redis is down, frozen or not yet connected the limiters fail open immediately (300 ms command timeout, Redis skipped while not ready and for 5 s after an error, one log line per outage) and resume once Redis answers again, also when the gateway started without Redis:
  - `POST /api/auth/login`: 5 per 15 minutes per IP (successful logins are not counted);
  - `POST /api/auth/register`: 3 per hour per IP;
  - `POST /api/ai/query` and `POST /api/ai/search`: 30 per hour per user (shared limiter);
  - `POST /api/ai/summarize-meeting`: 20 per hour per user;
  - all authenticated `/api/workspaces`, `/api/documents`, `/api/tasks`, `/api/ai` routes: 100 per minute per user.
- Answering `503` when a downstream service cannot be reached.
- Hosting interactive Swagger UI documentation at `/api-docs/` when `API_DOCS_ENABLED=true` (off by default since Wave 5, SEC-016).
- Applying the CORS allow-list (`CORS_ORIGIN`; unset = loopback origins only, for local development; SEC-015) and answering unknown routes with a JSON `404 Route not found` (ISS-041).
- Standardizing HTTP response headers with Helmet.

---

## 3. Folder Structure
```
api-gateway/
├── src/
│   ├── middlewares/
│   │   ├── auth.middleware.ts        # JWT token verification middleware
│   │   └── rate-limit.middleware.ts  # Express rate limiting configuration
│   ├── app.ts                        # Express application & proxy route definitions
│   ├── server.ts                     # HTTP server startup script
│   └── swagger.json                  # OpenAPI 3.0 static specification
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

This table summarises this service's routes. The cross-service reference (request/response shapes, errors) is [docs/reference/api.md](../../docs/reference/api.md); where they differ, that file and the code are correct.

### Native Gateway Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/health` | Gateway health check status | No |
| `GET` | `/api-docs` | Interactive Swagger API UI (only when `API_DOCS_ENABLED=true`) | No |

### Proxied Microservice Routes
| Match Path | Target Service | Auth Middleware | Default Target URL |
|------------|----------------|-----------------|--------------------|
| `/api/auth/*` | Auth Service | Public (Gateway pass-through) | `http://localhost:5001` |
| `/api/workspaces/*` | Workspace Service | Gateway `authenticate()` (JWT) | `http://localhost:5002` |
| `/api/documents/*` | Document Service | Gateway `authenticate()` (JWT) | `http://localhost:5003` |
| `/api/tasks/*` | Task Service | Gateway `authenticate()` (JWT) | `http://localhost:5004` |
| `/api/ai/*` | AI Service | Gateway `authenticate()` (JWT) | `http://localhost:5006` |

---

## 5. Environment Variables

Full list, defaults and examples: [docs/reference/environment-variables.md](../../docs/reference/environment-variables.md).

- **Required:** `JWT_ACCESS_SECRET` (same value in every service). The gateway refuses to start if it is missing, a placeholder, shorter than 32 characters or a known-insecure value.
- **Optional:** `PORT` (default `5000`); `AUTH_SERVICE_URL`, `WORKSPACE_SERVICE_URL`, `DOCUMENT_SERVICE_URL`, `TASK_SERVICE_URL`, `AI_SERVICE_URL` (default `http://localhost:<port>` of each service); `REDIS_URL` (rate-limit store, default `redis://127.0.0.1:6379`; without Redis the limiters fail open). The compose Redis requires a password, so set `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379` (root `.env` value); with the passwordless default every Redis command fails with `NOAUTH` (logged) and the limiters fail open, so nothing is rate-limited.
- **Wave 4 settings:** `HOST` (default `0.0.0.0` for the gateway), `TRUST_PROXY` (off by default; a hop count `1`..`10` or an address/CIDR list when behind reverse proxies; `true` and CIDRs wider than `/8` IPv4 or `/32` IPv6 are refused, RT-008), `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` (default `120000`; a silent upstream gets `504`, RT-003).
- **Wave 5 settings:** `CORS_ORIGIN` (comma-separated exact origins; unset = any `http://localhost:<port>` / `http://127.0.0.1:<port>` origin, logged at startup; `*` or a malformed entry stops the gateway; **set it in production**, SEC-015), `API_DOCS_ENABLED` (`true` serves Swagger UI, SEC-016). `TRUST_PROXY` is required behind a reverse proxy, also for the new per-IP auth limiter (60/min on every `/api/auth` route, SEC-021).
- The gateway's `/health` always answers `200`. It reports `status: "degraded"` and `dependencies.rateLimitStore: "down"` while its Redis is not ready (ISS-044); it does not check the downstream services.
- Every response carries `X-Request-ID` (kept from the client if it is a safe value, otherwise generated) and the id is forwarded upstream and logged. Responses carry helmet's default Content-Security-Policy (SEC-008).

---

## 6. Dependencies
- **`express`**: Base HTTP framework.
- **`http-proxy-middleware`**: Downstream request proxying.
- **`express-rate-limit`** + **`rate-limit-redis`** + **`ioredis`**: Rate limiting backed by Redis.
- **`jsonwebtoken`**: JWT signature verification.
- **`swagger-ui-express`**: Renders Swagger UI at `/api-docs`.
- **`helmet`**: Security header management.

---

## 7. Local Development Commands

Run from the repository root: one `npm install` there installs every workspace. The service reads `services/api-gateway/.env` (create it from `.env.example` only if it does not exist yet: `cp -n services/api-gateway/.env.example services/api-gateway/.env`, PowerShell `if (-not (Test-Path services/api-gateway/.env)) { Copy-Item services/api-gateway/.env.example services/api-gateway/.env }`; never copy over an existing `.env`). Status: TESTED = run in the Wave 1–4 audits, UNTESTED = not run.

```bash
npm run dev:gateway                 # live reload (nodemon + ts-node), same as `npm run dev -w api-gateway`  [UNTESTED]
npm run build -w api-gateway        # compile to services/api-gateway/dist  [TESTED]
npm start -w api-gateway            # run the compiled server  [TESTED]
./node_modules/.bin/tsc --noEmit -p services/api-gateway   # typecheck, as CI does  [TESTED]
curl http://localhost:5000/health             # service health  [UNTESTED]
```

This service has no test script of its own; its tests are in the root `tests/` folder and run with `npm test` (see [Testing](../../docs/testing.md)).

---

## 8. Related Documentation

- [Developer onboarding](../../docs/onboarding.md)
- [Environment variables](../../docs/reference/environment-variables.md)
- [API reference](../../docs/reference/api.md)
- [Testing](../../docs/testing.md)
- [Deployment and operations](../../docs/deployment/docker-process.md)
- [Security model](../../docs/architecture/security.md)
