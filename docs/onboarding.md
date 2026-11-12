# Developer Onboarding Guide — ResearchMind

Welcome to **ResearchMind**! This guide will help you set up and run the platform locally.

Command status: **TESTED** means the command was run successfully during the Wave 1–4 audits; **UNTESTED** means it matches `package.json` / `docker-compose.yml` but was not run in the audit. Commands are shown for a POSIX shell (Git Bash, macOS, Linux); PowerShell equivalents are given where they differ.

---

## 1. Prerequisites

Ensure you have the following installed on your developer machine:
- **Node.js**: `v22.x` (CI uses Node 22; several dependencies declare `node >= 22`). The repository has no `.nvmrc` and no `engines` field, so nothing enforces this locally.
- **npm**: `v10.x` or later (ships with Node 22). The repository is an npm-workspaces monorepo; use npm, not yarn or pnpm.
- **Docker Desktop** (optional): the provided way to run MongoDB 7 and Redis 7 locally (`docker-compose.yml`). Any reachable MongoDB and Redis work instead.
- **Git**: For version control
- Accounts for external services (you create the keys yourself; none are provided in the repository):
  - **Cloudinary** (file storage; document-service),
  - **Voyage AI** (embeddings; ai-service),
  - **Pinecone** (vector index with dimension `1024`, cosine metric; create it yourself, there is no setup script; document deletion uses delete-by-metadata, which was not verified against a live index — see [documents and AI](architecture/documents-and-ai.md)),
  - **Groq or xAI** (LLM; ai-service).

  The automated tests need none of these (see [testing.md](testing.md)).

Install all workspace dependencies once, from the repository root:

```bash
npm install          # [UNTESTED in the audit; CI runs `npm ci`]
```

One install covers `frontend/`, `services/*` and `packages/*`. Run all later commands from the repository root unless stated otherwise.

---

## 2. Infrastructure Setup (Docker)

`docker-compose.yml` defines infrastructure only (the Node services and the frontend are not containerized):

| Compose service | Image | Published port | Purpose |
|-----------------|-------|----------------|---------|
| `mongodb` | `mongo:7` | `27017` | All service databases (authentication enabled) |
| `redis` | `redis:7` | `6379` | Gateway rate limits and the embedding queue (no password) |
| `mongo-express` | `mongo-express` | `8081` | Web admin UI for MongoDB |

Start MongoDB and Redis containers using Docker Compose:

```bash
docker-compose up -d     # [UNTESTED]  (Compose v2: `docker compose up -d`)
docker-compose ps        # [UNTESTED]  check the three containers are running
```

Verify that the containers are running:
- **MongoDB**: `localhost:27017`. Authentication is enabled (root user from `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD`, see `docker-compose.yml`), so connection strings need `<user>:<password>@...?authSource=admin`.
- **Redis**: `localhost:6379`
- **Mongo Express UI**: `http://localhost:8081` (basic auth from `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD`)

> **Security warnings**
> - All three ports are published on **all network interfaces** (`0.0.0.0`), not only `localhost`. Do not run this file unmodified on a machine reachable from an untrusted network (shared Wi-Fi, a cloud VM).
> - If you do not override them, the MongoDB root and Mongo Express credentials fall back to **weak, publicly known defaults** written in `docker-compose.yml`. Set `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `MONGO_EXPRESS_USERNAME` and `MONGO_EXPRESS_PASSWORD` in a root `.env` (gitignored) before the first `up`.
> - MongoDB applies the root credentials only when its data volume is first created. Changing them later has no effect unless the volume is recreated (`docker-compose down -v`, which **deletes all data**).
> - Redis has no password; Mongo Express gives full database access to anyone who passes its basic auth.

The empty `docker/mongo` and `docker/redis` folders are not used by the compose file.

---

## 3. Microservice Setup & Ports

| Service | Directory | Dev command (from root) | Port | Database / Storage |
|---------|-----------|-------------------------|------|--------------------|
| **API Gateway** | `services/api-gateway` | `npm run dev:gateway` | `5000` | Redis Rate Limiter |
| **Auth Service** | `services/auth-service` | `npm run dev:auth` | `5001` | `researchmind-auth` |
| **Workspace Service** | `services/workspace-service` | `npm run dev:workspace` | `5002` | `researchmind-workspace` |
| **Document Service** | `services/document-service` | `npm run dev:doc` | `5003` | `researchmind-document` (example DB name), Cloudinary, Redis queue producer |
| **Task Service** | `services/task-service` | `npm run dev:task` | `5004` | `researchmind-task` (example DB name) |
| **AI Service (HTTP + worker)** | `services/ai-service` | `npm run dev:ai` | `5006` | `researchmind-ai` (example DB name) / Pinecone / Redis queue consumer |
| **AI Service (standalone worker, optional)**| `services/ai-service` | `npm run dev:worker -w ai-service` | — | Extra Redis queue consumer |
| **Frontend SPA** | `frontend` | `npm run dev:frontend` | `5173` | Browser / LocalStorage |

- Each `dev:<name>` root script runs that workspace's `npm run dev` (`nodemon` + `ts-node` for services, Vite for the frontend); `npm run dev -w <workspace>` is equivalent.
- The AI HTTP service already runs the embedding worker in-process; the standalone worker is optional.
- The notification service is not implemented and is not started.
- Database names are examples: each service uses whatever database its connection string names.

---

## 4. Environment Configuration

Each service reads a `.env` file from its own directory (`dotenv`, loaded from the working directory, which npm sets to the workspace folder). Copy each `.env.example` and fill it in; never commit a `.env`.

```bash
# POSIX shell                                                                 [UNTESTED]
for dir in services/api-gateway services/auth-service services/workspace-service \
           services/document-service services/task-service services/ai-service frontend; do
  cp "$dir/.env.example" "$dir/.env"
