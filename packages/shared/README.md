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
*Not applicable.* This folder has no `package.json` and is not an npm package: services import its files by relative path (for example `../../../packages/shared/errors/AppError`), and each service's `tsc` build compiles the imported files into that service's `dist/`.

---

## 5. Environment Variables
Read by the shared code in whichever service imports it:

| Variable | Used by | Notes |
|----------|---------|-------|
| `JWT_ACCESS_SECRET` | `auth/authenticate.ts` | Required; same value in every service |
| `INTERNAL_SERVICE_TOKEN` | `auth/internal-auth.middleware.ts` | Without it every internal request is rejected (`401`) |
| `WORKSPACE_SERVICE_URL` | `auth/workspace-membership.ts` | Default `http://127.0.0.1:5002` |
| `MONGO_URI` / `MONGODB_URI` | `lifecycle/mongo.ts` (`resolveMongoUri`) | The calling service chooses which names to read; see its README |

Required secrets are checked by `config/secrets.ts` (minimum 32 characters). The full per-service list is in [docs/reference/environment-variables.md](../../docs/reference/environment-variables.md).

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

There is nothing to build or start: the code is compiled as part of each service that imports it. From the repository root:

```bash
npm install   # installs the dependencies this code uses (express, mongoose, jsonwebtoken, ...) at the root
npm test      # the shared code is covered by tests/lifecycle.test.ts, error-middleware.test.ts, internal-auth.test.ts, workspace-membership.test.ts and others  [TESTED]
```

A change here affects every service that imports the changed file; typecheck all six services afterwards (see [Testing](../../docs/testing.md)).

Related folders: `packages/validation` holds the zod request schemas (also imported by relative path). `packages/shared-config` (a stub `package.json` and `tsconfig.base.json`), `packages/shared-types` and `packages/shared-utils` (empty) are unused scaffolding.

---

## 8. Related Documentation

- [Security model](../../docs/architecture/security.md) (JWT, internal token, membership checks, secrets)
- [Deployment and operations](../../docs/deployment/docker-process.md) (health checks, graceful shutdown)
- [Environment variables](../../docs/reference/environment-variables.md)
- [Testing](../../docs/testing.md)
