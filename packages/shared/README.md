# Shared Package (`packages/shared`)

Shared backend code for the **ResearchMind** monorepo: error handling, JWT and internal-token authentication, workspace membership checks, secret validation, health checks, and connection/shutdown lifecycle helpers.

---

## 1. Purpose
The `packages/shared` package centralizes shared backend logic, error abstractions, and async utility wrappers used across multiple microservices to ensure consistent error formats and reduce code duplication.

---

## 2. Responsibilities
- Standardizing operational application errors (`AppError`).
- Providing an async route handler wrapper (`asyncHandler`) to catch unhandled promise rejections.
- Providing global Express error middleware (`errorMiddleware`) that formats error JSON responses (`{ success: false, message }`) uniformly across all services.
- JWT access-token verification middleware (`auth/authenticate.ts`), used by document-, task- and ai-service.
- Internal service-to-service authentication via the `X-Internal-Token` header (`auth/internal-auth.middleware.ts`).
- Workspace membership checks against workspace-service (`auth/workspace-membership.ts`): malformed workspace id → `400`, not authenticated → `401`, check could not complete (timeout 3 s, network error, 5xx) → `503`; otherwise `true`/`false` (callers answer `403` for non-members). `getWorkspaceMemberIds` returns the member user ids (used to validate task assignees).
- Startup secret validation (`config/secrets.ts`): a required secret that is missing, a placeholder, shorter than 32 characters or a known-insecure value stops the service; only the variable name is reported.
- Health check handler (`health/healthCheck.ts`), MongoDB connection (`lifecycle/mongo.ts`), Redis reconnect/close helpers (`lifecycle/redis.ts`) and graceful shutdown (`lifecycle/shutdown.ts`).

---

## 3. Folder Structure
```
packages/shared/
├── auth/
│   ├── authenticate.ts               # JWT access-token middleware
│   ├── internal-auth.middleware.ts   # X-Internal-Token middleware
│   └── workspace-membership.ts       # Membership checks against workspace-service
├── config/
│   └── secrets.ts            # requireSecret / assertRequiredSecrets
├── errors/
│   ├── AppError.ts           # Custom operational error class extending Error
│   ├── asyncHandler.ts       # Express async route wrapper
│   └── error.middleware.ts   # Express global error handler
├── health/
│   └── healthCheck.ts        # createHealthHandler
├── lifecycle/
│   ├── mongo.ts              # connectMongo / disconnectMongo
│   ├── redis.ts              # Redis reconnect and close helpers
│   └── shutdown.ts           # registerGracefulShutdown
└── README.md
```

---

## 4. API Endpoints
*Not applicable.* This package is an internal npm workspace dependency imported directly by microservices.

---

## 5. Environment Variables
Read by the shared code in whichever service imports it:

| Variable | Used by | Notes |
|----------|---------|-------|
| `JWT_ACCESS_SECRET` | `auth/authenticate.ts` | Required; same value in every service |
| `INTERNAL_SERVICE_TOKEN` | `auth/internal-auth.middleware.ts` | Without it every internal request is rejected (`401`) |
| `WORKSPACE_SERVICE_URL` | `auth/workspace-membership.ts` | Default `http://127.0.0.1:5002` |

---

## 6. Key Exports & Usage

### `AppError` (`errors/AppError.ts`)
```typescript
import { AppError } from "../../../packages/shared/errors/AppError";

// Throw operational HTTP error with status code
throw new AppError("Workspace not found", 404);
```

### `errorMiddleware` (`errors/error.middleware.ts`)
```typescript
import app from "express";
import { errorMiddleware } from "../../../packages/shared/errors/error.middleware";

// Mount as final Express middleware
app.use(errorMiddleware);
```

---

## 7. Local Development Commands
```bash
# Referenced directly via npm workspace root dependencies
npm install
```
