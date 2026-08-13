# Shared Package (`packages/shared`)

Shared utilities, custom error classes, and common Express error handling middleware for the **ResearchMind** monorepo.

---

## 1. Purpose
The `packages/shared` package centralizes shared backend logic, error abstractions, and async utility wrappers used across multiple microservices to ensure consistent error formats and reduce code duplication.

---

## 2. Responsibilities
- Standardizing operational application errors (`AppError`).
- Providing an async route handler wrapper (`asyncHandler`) to catch unhandled promise rejections.
- Providing global Express error middleware (`errorMiddleware`) that formats error JSON responses uniform across all services.

---

## 3. Folder Structure
```
packages/shared/
├── errors/
│   ├── AppError.ts           # Custom operational error class extending Error
│   ├── asyncHandler.ts       # Express async route wrapper
│   └── error.middleware.ts   # Express global error handler
└── README.md
```

---

## 4. API Endpoints
*Not applicable.* This package is an internal npm workspace dependency imported directly by microservices.

---

## 5. Environment Variables
No specific environment variables required.

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
