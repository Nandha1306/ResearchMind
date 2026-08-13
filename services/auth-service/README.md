# Auth Service (`auth-service`)

User authentication, password hashing, and token issuing service for the **ResearchMind** platform.

---

## 1. Purpose
The Auth Service manages user accounts, registration, login authentication, password hashing, JWT token creation (access & refresh tokens), refresh token revocation, and user profile retrieval.

---

## 2. Responsibilities
- User account creation with hashed passwords (`bcryptjs`).
- Login validation and issuing signed JWT access and refresh tokens.
- Token refresh endpoint to issue new access tokens.
- Session logout and refresh token revocation storing active tokens in Redis / MongoDB.
- Current user profile endpoint (`GET /api/auth/me`).

---

## 3. Folder Structure
```
auth-service/
├── src/
│   ├── config/               # Database and Redis connection configurations
│   ├── controllers/          # Route handlers (register, login, refresh, me, logout)
│   ├── middlewares/          # JWT authentication middleware
│   ├── models/               # User and Token Mongoose schemas
│   ├── routes/               # Express auth router (auth.routes.ts)
│   ├── services/             # Business logic & token management
│   ├── app.ts                # Express application setup
│   └── server.ts             # Server entry point
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

All endpoints are mounted under `/api/auth` (proxied from API Gateway port 5000 or directly on port 5001):

| Method | Endpoint | Description | Auth Required | Request Body / Query |
|--------|----------|-------------|---------------|----------------------|
| `POST` | `/api/auth/register` | Register a new user | No | `{ name, email, password }` |
| `POST` | `/api/auth/login` | Authenticate user & issue tokens | No | `{ email, password }` |
| `POST` | `/api/auth/refresh` | Issue new access token | No | `{ refreshToken }` |
| `GET`  | `/api/auth/me` | Fetch authenticated user profile | Yes (`Bearer <token>`) | None |
| `POST` | `/api/auth/logout` | Revoke refresh token & logout | No | `{ refreshToken }` |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | `5001` | Yes |
| `MONGO_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/researchmind_auth` | Yes |
| `REDIS_URL` | Redis connection URL | `redis://127.0.0.1:6379` | Optional |
| `JWT_ACCESS_SECRET` | Secret key for signing access tokens | `supersecretkey` | Yes |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | `superrefreshsecretkey` | Yes |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` | Optional |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` | Optional |

---

## 6. Dependencies
- **`bcryptjs`**: Password hashing.
- **`jsonwebtoken`**: JWT access and refresh token signing and verification.
- **`mongoose`**: MongoDB ORM for User persistence.
- **`redis`**: Cache and token blacklist / session storage.
- **`cookie-parser`**: Parses HTTP cookies if refreshToken is set in cookie.

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Start dev server with nodemon
npm run dev

# Build TypeScript to dist/
npm run build

# Start production build
npm run start
```
