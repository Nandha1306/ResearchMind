# ResearchMind Documentation Index

A reading order from project scope down to operations. Every document below
describes the code as it is in this repository. Where something is planned but
not built, or built but not verified against live external providers, the
document says so.

> **Note:** the `docs/` folder is listed in `.gitignore`. Files under `docs/`
> are only versioned when they are added explicitly (`git add -f`). If a link
> below points to a file you do not have, it was not committed.

---

## 1. Scope and status

- **[Project README](../ResearchMind_readme.md)** — product scope, the
  *Current Implementation Status* section (what exists, what is roadmap), and
  the phase roadmap.

## 2. Setting up and running

- **[Developer onboarding](onboarding.md)** — prerequisites, installation,
  per-service `.env` files, local MongoDB/Redis, starting services, the worker
  and the frontend.
- **[Environment variable reference](reference/environment-variables.md)** —
  every variable the code reads, per service, with defaults and failure
  behaviour.
- **[Testing and CI](testing.md)** — unit and integration tests, typecheck,
  lint, build, and what CI runs.
- **[Deployment and operations](deployment/docker-process.md)** — what exists
  for running the system (Docker Compose infrastructure only) and what does not.

## 3. How it works

- **[System architecture](architecture/system-architecture.md)** — services,
  data stores, request flows and diagrams.
- **[Security model](architecture/security.md)** — authentication, refresh-token
  rotation, workspace authorization, upload validation, and known limitations.
- **[Documents and AI (RAG) pipeline](architecture/documents-and-ai.md)** —
  upload, extraction, embedding, retrieval, streaming answers, meeting
  summaries.
- **[Background jobs](operations/background-jobs.md)** — the embedding worker,
  job states, retries, recovery and troubleshooting.
- **[API reference](reference/api.md)** — public routes through the API gateway,
  the SSE protocol, and internal service-to-service routes.

## 4. Per-service notes

Ports are the defaults used when `PORT` is not set.

| Service | Default port | README |
|---|---|---|
| API gateway | 5000 | [services/api-gateway](../services/api-gateway/README.md) |
| Auth service | 5001 | [services/auth-service](../services/auth-service/README.md) |
| Workspace service | 5002 | [services/workspace-service](../services/workspace-service/README.md) |
| Document service | 5003 | [services/document-service](../services/document-service/README.md) |
| Task service | 5004 | [services/task-service](../services/task-service/README.md) |
| AI service (HTTP + in-process embedding worker) | 5006 | [services/ai-service](../services/ai-service/README.md) |
| Notification service | — (stub, not runnable) | [services/notification-service](../services/notification-service/README.md) |
| Frontend (Vite dev server) | 5173 | [frontend](../frontend/README.md) |
| Shared packages | — | [packages/shared](../packages/shared/README.md) |

## 5. Decision records (historical)

ADRs record why a decision was made at the time. Each has a status note where
the implementation has since changed.

- [ADR 0001: API gateway JWT authentication](adr/0001-api-gateway-jwt-authentication.md)
- [ADR 0002: Monorepo shared packages](adr/0002-monorepo-shared-packages.md)
- [ADR 0003: Service database isolation](adr/0003-service-database-isolation.md)
- [ADR 0004: RAG pipeline (Voyage, Pinecone, Groq/xAI, SSE)](adr/0004-rag-pipeline-grok-sse-pinecone.md)

## 6. Audit

- [Project audit and completion roadmap](PROJECT_AUDIT_AND_COMPLETION_ROADMAP.md)
  — a dated snapshot of findings and the fix roadmap. Many findings have since
  been fixed; check the code and the documents above for current behaviour.
