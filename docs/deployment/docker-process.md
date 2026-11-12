# Docker Deployment & Container Process — ResearchMind

> **Status: deployment is incomplete and not production-ready.** The repository contains a Docker Compose file for local infrastructure only. There are **no Dockerfiles, no container images for the services, no deployment manifests** (Kubernetes, Railway, Vercel, Render or similar), no reverse proxy/TLS configuration and no deploy step in CI. Everything below describes what exists today and what an operator would have to provide; containerizing and deploying the services is roadmap / not yet implemented.

Command status: **TESTED** = run successfully during the Wave 1–4 audits; **UNTESTED** = matches the repository files but was not run.

---

## Overview

ResearchMind uses Docker Compose to run local infrastructure only (MongoDB, Redis and Mongo Express). The Node services and the frontend are **not** containerized: there are no Dockerfiles, and they run with npm scripts (see [onboarding.md](../onboarding.md)). Containerizing the services is roadmap / not yet implemented.

---

## Infrastructure Services (`docker-compose.yml`)

See `docker-compose.yml` for the exact definition. Summary:

| Service | Image | Container | Port | Notes |
|---------|-------|-----------|------|-------|
| `mongodb` | `mongo:7` | `researchmind-mongodb` | `27017` | Root user from `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD`; data in volume `mongodb_data` |
| `redis` | `redis:7` | `researchmind-redis` | `6379` | Data in volume `redis_data`; no password |
| `mongo-express` | `mongo-express` | `researchmind-mongo-express` | `8081` | Admin login from `MONGO_ROOT_*`; basic auth from `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD` |

All three use `restart: unless-stopped`. The credential variables have weak local-development defaults in `docker-compose.yml`; override them in a root `.env` (gitignored) for anything that is not a throwaway database (MongoDB applies them only when its volume is first created). The ports are published on all interfaces, so do not run this file unmodified on a host reachable from an untrusted network. The compose file declares no health checks, no resource limits and no network isolation, and the image tags `mongo:7` / `redis:7` / `mongo-express` are not pinned to a digest. The `docker/mongo` and `docker/redis` folders are empty and unused.

Because MongoDB authentication is enabled, service connection strings must include credentials, e.g. `mongodb://<user>:<password>@127.0.0.1:27017/<database>?authSource=admin`.

---

## Databases Hosted in MongoDB Container

Each service uses the database named in its own connection string (`MONGO_URI`, or `MONGODB_URI` for document/task/ai services). The names below are the ones used in each service's `.env.example`:

1. **`researchmind-auth`**: Users (`users`) and hashed refresh tokens (`refreshtokens`).
2. **`researchmind-workspace`**: Workspaces (`workspaces`); members are stored as an array of user ids on each workspace.
3. **`researchmind-document`**: Document metadata, extracted text, embedding status and Cloudinary URLs (`documents`).
4. **`researchmind-task`**: Boards (`boards`), tasks (`tasks`) and task activity (`taskactivities`).
5. **`researchmind-ai`**: AI Q&A sessions (`aisessions`).

---

## Redis Container Usage

- **Rate Limiting**: API Gateway rate limiters (`express-rate-limit` with a Redis store, keys prefixed `rl:`). If Redis is unreachable the limiters fail open.
- **Embedding Queue**: Document Service pushes embedding job JSON strings into list `researchmind:embedding:jobs`; the AI Service worker consumes them.
- Auth Service connects to Redis at startup but does not use it.

---

## Environment Requirements

Every service reads `.env` from its working directory (the service folder when started through npm). Variable names, defaults and required/optional status: **[reference/environment-variables.md](../reference/environment-variables.md)**. Deployment-relevant rules:

- `JWT_ACCESS_SECRET` identical in all six services; `JWT_REFRESH_SECRET` (auth-service) different from it; `INTERNAL_SERVICE_TOKEN` identical in auth-, workspace-, document- and ai-service. Each at least 32 characters; services refuse to start on a missing, placeholder or weak required secret.
- Service URLs default to `localhost` ports; set every `*_SERVICE_URL` explicitly when services run on different hosts.
- `VITE_API_URL` is baked into the frontend bundle at build time and must include the `/api` suffix.
- There is no secret manager integration; secrets come from `.env` files or the process environment.

