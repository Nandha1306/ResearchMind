# Auth Service (`auth-service`)

User authentication, password hashing, and token management service for the **ResearchMind** platform.

---

## 1. Purpose
The Auth Service manages user accounts, registration, authentication, password hashing, JWT token creation (access and refresh tokens), token refreshing, and user session management.

---

## 2. Responsibilities
- User account creation with hashed passwords using `bcryptjs`.
- Login validation and issuing signed JWT access and refresh tokens.
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
│   ├── config/               # Database and Redis connection configurations (Redis is connected but not used by any route)
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

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | default `5001` | No |
| `MONGO_URI` | MongoDB connection string (this service reads only `MONGO_URI`) | `mongodb://<user>:<password>@127.0.0.1:27017/researchmind-auth?authSource=admin` | Yes |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection (connected at startup, not used by any route; startup does not wait for it) | `127.0.0.1` / `6379` | No |
| `ACCESS_TOKEN_EXPIRES` | Access token lifetime | default `15m` | No |
| `REFRESH_TOKEN_EXPIRES` | Refresh token lifetime | default `7d` | No |
| `REFRESH_REUSE_GRACE_MS` | Grace window for concurrent refreshes (0 disables, max 60000) | default `10000` | No |
| `JWT_ACCESS_SECRET` | Shared access-token signing key (same value in every service) | _(none — required)_ | Yes |
| `JWT_REFRESH_SECRET` | Refresh-token signing key, different from `JWT_ACCESS_SECRET` | _(none — required)_ | Yes |
| `INTERNAL_SERVICE_TOKEN` | Shared secret for `/internal/users/bulk` (same value as workspace-service); without it every internal request is rejected | _(none)_ | For member names in workspace-service |

The service refuses to start if `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` is missing, a placeholder, or shorter than 32 characters.

---

## 6. Dependencies
- **`bcryptjs`**: Password hashing.
- **`jsonwebtoken`**: JWT access and refresh token signing and verification.
- **`mongoose`**: MongoDB ODM for User persistence (`researchmind-auth`).
- **`redis`**: Redis client (connected, currently unused by any route).

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Start dev server with live reload
npm run dev

# Build TypeScript to dist/
npm run build

# Start compiled production server
npm run start
```
