# ADR 0002: Monorepo Shared Code via NPM Workspaces

* **Status**: Accepted
* **Date**: 2026-08-01
* **Deciders**: ResearchMind Core Team

---

## 1. Context & Problem Statement
Across multiple microservices (`auth-service`, `workspace-service`, `document-service`), we require shared domain entities:
- Custom operational error classes (`AppError`) and global Express error handling middleware (`errorMiddleware`).
- Request body validation schemas (Zod schemas for authentication, workspace creation, and document payloads).
- Common TypeScript configurations (`tsconfig.json`).

We needed a strategy to share this code without creating maintenance drag, version drift, or complex build pipelines.

---

## 2. Options Considered

### Option A: Duplicate Code across Microservices
Copy-paste error handling files and Zod validation schemas into each microservice directory.

* **Pros**: Complete decoupling; each service can modify its error handling independently.
* **Cons**: Extreme maintenance burden; schema drift between services; bug fixes in error handling must be manually repeated in 7+ locations.

### Option B: Private NPM Packages Registry (e.g., GitHub Packages / Verdaccio)
Publish shared utilities as versioned packages (`@researchmind/shared`, `@researchmind/validation`) to an external or private package registry.

* **Pros**: Explicit versioning per microservice; independent release lifecycles.
* **Cons**: Heavy CI/CD publication overhead for fast local development; slow iteration cycles when modifying shared schemas during active feature development.

### Option C: Monorepo Internal NPM Workspaces (Chosen)
Utilize native `npm` workspaces configured at the repository root (`"workspaces": ["frontend", "services/*", "packages/*"]`) with local packages (`packages/shared`, `packages/validation`).

* **Pros**: Zero publication overhead; instant live hot-reloading across services during local development; guaranteed single source of truth for validation schemas and error formats.
* **Cons**: Requires keeping shared packages backwards-compatible when modified, as changes affect all consuming services immediately within the monorepo.

---

## 3. Decision Rationale
We chose **Option C (Monorepo Internal NPM Workspaces)** because:
1. **Developer Velocity**: In the current growth phase of ResearchMind, validation schemas and error handling abstractions evolve rapidly. Monorepo workspaces allow developers to edit a shared schema in `packages/validation` and test it instantly across services without running `npm publish` or `npm update`.
2. **Type Safety Across Boundaries**: Clean TypeScript path resolution allows services and the frontend to share identical type definitions and validation contracts.
3. **Low Infrastructure Overhead**: No need to host or authenticate against a private NPM registry.

---

## 4. Consequences

### Positive
- Single source of truth for validation schemas, HTTP error responses, and configuration presets.
- Fast, friction-free local development with instant TypeScript feedback.
- Clean dependency graphs managed via root `package.json`.

### Negative / Tradeoffs
- Breaking changes in `packages/shared` or `packages/validation` affect all consuming services simultaneously and require atomic commits.