---

## Runtime Dependencies

| Process | Required at startup | Needed at request time | External providers |
|---------|--------------------|------------------------|--------------------|
| api-gateway (5000) | `JWT_ACCESS_SECRET` | Redis (rate limits; fails open), all downstream services | — |
| auth-service (5001) | MongoDB | — (Redis connects in the background, unused) | — |
| workspace-service (5002) | MongoDB | auth-service (member names only) | — |
| document-service (5003) | MongoDB | Redis (queue), workspace-service (membership), ai-service (vector removal on delete) | Cloudinary |
| task-service (5004) | MongoDB | workspace-service (membership) | — |
| ai-service (5006) | MongoDB; provider keys present; Pinecone index matches the embedding dimension (skipped with a warning if Pinecone is unreachable) | Redis (in-process worker), workspace-service, document-service (worker claim/status) | Voyage AI, Pinecone, Groq or xAI |
| ai-service worker (no port) | `INTERNAL_SERVICE_TOKEN`; provider keys; Pinecone index check | Redis, document-service | Voyage AI, Pinecone |
| frontend (5173 dev) | — | api-gateway | — |

---

## Health Endpoints

| Service | Endpoint | Checks | Response |
|---------|----------|--------|----------|
| api-gateway | `GET http://<host>:5000/health` | Nothing (process is up) | Always `200` `{ success, service }` |
| auth-service | `GET http://<host>:5001/health` | MongoDB | `200` healthy / `503` unhealthy |
| workspace-service | `GET http://<host>:5002/health` | MongoDB | `200` / `503` |
| document-service | `GET http://<host>:5003/health` | MongoDB + Redis | `200` / `503` |
| task-service | `GET http://<host>:5004/health` | MongoDB | `200` / `503` |
| ai-service | `GET http://<host>:5006/health` | MongoDB + Redis | `200` / `503` |
| ai-service worker | none | — | Monitor its logs |

The shared handler (`packages/shared/health/healthCheck.ts`) answers `{ success, service, status: "healthy" | "unhealthy", uptime, dependencies: { mongo, redis? } }`. It is one combined liveness/readiness check: there are no separate `/ready` or `/live` endpoints, and no endpoint checks Cloudinary, Voyage, Pinecone, the LLM provider or peer services. Service health endpoints are not proxied by the gateway; call each service's port directly.

---

## Startup Ordering

1. **MongoDB and Redis.** MongoDB-backed services make one bounded connection attempt (about 30 s) and exit with code 1 if it fails. Redis may come later: clients reconnect indefinitely, and ai-service starts without it (its worker waits).
2. **workspace-service** (and auth-service). Every workspace-scoped request in document-, task- and ai-service asks workspace-service about membership; while it is unreachable those requests answer `503`.
3. **document-service before or together with ai-service.** The embedding worker claims every job through document-service's internal endpoint `POST /internal/documents/:id/embedding/claim` before doing any work. If document-service is unreachable when a job is popped, the claim fails, the error is logged and the job is not processed; the document stays `pending` until document-service's recovery sweep (at its startup and every 5 minutes) re-queues it. When upgrading, deploy document-service first: an ai-service talking to a document-service without the claim endpoint treats the missing endpoint as an error rather than skipping jobs. See [operations/background-jobs.md](../operations/background-jobs.md).
4. **task-service, api-gateway, frontend** in any order. The gateway answers `503` for a downstream service it cannot reach.

There is no orchestration that enforces this order; `npm run dev` / `npm run dev:services` start everything at once and rely on the retries above.

---

## Shutdown Behaviour

All six services and the standalone worker use `packages/shared/lifecycle/shutdown.ts`:

1. On `SIGINT` or `SIGTERM` the HTTP server stops accepting connections; in-flight requests, including streaming SSE answers, get up to 5 s before remaining connections are closed.
2. Cleanup steps then run in order (ai-service: stop the embedding worker and let the current job finish → MongoDB → Redis clients; document-service: stop the recovery-sweep timer → MongoDB → Redis). Every step runs even if an earlier one fails.
3. Exit code `0` on success; `1` if a step failed, the overall timeout passed (10 s; **30 s** for ai-service and the worker) or a second signal arrived.

