# Docker Deployment & Container Process — ResearchMind

## Overview

ResearchMind uses Docker Compose to run local infrastructure only (MongoDB, Redis and Mongo Express). The Node services and the frontend are **not** containerized: there are no Dockerfiles, and they run with `npm run dev` (see `docs/onboarding.md`). Containerizing the services is roadmap / not yet implemented.

---

## Infrastructure Services (`docker-compose.yml`)

See `docker-compose.yml` for the exact definition. Summary:

| Service | Image | Container | Port | Notes |
|---------|-------|-----------|------|-------|
| `mongodb` | `mongo:7` | `researchmind-mongodb` | `27017` | Root user from `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD`; data in volume `mongodb_data` |
| `redis` | `redis:7` | `researchmind-redis` | `6379` | Data in volume `redis_data` |
| `mongo-express` | `mongo-express` | `researchmind-mongo-express` | `8081` | Admin login from `MONGO_ROOT_*`; basic auth from `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD` |

All three use `restart: unless-stopped`. The credential variables have local-development defaults in `docker-compose.yml`; override them in a root `.env` (gitignored) for anything that is not a throwaway database. The ports are published on all interfaces, so do not run this file unmodified on a host reachable from an untrusted network.

Because MongoDB authentication is enabled, service connection strings must include credentials, e.g. `mongodb://<user>:<password>@127.0.0.1:27017/<database>?authSource=admin`.

---

## Databases Hosted in MongoDB Container

Each service uses the database named in its own connection string (`MONGO_URI`, or `MONGODB_URI` for document/task/ai services). The names below are the ones used in the docs' examples:

1. **`researchmind-auth`**: Users (`users`) and hashed refresh tokens (`refreshtokens`).
2. **`researchmind-workspace`**: Workspaces (`workspaces`); members are stored as an array of user ids on each workspace.
3. **`researchmind-documents`**: Document metadata, extracted text, embedding status and Cloudinary URLs (`documents`).
4. **Task database** (e.g. `researchmind-tasks`): Boards (`boards`), tasks (`tasks`) and task activity (`taskactivities`).
5. **`researchmind_ai`**: AI Q&A sessions (`aisessions`).

---

## Redis Container Usage

- **Rate Limiting**: API Gateway rate limiters (`express-rate-limit` with a Redis store, keys prefixed `rl:`). If Redis is unreachable the limiters fail open.
- **Embedding Queue**: Document Service pushes embedding job JSON strings into list `researchmind:embedding:jobs`; the AI Service worker consumes them.
- Auth Service connects to Redis at startup but does not use it.

---

## Quick Commands

```bash
# Start infrastructure containers
docker-compose up -d

# View container status
docker-compose ps

# View container logs
docker-compose logs -f

# Stop containers
docker-compose down
```