done
```

```powershell
# PowerShell                                                                  [UNTESTED]
foreach ($d in "services/api-gateway","services/auth-service","services/workspace-service","services/document-service","services/task-service","services/ai-service","frontend") { Copy-Item "$d/.env.example" "$d/.env" }
```

The full list of variables, defaults and which service reads each one is in **[reference/environment-variables.md](reference/environment-variables.md)**. The minimum you must fill in:

| `.env` | Must set |
|--------|----------|
| `services/api-gateway` | `JWT_ACCESS_SECRET` |
| `services/auth-service` | `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN` (for member names) |
| `services/workspace-service` | `MONGO_URI`, `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` (for member names) |
| `services/document-service` | `MONGODB_URI` or `MONGO_URI`, `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| `services/task-service` | `MONGODB_URI` or `MONGO_URI`, `JWT_ACCESS_SECRET` |
| `services/ai-service` | `MONGODB_URI` or `MONGO_URI`, `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN`, `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `XAI_API_KEY` (or `GROQ_API_KEY`) |
| `frontend` | nothing (`VITE_API_URL` defaults to `http://localhost:5000/api`; if set, it must include `/api`) |

The service URLs (`*_SERVICE_URL`) and `REDIS_URL` default to the local ports above.

Rules that apply to every service:
- `JWT_ACCESS_SECRET` must be identical in every service. `JWT_REFRESH_SECRET` (auth-service only) must differ from it. `INTERNAL_SERVICE_TOKEN` must be identical wherever it is set.
- Services refuse to start if a required secret is missing, a `<placeholder>`, shorter than 32 characters, or a known-insecure value. Generate each one with `openssl rand -hex 48`, or where OpenSSL is not available (e.g. plain PowerShell) with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `INTERNAL_SERVICE_TOKEN` is not checked at startup by auth-service and workspace-service, but every service refuses internal (service-to-service) calls while it is missing, a `<placeholder>` or weak. Without a valid shared token, workspace member lists show a placeholder name instead of real names.
- MongoDB: auth-service and workspace-service read only `MONGO_URI`; document-, task- and ai-service read `MONGODB_URI` first, then `MONGO_URI`. The compose MongoDB has authentication enabled (root user from `MONGO_ROOT_USERNAME`, default `admin`), so a local URI has the form `mongodb://<user>:<password>@localhost:27017/<database>?authSource=admin`.
- ai-service will not start without non-empty Voyage, Pinecone and Groq/xAI settings, and exits if the Pinecone index is missing or its dimension differs from `VOYAGE_EMBEDDING_DIMENSION` (default `1024`). If Pinecone cannot be reached at startup it only logs a warning.

---

## 5. Starting the Platform

Start the infrastructure first: services that use MongoDB exit with code 1 if they cannot connect within about 30 seconds.

```bash
# All six backend services and the frontend, via concurrently                [UNTESTED]
npm run dev

# Backend only (gateway, auth, workspace, document, task, ai)                  [UNTESTED]
npm run dev:services

# One service with live reload (see the table in section 3)                   [UNTESTED]
npm run dev:auth

# Frontend only (Vite, http://localhost:5173)                                  [UNTESTED]
npm run dev:frontend

# Optional extra embedding worker                                              [UNTESTED]
npm run dev:worker -w ai-service
```

Compiled mode (closer to how a deployment would run):

