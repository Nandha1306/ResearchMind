# Auth Service (`auth-service`)

User authentication, password hashing, and token management service for the **ResearchMind** platform.

---

## 1. Purpose
The Auth Service manages user accounts, registration, authentication, password hashing, JWT token creation (access and refresh tokens), token refreshing, and user session management.

---

## 2. Responsibilities
- User account creation with hashed passwords using `bcryptjs`.
- Login validation and issuing signed JWT access and refresh tokens.
- Refresh token rotation via `/api/auth/refresh`.
- Fetching authenticated user profile via `/api/auth/me`.
- Hosting interactive Swagger API documentation at `/api-docs/`.

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

Mounted under `/api/auth` (port 5001, proxied through API Gateway on port 5000):

| Method | Endpoint | Description | Auth Required | Request Body |
|--------|----------|-------------|---------------|--------------|
| `GET`  | `/health` | Service health check | No | None |
| `GET`  | `/api-docs/` | Interactive Swagger API UI | No | None |
| `POST` | `/api/auth/register` | Register a new user | No | `{ name, email, password }` |
| `POST` | `/api/auth/login` | Authenticate user & issue tokens | No | `{ email, password }` |
| `POST` | `/api/auth/refresh` | Issue new access token | No | `{ refreshToken }` |
| `GET`  | `/api/auth/me` | Fetch authenticated user profile | Yes (`Bearer <token>`) | None |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | `5001` | Yes |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/researchmind-auth` | Yes |
| `REDIS_URL` | Redis connection URL | `redis://127.0.0.1:6379` | Yes |
| `JWT_ACCESS_SECRET` | Secret key for signing access tokens | `researchmind_access_secret` | Yes |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | `researchmind_refresh_secret` | Yes |

---

## 6. Dependencies
- **`bcryptjs`**: Password hashing.
- **`jsonwebtoken`**: JWT access and refresh token signing and verification.
- **`mongoose`**: MongoDB ODM for User persistence (`researchmind-auth`).
- **`redis`**: Redis client for token caching.

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
