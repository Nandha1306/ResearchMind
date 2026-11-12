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
- Rate limiting with `express-rate-limit`, stored in Redis (`REDIS_URL`); if Redis is unreachable the limiters fail open:
  - `POST /api/auth/login`: 5 per 15 minutes per IP (successful logins are not counted);
  - `POST /api/auth/register`: 3 per hour per IP;
  - `POST /api/ai/query` and `POST /api/ai/search`: 30 per hour per user (shared limiter);
  - `POST /api/ai/summarize-meeting`: 20 per hour per user;
  - all authenticated `/api/workspaces`, `/api/documents`, `/api/tasks`, `/api/ai` routes: 100 per minute per user.
- Answering `503` when a downstream service cannot be reached.
- Hosting interactive Swagger UI documentation at `/api-docs/`.
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
| `GET` | `/api-docs` | Interactive Swagger API UI | No |

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
- **Optional:** `PORT` (default `5000`); `AUTH_SERVICE_URL`, `WORKSPACE_SERVICE_URL`, `DOCUMENT_SERVICE_URL`, `TASK_SERVICE_URL`, `AI_SERVICE_URL` (default `http://localhost:<port>` of each service); `REDIS_URL` (rate-limit store, default `redis://127.0.0.1:6379`; without Redis the limiters fail open).
- The gateway's `/health` always answers `200`; it does not check Redis or the downstream services.

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

Run from the repository root: one `npm install` there installs every workspace. The service reads `services/api-gateway/.env` (copy `.env.example`). Status: TESTED = run in the Wave 1–4 audits, UNTESTED = not run.

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