A supervisor must allow at least 30 s between `SIGTERM` and a forced kill for ai-service and the worker (for example `docker stop -t 35`); the Docker default of 10 s would cut off an embedding job in progress. The queue entry of an interrupted job is lost, but the document is recovered: its claim expires and the recovery sweep re-queues it while attempts remain. The interruption uses up one of the 3 attempts; if it was the last, the document ends `failed` (re-index to retry).

---

## Worker Deployment

- `ai-service` always runs one embedding worker inside the HTTP process; there is no setting to disable it.
- An optional standalone worker (`src/worker.ts`) can be added for more throughput: `npm run build -w ai-service` then `npm run start:worker -w ai-service` **[UNTESTED]** (dev: `npm run dev:worker -w ai-service` **[UNTESTED]**). It has no HTTP port and no health endpoint, does not use MongoDB, and needs `INTERNAL_SERVICE_TOKEN`, Redis, document-service and the Voyage/Pinecone settings from `services/ai-service/.env`.
- Any number of workers can consume the same Redis list: each job is popped by one worker, and the claim in document-service prevents two workers from processing the same document.
- Queue, retries (3 attempts per document) and the recovery sweep are described in [operations/background-jobs.md](../operations/background-jobs.md).

---

## Logging

- All services log to stdout/stderr with `console`; there are no request ids, no log shipping and no log level setting (except document-service's `winston` logger, which logs `debug` when `NODE_ENV=development`, otherwise `info`).
- HTTP access logs use `morgan("dev")` in api-gateway, auth-, document-, task- and ai-service (not workspace-service).
- document-service additionally uses `winston` (JSON lines) and writes `error.log` and `combined.log` into its working directory, without rotation. In a container, mount or discard that directory accordingly.
- Secrets are never logged by the startup checks (only variable names); embedding jobs are not logged in full because they carry document text.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| A service exits immediately naming a variable | Required secret missing, placeholder, shorter than 32 characters or known-insecure; or `MONGO_URI` / `MONGODB_URI` not set |
| A service exits after ~30 s | MongoDB unreachable or wrong credentials (compose MongoDB needs `?authSource=admin`) |
| ai-service exits with "vector index check failed" | Pinecone index missing, or its dimension differs from `VOYAGE_EMBEDDING_DIMENSION` |
| ai-service exits naming a provider key | `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX` or `XAI_API_KEY`/`GROQ_API_KEY` empty |
| Documents stay `pending` | No worker running, Redis down (`/health` on 5003/5006 shows it), document-service unreachable from ai-service, or `INTERNAL_SERVICE_TOKEN` differs between document- and ai-service (claims rejected with `401`) |
| Deleting a document answers `503` | ai-service unreachable or the Pinecone delete failed; nothing was deleted |
| Workspace-scoped requests answer `503` | workspace-service unreachable from the calling service |
| Gateway answers `503` "Service temporarily unavailable" | Downstream service not running or wrong `*_SERVICE_URL` |
| Workspace members show a placeholder name | `INTERNAL_SERVICE_TOKEN` / `AUTH_SERVICE_URL` not set or not matching in workspace-service and auth-service |
| New compose credentials are ignored | MongoDB volume already initialised with the old ones |
| `EADDRINUSE` | Another process already uses the port; set `PORT` or stop it |

---

## Quick Commands

```bash
# Start infrastructure containers                                [UNTESTED]
docker-compose up -d

# View container status                                          [UNTESTED]
docker-compose ps

# View container logs                                            [UNTESTED]
docker-compose logs -f

# Stop containers (volumes are kept; add -v to delete all data)  [UNTESTED]
docker-compose down

# Build and run one service from compiled output                 [TESTED]
npm run build -w document-service
npm start -w document-service
```

With Compose v2, `docker compose` (space) works the same way.

---

## Missing for a Production Deployment

- Dockerfiles / images for the six services and the frontend, and a compose or orchestration file that runs them.
- Deployment manifests and a CD step; CI only typechecks, builds the frontend and runs tests.
- TLS termination, a reverse proxy, restricted CORS on the gateway (it currently allows any origin) and private networking for MongoDB/Redis.
- Separate readiness checks for providers and peers, metrics, structured logging and alerting.
- Managed MongoDB/Redis with authentication on Redis, backups and secret management.