```bash
npm run build -w auth-service    # [TESTED for every service] tsc -> dist/
npm start -w auth-service        # [TESTED for every service, with dummy provider keys]
npm run start:worker -w ai-service   # [UNTESTED] standalone worker from dist/
npm run build -w frontend        # [TESTED] typecheck + production bundle in frontend/dist
npm run preview -w frontend      # [UNTESTED] serve the built bundle
```

Check that a service is up (`200` = healthy, `503` = a dependency is down; the gateway's `/health` does not check anything):

```bash
curl http://localhost:5003/health    # [UNTESTED]
```

Ports and health semantics per service are listed in [deployment/docker-process.md](deployment/docker-process.md). If you start services one by one, start workspace-service early (every workspace-scoped request asks it about membership) and document-service before or together with ai-service (the embedding worker claims each job from document-service).

---

## 6. Verification Workflow

Manual, end-to-end; needs real Cloudinary, Voyage, Pinecone and Groq/xAI keys. Not executed in the audit.

1. Open `http://localhost:5173/` in your browser.
2. Register a new user account (e.g., `user@test.com` / `Password123!`).
3. Create a workspace (e.g., `"AI Engineering Research"`).
4. Navigate to Documents (`/dashboard/documents`).
5. Click **"+ Upload document"** and select a PDF or DOCX file (max 10 MB).
6. Verify the document appears in the library grid and its status moves from `pending` to `indexed` (or `failed`, with a reason).
7. Click the PDF card to render the document in the **In-App PDF Viewer**.
8. Ask a question on the AI Q&A page (`/dashboard/ai-researcher`), which streams from `POST /api/ai/query`. `POST /api/ai/search` returns raw retrieval results.
9. Run the automated tests from the repository root with `npm test`. The integration tests need `TEST_MONGO_URI` and are skipped without it.

---

## 7. Development Workflow

- Branch from `develop` (the main branch for pull requests). CI runs on pushes and pull requests to `develop` and `main`.
- Before opening a pull request, run what CI runs (details in [testing.md](testing.md)):

  ```bash
  ./node_modules/.bin/tsc --noEmit -p services/<service>   # [TESTED] for each changed service
  npm run build -w frontend                                # [TESTED]
  TEST_MONGO_URI=mongodb://localhost:27018 npm test        # [TESTED form] run in this audit against throwaway mongo:7 containers on other ports
  ```

- `npm run lint -w frontend` **[TESTED]** currently reports 42 pre-existing problems; it is not a CI gate. Do not add new ones.
- API documentation: the gateway serves Swagger UI at `http://localhost:5000/api-docs`; the reference is [reference/api.md](reference/api.md).
- Shared backend code lives in `packages/shared` and zod schemas in `packages/validation`; services import them by relative path, so changes there affect every service that imports them.

---

## 8. Shutdown and Cleanup

- **Stop the Node processes** with `Ctrl+C`. Each service handles `SIGINT`/`SIGTERM`: it stops accepting connections, gives in-flight requests (including SSE answers) up to 5 s, closes its MongoDB/Redis connections and exits `0`. The limit is 10 s (30 s for ai-service and the worker, so an embedding job can finish); a second `Ctrl+C` forces exit code `1`.
- **Stop the containers** (data is kept in the `mongodb_data` and `redis_data` volumes):

  ```bash
  docker-compose stop       # [UNTESTED] stop, keep containers
  docker-compose down       # [UNTESTED] remove containers and network, keep volumes
  docker-compose down -v    # [UNTESTED] ALSO deletes the volumes: all local data is lost
  ```

- **Build output**: `npm run build` writes `services/<service>/dist` and `frontend/dist` (gitignored); delete them freely.
- **Logs**: document-service also writes `error.log` and `combined.log` into its working directory (`services/document-service/`; gitignored).
- **Test databases**: integration tests drop their own `rmtest_*` databases; an interrupted run can leave one behind.
- **Cloud resources**: documents uploaded during manual testing stay in your Cloudinary account and Pinecone index until you delete them in the app (which removes the vectors and, on a best-effort basis, the Cloudinary file; a failed Cloudinary deletion is only logged). Uploaded files are reachable by anyone who has their Cloudinary URL (public delivery); see [the security model](architecture/security.md).

---

## Further Reading

- [Environment variables](reference/environment-variables.md)
- [API reference](reference/api.md)
- [Testing](testing.md)
- [Deployment and operations](deployment/docker-process.md)
- [System architecture](architecture/system-architecture.md), [Security](architecture/security.md), [Documents and AI](architecture/documents-and-ai.md)
- [Background jobs](operations/background-jobs.md)
- Per-service notes: `services/*/README.md`, `frontend/README.md`, `packages/shared/README.md`
