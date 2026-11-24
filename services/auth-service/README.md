# Auth Service (`auth-service`)

User authentication, password hashing, and token management service for the **ResearchMind** platform.

---

## 1. Purpose
The Auth Service manages user accounts, registration, authentication, password hashing, JWT token creation (access and refresh tokens), token refreshing, and user session management.

---

## 2. Responsibilities
- User account creation with hashed passwords using `bcryptjs`.
- Login validation and issuing signed JWT access and refresh tokens.
- Per-account sign-in throttle (`src/services/login-throttle.ts`, `LoginThrottle` model, MongoDB): after 10 failed sign-ins for one e-mail (wrong password or unknown account alike) within 15 minutes, every sign-in for it answers `429` for 15 minutes without a password check; a successful sign-in clears the count. Independent of Redis and of the gateway's per-IP limit.
- Refresh token rotation via `/api/auth/refresh`: the refresh token is sent in the JSON request body (no cookie). Only its SHA-256 hash is stored, in MongoDB (`RefreshToken` model). Every refresh rotates the pair; presenting a token that was already rotated revokes all of that user's sessions (reuse detection), except within a short grace window (`REFRESH_REUSE_GRACE_MS`, default 10 s) where a concurrent refresh from a second tab is rejected with `401` without revoking anything.
- Logout via `/api/auth/logout` (revokes the named refresh token).
- Fetching authenticated user profile via `/api/auth/me`.
- Internal user lookup for workspace-service (`POST /internal/users/bulk`), protected by the `X-Internal-Token` header (`INTERNAL_SERVICE_TOKEN`).
- Not implemented: password reset, profile update, Google sign-in.

---

## 3. Folder Structure
```
auth-service/
├── src/
│   ├── config/               # Database connection configuration (auth-service does not use Redis)
│   ├── controllers/          # Route handlers (register, login, refresh, me, logout)
│   ├── middlewares/          # JWT authentication middleware
│   ├── models/               # User and RefreshToken Mongoose schemas
│   ├── routes/               # auth.routes.ts, internal.routes.ts
│   ├── services/             # Business logic & token management
│   ├── app.ts                # Express application setup
│   └── server.ts             # Server entry point
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

This table summarises this service's routes. The cross-service reference (request/response shapes, errors) is [docs/reference/api.md](../../docs/reference/api.md); where they differ, that file and the code are correct.

Mounted under `/api/auth` (port 5001, proxied through API Gateway on port 5000):

| Method | Endpoint | Description | Auth Required | Request Body |
|--------|----------|-------------|---------------|--------------|
| `GET`  | `/health` | Service health check | No | None |
| `POST` | `/api/auth/register` | Register a new user | No | `{ name, email, password }` |
| `POST` | `/api/auth/login` | Authenticate user & issue tokens | No | `{ email, password }` |
| `POST` | `/api/auth/refresh` | Rotate the token pair (new access + refresh token) | No | `{ refreshToken }` |
| `POST` | `/api/auth/logout` | Revoke the given refresh token | Yes (`Bearer <token>`) | `{ refreshToken }` |
| `GET`  | `/api/auth/me` | Fetch authenticated user profile | Yes (`Bearer <token>`) | None |
| `POST` | `/internal/users/bulk` | Internal: names/emails for a list of user ids | `X-Internal-Token` | `{ userIds }` |

Swagger UI is not served by this service; the gateway serves Swagger UI (which includes the auth routes) at `http://localhost:5000/api-docs`.

---

## 5. Environment Variables

Full list, defaults and examples: [docs/reference/environment-variables.md](../../docs/reference/environment-variables.md).

- **Required:** `MONGO_URI` (this service reads only `MONGO_URI`), `JWT_ACCESS_SECRET` (same value in every service), `JWT_REFRESH_SECRET` (must differ from `JWT_ACCESS_SECRET`), `INTERNAL_SERVICE_TOKEN` (same value as workspace-service; used by `/internal/users/bulk`). Since Wave 5 the service refuses to start if any of the three is missing, a placeholder, shorter than 32 characters or a known-insecure value, **or if the two JWT secrets are equal** (SEC-018, SEC-019). The message names the variable only.
- **Token checks (SEC-019).** Access and refresh tokens are verified with HS256 only, and their `userId` must be a 24-character hex id; anything else is `401`. The stored refresh-token expiry is taken from the token's own `exp`.
- **Optional:** `PORT` (default `5001`), `HOST` (default `127.0.0.1`; set `0.0.0.0` for container or multi-host use), `ACCESS_TOKEN_EXPIRES` (default `5m` since Wave 4; an existing `.env` with `15m` keeps the old value, remove it), `REFRESH_TOKEN_EXPIRES` (default `7d`), `REFRESH_REUSE_GRACE_MS` (default `10000`; `0` disables, capped at `60000`). `LOGIN_THROTTLE_MAX_FAILURES` (default `10`), `LOGIN_THROTTLE_WINDOW_MS` (default `900000`), `LOGIN_THROTTLE_LOCK_MS` (default `900000`): per-account sign-in throttle, see below. auth-service does not use Redis (`REDIS_HOST` / `REDIS_PORT` are no longer read).

---

## 6. Dependencies
- **`bcryptjs`**: Password hashing.
- **`jsonwebtoken`**: JWT access and refresh token signing and verification.
- **`mongoose`**: MongoDB ODM for User persistence (`researchmind-auth`).
- No Redis: the unused client was removed (RT-009) and the `redis` declaration was removed with the Wave 4 lockfile update.

---

## 7. Local Development Commands

Run from the repository root: one `npm install` there installs every workspace. The service reads `services/auth-service/.env` (create it from `.env.example` only if it does not exist yet: `cp -n services/auth-service/.env.example services/auth-service/.env`, PowerShell `if (-not (Test-Path services/auth-service/.env)) { Copy-Item services/auth-service/.env.example services/auth-service/.env }`; never copy over an existing `.env`). Status: TESTED = run in the Wave 1–4 audits, UNTESTED = not run.

```bash
npm run dev:auth                    # live reload (nodemon + ts-node), same as `npm run dev -w auth-service`  [UNTESTED]
npm run build -w auth-service       # compile to services/auth-service/dist  [TESTED]
npm start -w auth-service           # run the compiled server  [TESTED]
./node_modules/.bin/tsc --noEmit -p services/auth-service   # typecheck, as CI does  [TESTED]
curl http://localhost:5001/health             # service health  [UNTESTED]
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
