# Developer Onboarding Guide — ResearchMind

Welcome to **ResearchMind**! This guide will help you set up and run the platform locally.

Command status: **TESTED** means the command was run successfully during the Wave 1–4 audits; **UNTESTED** means it matches `package.json` / `docker-compose.yml` but was not run in the audit. Commands are shown for a POSIX shell (Git Bash, macOS, Linux); PowerShell equivalents are given where they differ.

---

## 1. Prerequisites

Ensure you have the following installed on your developer machine:
- **Node.js**: `v22.x`. `.nvmrc` pins 22.14.0 (CI reads it) and the root `package.json` declares `engines` (node `>=22.12 <23`, npm `>=10.9 <11`); npm only warns on a mismatch (no `engine-strict`).
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
npm ci               # [TESTED 2026-11-13: plain `npm ci`, no flags, exit 0 on a clean copy]
```

One install covers `frontend/`, `services/*` and `packages/*`. Run all later commands from the repository root unless stated otherwise.

- **After pulling a lockfile change** (for example the Wave 4 dependency update), run `npm ci` again so `node_modules` matches `package-lock.json`.
- Do not add `--force`, and do not put `legacy-peer-deps` in `.npmrc`: `npm ci` works without it. Only maintainers regenerating the lockfile need `npm install --legacy-peer-deps` (an optional peer of `@langchain/community` conflicts with ai-service's `openai` major).
- On Windows, run `npm ls` from a path with an upper-case drive letter (`D:\...`): npm 10.9.2 crashes on `d:\...` (see [testing.md](testing.md#3-typecheck-build-and-lint)).

---

## 2. Infrastructure Setup (Docker)

`docker-compose.yml` defines infrastructure only (the Node services and the frontend are not containerized):

| Compose service | Image | Published port (127.0.0.1 only) | Purpose |
|-----------------|-------|---------------------------------|---------|
| `mongodb` | `mongo:7.0` (pinned minor since Wave 6; was `mongo:7`) | `27017` (`MONGO_HOST_PORT`) | All service databases. Authentication enabled; one user per service |
| `redis` | `redis:7.4` (pinned minor since Wave 6; was `redis:7`) | `6379` (`REDIS_HOST_PORT`) | Gateway rate limits and the embedding queue. Password required |
| `mongo-express` | `mongo-express:1.0.2` | `8081` (`MONGO_EXPRESS_HOST_PORT`) | Optional web admin UI, only in `docker-compose.tools.yml` |

**1. Create the root `.env`.** Compose has no default credentials and refuses to start until every required value is set.

> **Never copy over an existing `.env`:** it holds your credentials, and an existing MongoDB volume only accepts the passwords it was created with. The commands below copy only when there is no root `.env` yet. If you already have one, edit it instead (compare it with `.env.example`).

```bash
# POSIX shell: -n never overwrites an existing file
cp -n .env.example .env
docker compose config --quiet   # no output = complete; otherwise it names the missing variable
```

```powershell
# PowerShell (Copy-Item has no -n; it would overwrite)
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose config --quiet
```

Then fill in every empty value. Passwords: `openssl rand -hex 24` (48 hex characters). The MongoDB service passwords must be at least 16 characters of `A-Z a-z 0-9 . _ ~ -` only, so `openssl rand -base64` output (`+`, `/`, `=`) is rejected. Database names may use only `A-Z a-z 0-9 _ -` (no `.`).

The root `.env` holds the MongoDB root account (`MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD`), `REDIS_PASSWORD`, and one user, password and database per service (`MONGO_AUTH_*`, `MONGO_WORKSPACE_*`, `MONGO_DOCUMENT_*`, `MONGO_TASK_*`, `MONGO_AI_*`). `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD` are needed only for the optional UI. Older setups used `MONGO_ROOT_USER`. Compose never read that name, so replace it with `MONGO_ROOT_USERNAME` set to the root user that already exists in your MongoDB volume (normally `admin`; see [Securing an existing installation](deployment/docker-process.md#securing-an-existing-installation-host-remediation)).

**2. Start MongoDB and Redis:**

```bash
docker compose up -d     # [TESTED in a throwaway project only]  (Compose v1: docker-compose up -d)
docker compose ps        # mongodb (healthy) and redis running
```

On a **new** data volume, MongoDB creates the root user and the five service users (`docker/mongo/provision-service-users.js`). Each service user has `readWrite` on its own database only.

**Check that the service users were created** (first start only):

```bash
docker compose logs mongodb | grep provision-service-users                      # POSIX shell
docker compose logs mongodb | Select-String provision-service-users             # PowerShell
```

Expect five `provision-service-users: created <user> (readWrite on <database>)` lines and a `done (5 service users)` line. If you see a `provision-service-users: <VARIABLE> ...` error instead, the script rejected that value (for example a password shorter than 16 characters or containing `+`, `/` or `=`, or a database name with `.`) and **no service user exists**. MongoDB does not retry: the container exits once, `restart: unless-stopped` starts it again, init is skipped because the volume is no longer empty, and it reports healthy with the root user only. Every service then fails with `Authentication failed`. To recover without deleting the volume:

1. Fix the value named in the error in the root `.env`, then run `docker compose config --quiet`.
2. Run `docker compose up -d` so the container gets the corrected environment.
3. Run the script by hand and enter the root password (`MONGO_ROOT_PASSWORD`) at the prompt:
   `docker exec -it researchmind-mongodb mongosh -u <MONGO_ROOT_USERNAME> -p --authenticationDatabase admin /docker-entrypoint-initdb.d/10-provision-service-users.js`
   It prints the five `created …` lines. It is safe to re-run.

On a disposable fresh install you can instead run `docker compose down -v` (**deletes all MongoDB and Redis data**), fix `.env` and start again.

**3. Point the services at their own credentials** (section 4):
- **MongoDB**: `mongodb://<MONGO_X_USERNAME>:<MONGO_X_PASSWORD>@127.0.0.1:27017/<MONGO_X_DATABASE>?authSource=admin`, using the service's own user. Never use the root user in a service.
- **Redis**: `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379` (api-gateway, document-service, ai-service).
- Use `127.0.0.1`, not `localhost`: only the IPv4 loopback address is published.

The optional admin UI starts only on demand: `docker compose -f docker-compose.yml -f docker-compose.tools.yml up -d mongo-express`, then open `http://127.0.0.1:8081` (basic auth from `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD`). It has full access to every database; stop it when you are done.

> **Notes**
> - Nothing is published beyond `127.0.0.1`. To reach the databases from another machine, use an SSH tunnel rather than changing the bindings.
> - MongoDB applies the root credentials and creates the service users **only when its data volume is first created**. If you already have a volume from an earlier version of this file (published on all interfaces, default credentials, no Redis password), follow **[Securing an existing installation](deployment/docker-process.md#securing-an-existing-installation-host-remediation)**.
> - Anyone who can use Docker on your machine can read the passwords with `docker inspect`.

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
- **Listen address (Wave 4, SEC-004).** The gateway listens on all interfaces (`0.0.0.0`); auth, workspace, document, task and ai listen on `127.0.0.1` only, so only the gateway is reachable from other machines. To run a service in its own container or on another host, set `HOST=0.0.0.0` in its `.env` (and keep its port off the public network).
- **Port already in use.** A service whose port is taken logs `[<service>] cannot listen on <host>:<port>: EADDRINUSE` and exits 1. Stop the other process or change `PORT`.

---

## 4. Environment Configuration

Each service reads a `.env` file from its own directory (`dotenv`, loaded from the working directory, which npm sets to the workspace folder). Create each one from its `.env.example` and fill it in; never commit a `.env`.

> **Never copy over an existing `.env`:** it holds your secrets and keys. The commands below create only the `.env` files that do not exist yet and leave existing ones untouched; edit those by hand (compare them with their `.env.example`).

```bash
# POSIX shell: cp -n never overwrites an existing file                        [UNTESTED]
for dir in services/api-gateway services/auth-service services/workspace-service \
           services/document-service services/task-service services/ai-service frontend; do
  cp -n "$dir/.env.example" "$dir/.env"
done
```

```powershell
# PowerShell: Copy-Item has no no-clobber switch, so check first              [UNTESTED]
foreach ($d in "services/api-gateway","services/auth-service","services/workspace-service","services/document-service","services/task-service","services/ai-service","frontend") { if (-not (Test-Path "$d/.env")) { Copy-Item "$d/.env.example" "$d/.env" } }
```

The full list of variables, defaults and which service reads each one is in **[reference/environment-variables.md](reference/environment-variables.md)**. The minimum you must fill in:

| `.env` | Must set |
|--------|----------|
| `services/api-gateway` | `JWT_ACCESS_SECRET` |
| `services/auth-service` | `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (different from the access secret), `INTERNAL_SERVICE_TOKEN` (required since Wave 5) |
| `services/workspace-service` | `MONGO_URI`, `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` (required since Wave 5) |
| `services/document-service` | `MONGODB_URI` or `MONGO_URI`, `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| `services/task-service` | `MONGODB_URI` or `MONGO_URI`, `JWT_ACCESS_SECRET` |
| `services/ai-service` | `MONGODB_URI` or `MONGO_URI`, `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN`, `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`, `XAI_API_KEY` (or `GROQ_API_KEY`) |
| `frontend` | nothing (`VITE_API_URL` defaults to `http://localhost:5000/api`; if set, it must include `/api`). A production build only allows the API origin it was built with (Content-Security-Policy, SEC-008), so set it before `npm run build` |

**Existing `.env` files after Wave 4:** `services/auth-service/.env` may still contain `ACCESS_TOKEN_EXPIRES=15m`, which overrides the new 5-minute default; remove that line or set `5m`. New optional settings: `HOST` (every service), `TRUST_PROXY` and `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` (gateway), `MIN_RELEVANCE_SCORE` (ai-service); see the environment reference.

**Existing `.env` files after Wave 5 (do this before starting the new code):** set the **same** `INTERNAL_SERVICE_TOKEN` in `services/auth-service/.env` and `services/workspace-service/.env` (and document-, ai- and task-service); both services now refuse to start without it. Make sure `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in auth-service differ, or auth-service refuses to start. New optional settings: `CORS_ORIGIN` and `API_DOCS_ENABLED` (gateway; the dev server works without `CORS_ORIGIN`, on any localhost port), `API_DOCS_ENABLED` (document-, task-service), `UPLOAD_TMP_DIR` (document-service). `CORS_ORIGIN` is no longer read by document- or task-service.

**Existing `.env` files after Wave 6 (startup requirements; do this before starting the new code):**
1. `services/task-service/.env`: set `INTERNAL_SERVICE_TOKEN` to the **same** value as in workspace-service. task-service now refuses to start without it (or with the `<placeholder>` from `.env.example`).
2. `services/auth-service/.env`: `ACCESS_TOKEN_EXPIRES` must be a duration with a unit and at most 15 minutes (`5m`, the default, or up to `15m`); `REFRESH_TOKEN_EXPIRES` must have a unit, be at most 30 days and longer than the access lifetime (default `7d`). A value without a unit (for example `604800`) is refused, because jsonwebtoken would read it as milliseconds. Removing `ACCESS_TOKEN_EXPIRES` (default 5 minutes, SEC-007) is still recommended.
3. Gateway: an invalid `TRUST_PROXY` or `CORS_ORIGIN` now stops the gateway with one line `[api-gateway] refusing to start: <VARIABLE> ...` (no stack trace). The accepted values did not change, except that IPv4-compatible IPv6 forms such as `::0.0.0.0/96` (which crashed the gateway before) are refused.
4. Registration now refuses names longer than 100 characters (after trimming), e-mail addresses longer than 254 and passwords longer than 128. Sign-in is unchanged.

The service URLs (`*_SERVICE_URL`) and `REDIS_URL` default to the local ports above.

Rules that apply to every service:
- `JWT_ACCESS_SECRET` must be identical in every service. `JWT_REFRESH_SECRET` (auth-service only) must differ from it. `INTERNAL_SERVICE_TOKEN` must be identical wherever it is set.
- Services refuse to start if a required secret is missing, a `<placeholder>`, shorter than 32 characters, or a known-insecure value. Generate each one with `openssl rand -hex 48`, or where OpenSSL is not available (e.g. plain PowerShell) with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `INTERNAL_SERVICE_TOKEN` is checked at startup by auth-, workspace-, document- and ai-service (since Wave 5 also auth and workspace). task-service uses it only to unassign a removed member's tasks.
- MongoDB: auth-service and workspace-service read only `MONGO_URI`; document-, task- and ai-service read `MONGODB_URI` first, then `MONGO_URI`. The compose MongoDB has authentication enabled and one user per service, so a local URI has the form `mongodb://<service-user>:<service-password>@127.0.0.1:27017/<service-database>?authSource=admin` (values from the root `.env`, section 2).
- ai-service will not start without non-empty Voyage, Pinecone and Groq/xAI settings, and exits if the Pinecone index is missing, its dimension differs from `VOYAGE_EMBEDDING_DIMENSION` (default `1024`), or Pinecone rejects the key (401). If Pinecone cannot be reached at startup it only logs a warning.
- Changing `VOYAGE_MODEL` hides existing documents from retrieval until they are re-indexed (vectors from another model are ignored).

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
npm run preview -w frontend      # [UNTESTED] serve the built bundle (sends the CSP header)
```

Check that a service is up (`200` = healthy, `503` = a dependency is down; the gateway's `/health` always answers `200` and reports `status: "degraded"` when its rate-limit Redis is down):

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
  npm run typecheck:tests                                  # [TESTED] tsc -p tests (strict)
  npm run lint                                             # [TESTED] frontend ESLint, at most 3 warnings
  npm run build -w frontend                                # [TESTED]
  TEST_MONGO_URI=mongodb://127.0.0.1:27018 TEST_REDIS_URL=redis://127.0.0.1:6395 npm test   # disposable servers on loopback, non-default ports (see docs/testing.md section 2)
  ```

- `npm run lint -w frontend` **[TESTED]** reports 0 errors and 3 warnings (30 baselined suppressions) and is a CI gate since Wave 6 (`--max-warnings 3`; the suppression baseline may only shrink). Do not add new problems.
- API documentation: the gateway serves Swagger UI at `http://localhost:5000/api-docs` when started with `API_DOCS_ENABLED=true` (off by default since Wave 5); the reference is [reference/api.md](reference/api.md).
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
