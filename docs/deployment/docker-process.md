# Docker Deployment & Container Process — ResearchMind

> **Status: deployment is incomplete and not production-ready.** The repository contains a Docker Compose file for local infrastructure only. There are **no Dockerfiles, no container images for the services, no deployment manifests** (Kubernetes, Railway, Vercel, Render or similar), no reverse proxy/TLS configuration and no deploy step in CI. Everything below describes what exists today and what an operator would have to provide; containerizing and deploying the services is roadmap / not yet implemented.

Command status: **TESTED** = run successfully during the Wave 1–4 audits; **UNTESTED** = matches the repository files but was not run.

---

## Overview

ResearchMind uses Docker Compose to run local infrastructure only (MongoDB, Redis and Mongo Express). The Node services and the frontend are **not** containerized: there are no Dockerfiles, and they run with npm scripts (see [onboarding.md](../onboarding.md)). Containerizing the services is roadmap / not yet implemented.

---

## Infrastructure Services (`docker-compose.yml`)

See `docker-compose.yml` and `docker-compose.tools.yml` for the exact definitions. Summary:

| Service | File | Image | Container | Host port (127.0.0.1 only) | Notes |
|---------|------|-------|-----------|----------------------------|-------|
| `mongodb` | `docker-compose.yml` | `mongo:7.0` | `researchmind-mongodb` | `MONGO_HOST_PORT` (default `27017`) | Root user from `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` (required). One user per service, created on a fresh volume by `docker/mongo/provision-service-users.js`. Health check: `mongosh` ping. Data in volume `mongodb_data` |
| `redis` | `docker-compose.yml` | `redis:7.4` | `researchmind-redis` | `REDIS_HOST_PORT` (default `6379`) | Password required (`--requirepass` from `REDIS_PASSWORD`), protected mode on. Data in volume `redis_data` |
| `mongo-express` | `docker-compose.tools.yml` (opt-in) | `mongo-express:1.0.2` | `researchmind-mongo-express` | `MONGO_EXPRESS_HOST_PORT` (default `8081`) | **Not started by a plain `docker compose up`.** Basic auth from `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD` (required); logs in to MongoDB as root; `restart: on-failure` |

- **Localhost only.** Every port is published on `127.0.0.1`, so nothing is reachable from other machines. Use `127.0.0.1` (not `localhost`) in connection strings: `localhost` can resolve to `::1`, which is not published.
- **No default credentials.** If there is no root `.env` yet, copy `.env.example` (repository root) to `.env` without overwriting (see [Quick Commands](#quick-commands)) and fill in every empty value; an existing `.env` is edited, never copied over. `docker compose` refuses to start while a required value is missing or empty and names the variable (`required variable … is missing a value`). Validate with `docker compose config --quiet`; plain `docker compose config` prints the secrets.
- **Applied once.** MongoDB creates the root user and the per-service users only when the `mongodb_data` volume is first initialised. For an existing volume, see [Securing an existing installation](#securing-an-existing-installation-host-remediation).
- **Check the first start.** `docker compose logs mongodb | grep provision-service-users` (PowerShell: `| Select-String provision-service-users`) must show five `provision-service-users: created <user> (readWrite on <database>)` lines and `done (5 service users)`. A `provision-service-users: <VARIABLE> …` error means the script rejected that value and created **no** service user: a service password shorter than 16 characters or with characters outside `A-Z a-z 0-9 . _ ~ -` (for example `+`, `/` or `=` from `openssl rand -base64`; use `openssl rand -hex 24`), a database name with `.` or other characters outside `A-Z a-z 0-9 _ -`, a system database name (`admin`, `local`, `config`), duplicate user or database names, or a service user name equal to the root user. The failure is easy to miss: the container exits once, `restart: unless-stopped` starts it again, init is skipped because the volume is no longer empty, and MongoDB reports healthy with the root user only, so every service fails with `Authentication failed`. **Recovery** (keeps the volume): fix the named value in the root `.env`, run `docker compose config --quiet` and `docker compose up -d` (recreates the container with the corrected environment), then run the script by hand as in step 6 of [Securing an existing installation](#securing-an-existing-installation-host-remediation), entering `MONGO_ROOT_PASSWORD` at the prompt: `docker exec -it researchmind-mongodb mongosh -u <MONGO_ROOT_USERNAME> -p --authenticationDatabase admin /docker-entrypoint-initdb.d/10-provision-service-users.js`. If the data is disposable, `docker compose down -v` (**deletes all MongoDB and Redis data**) and a fresh start also work.
- **Visible to Docker users.** The Redis password (command line) and the MongoDB passwords (container environment) can be read with `docker inspect` by anyone who can use Docker on the host. This is acceptable for local development only.
- `mongodb` and `redis` use `restart: unless-stopped`. There are no resource limits and no network isolation. Since Wave 6 (W6-CI-20) the image tags are pinned to the minor line, `mongo:7.0` / `redis:7.4` (the same lines the former `mongo:7` / `redis:7` resolved to, and the tags the CI test job uses); they are not pinned to a digest (a patch update arrives on the next pull); `mongo-express` is pinned to `1.0.2` because its basic auth depends on that image's `ME_CONFIG_BASICAUTH*` variables. The `docker/redis` folder is empty and unused.

### Service credentials

Each service connects as its own MongoDB user, with `readWrite` on its own database only. A service cannot read or write another service's database, list other databases or read user data in `admin`. The users live in the `admin` database, so connection strings keep `?authSource=admin`:

| Service | `.env` setting | Root `.env` variables |
|---------|----------------|-----------------------|
| auth-service | `MONGO_URI=mongodb://<user>:<password>@127.0.0.1:27017/<database>?authSource=admin` | `MONGO_AUTH_USERNAME` / `_PASSWORD` / `_DATABASE` |
| workspace-service | as above | `MONGO_WORKSPACE_*` |
| document-service | as above (`MONGODB_URI` takes precedence if set) | `MONGO_DOCUMENT_*` |
| task-service | as above (`MONGODB_URI` takes precedence if set) | `MONGO_TASK_*` |
| ai-service | as above (`MONGODB_URI` takes precedence if set) | `MONGO_AI_*` |
| api-gateway, document-service, ai-service | `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379` | `REDIS_PASSWORD` |

The provisioning script requires every `MONGO_<SERVICE>_USERNAME`, `_PASSWORD` and `_DATABASE` value. It checks them all before it changes anything (passwords: 16–256 URL-safe characters, `A-Z a-z 0-9 . _ ~ -`; database names: `A-Z a-z 0-9 _ -`, no `.`, not `admin`/`local`/`config`). It creates missing users and resets existing ones to exactly `readWrite` on their database. It never prints a password, and it refuses to modify the user running it or any user that holds other roles (such as root). auth-service does not use Redis.

### Optional: mongo-express

```bash
docker compose -f docker-compose.yml -f docker-compose.tools.yml up -d mongo-express   # http://127.0.0.1:8081
docker compose -f docker-compose.yml -f docker-compose.tools.yml stop mongo-express    # stop it when done
```

mongo-express gives full access to every database to anyone who passes its basic auth, so use it only while you need it.

### Securing an existing installation (host remediation)

Installations created from the earlier compose file published MongoDB (27017), Redis (6379) and mongo-express (8081) on **all network interfaces**. They used the root user with a weak default password, Redis had no password, and every service connected as root (audit findings SEC-001 and SEC-014). Changing the compose file does **not** change an existing MongoDB volume: it keeps its old root password and has no service users. Treat any data that was reachable as potentially read or modified. The steps below are for the machine owner; the repository changes do not run them.

If the data is disposable, the simplest path is to delete everything and start fresh: `docker compose down -v` (**deletes all MongoDB and Redis data**), fill in `.env`, then run `docker compose up -d`. Otherwise:

> **What the next `docker compose up` does (Wave 6, W6-R5-07).** Since Wave 6 `docker-compose.yml` names `mongo:7.0` and `redis:7.4`. The running `researchmind-mongodb` / `researchmind-redis` were created from `mongo:7` (7.0.x) and `redis:7` (7.4.x), so the next `docker compose up -d` **recreates both containers** on the **same named volumes** (`mongodb_data`, `redis_data`; data is kept, patch-level upgrade within the same minor line) and applies the Wave 1–6 hardening at the same time: loopback-only ports, every credential required (compose refuses to start until the root `.env` is complete), and Redis `requirepass`, so **every service's `REDIS_URL` must carry the password** from then on. Before that run: **back up first** (for example `docker exec researchmind-mongodb mongodump --archive=/data/db/pre-wave6.archive -u <root-user> -p --authenticationDatabase admin`, then copy it out with `docker cp`), populate the root `.env` (step 3), and stop the Node services. mongo-express is no longer in `docker-compose.yml`, so `docker compose up` reports `researchmind-mongo-express` as an **orphan container**: remove it with `docker rm -f researchmind-mongo-express` (step 1) or run `docker compose up -d --remove-orphans`; start it again only through `docker-compose.tools.yml` when needed. Nobody but the machine owner runs these commands.

1. **Stop the exposure now.** `docker stop researchmind-mongo-express` and `docker rm researchmind-mongo-express` (it is no longer part of `docker-compose.yml`). In an administrator PowerShell, check the network profile with `Get-NetConnectionProfile`. If the active network is `Public`, switch it with `Set-NetConnectionProfile -InterfaceAlias "<interface>" -NetworkCategory Private`, or disable or scope the inbound Docker rules: `Get-NetFirewallRule -DisplayName "*Docker*" | Where-Object Enabled -eq True | Format-Table DisplayName,Profile,Direction,Action`.
2. **Find the current root user.** It is the user your services' `MONGO_URI` values use today: `admin` unless `MONGO_ROOT_USERNAME` was set when the volume was created. The old `MONGO_ROOT_USER` name was never read by Compose, so its value says nothing about the real root user. Also note the current root password.
3. **Edit the root `.env`** (compare with `.env.example`):
   - delete the old `MONGO_ROOT_USER` line and set `MONGO_ROOT_USERNAME` to the root user that **already exists in the volume** (from step 2, normally `admin`). This is not necessarily the value your old `MONGO_ROOT_USER` line held. mongo-express uses the same variable, so it stays consistent;
   - set `MONGO_ROOT_PASSWORD` to a **new** value (`openssl rand -hex 24`);
   - add `REDIS_PASSWORD`, and all fifteen `MONGO_<SERVICE>_USERNAME` / `_PASSWORD` / `_DATABASE` values. Each `_DATABASE` must be the database named in that service's current `MONGO_URI`/`MONGODB_URI`; the names in `.env.example` are only examples;
   - add `MONGO_EXPRESS_USERNAME` / `_PASSWORD` if you use mongo-express;
   - delete `MONGO_URI`, `REDIS_HOST` and `REDIS_PORT` from the root `.env` (nothing reads them).
   Then run `docker compose config --quiet`: no output means every variable is set.
4. **Stop the Node services**, then recreate the containers with the new configuration (volumes are kept): `docker compose up -d`. `docker ps` should now show `127.0.0.1:27017->27017/tcp` and `127.0.0.1:6379->6379/tcp`. MongoDB still accepts only the **old** root password at this point.
5. **Rotate the root password.** Enter the **old** password at the prompt. The new one is read from the container environment, so it is never typed or printed:
   `docker exec -it researchmind-mongodb mongosh -u <root-user> -p --authenticationDatabase admin --quiet --eval "db.getSiblingDB('admin').changeUserPassword(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)"`
   If it reports that the user was not found, `MONGO_ROOT_USERNAME` does not match the existing root user: fix `.env` and repeat step 4.
6. **Create the service users.** Enter the **new** root password at the prompt. The script is already inside the container, and the values come from the container environment:
   `docker exec -it researchmind-mongodb mongosh -u <root-user> -p --authenticationDatabase admin /docker-entrypoint-initdb.d/10-provision-service-users.js`
   Expect one `created <user> (readWrite on <database>)` line per service. The script is safe to re-run; it then prints `updated …`.
7. **Update each service's `.env`:**
   - auth-, workspace-, document-, task- and ai-service: `MONGO_URI=mongodb://<MONGO_X_USERNAME>:<MONGO_X_PASSWORD>@127.0.0.1:27017/<MONGO_X_DATABASE>?authSource=admin`. If the service has a `MONGODB_URI`, change or remove it too, because it takes precedence;
   - api-gateway, document-service and ai-service: `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379`. document-service had no `REDIS_URL` and must get one;
   - auth-service: delete `REDIS_HOST` and `REDIS_PORT`.
8. **Start the services** and check `GET /health` on ports 5001–5006: every one should answer `200`. While `REDIS_URL` is wrong, document-service answers `503` with `redis: "down"`, and ai-service answers `200` `status: "degraded"` on `/health` and `503` on `/health/ready` (ARC-008, Wave 5).
9. **Verify** (all read-only):
   - `docker port researchmind-mongodb` and `docker port researchmind-redis` list only `127.0.0.1` addresses;
   - `docker exec researchmind-redis redis-cli ping` answers `NOAUTH Authentication required.`;
   - `docker exec researchmind-mongodb mongosh -u admin -p password --authenticationDatabase admin --quiet --eval "1"` fails with `Authentication failed`;
   - a service user is refused on another service's database: `docker exec -it researchmind-mongodb mongosh -u <auth-service-user> -p --authenticationDatabase admin --quiet --eval "db.getSiblingDB('<workspace-database>').getCollectionNames()"` reports `not authorized`;
   - from PowerShell, `Test-NetConnection <this-machine's-LAN-IP> -Port 27017` (and `6379`, `8081`) reports `TcpTestSucceeded : False`.
10. **Afterwards.** Rotate `JWT_REFRESH_SECRET` in auth-service's `.env` to log every session out: refresh-token hashes and user records were reachable. Consider asking users to change their passwords. Use the root account only for administration.

### Legacy data hygiene (optional, user-run, SEC-024)

Nothing here runs automatically. Two reviewed scripts report first and change something only with an explicit flag. **Back up first** (`mongodump`), run the dry run, read its output, then run one flag at a time. Both are idempotent; unknown flags are refused.

| Run from | Command | Effect |
|---|---|---|
| `services/workspace-service` | `npx ts-node src/scripts/legacy-data-hygiene.ts` | Dry run: counts workspaces whose invite code is not in the current format (8 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) and the documents in the unused `workspacemembers` collection. Prints workspace ids and counts, never a code |
| | `… --rotate-legacy-invite-codes` | Gives each of those workspaces a new code. **Codes already shared stop working**; members stay members |
| | `… --drop-workspacemembers` | Drops the unused `workspacemembers` collection (**irreversible**) |
| `services/document-service` | `npx ts-node src/scripts/legacy-data-hygiene.ts` | Dry run: counts the unused `workspaces` collection in the document database and lists files older than 1 hour in the legacy `services/document-service/uploads` folder |
| | `… --drop-empty-workspaces-collection` | Drops that collection **only if it is empty** |
| | `… --delete-legacy-uploads` | Deletes those top-level files (no subfolders, no links) |

The scripts read the service's own `.env` (`MONGO_URI`; document-service also `MONGODB_URI`). A leftover Redis key named `test` (no TTL) is not used by the application; check and remove it by hand: `docker exec -it researchmind-redis redis-cli -a <REDIS_PASSWORD> TYPE test`, then `DEL test`.

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
- Auth Service does not use Redis.
- Redis requires a password: every client uses `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379` (api-gateway, document-service, ai-service).

---

## Environment Requirements

Every service reads `.env` from its working directory (the service folder when started through npm). Variable names, defaults and required/optional status: **[reference/environment-variables.md](../reference/environment-variables.md)**. Deployment-relevant rules:

- `JWT_ACCESS_SECRET` identical in all six services; `JWT_REFRESH_SECRET` (auth-service) different from it; `INTERNAL_SERVICE_TOKEN` identical in auth-, workspace-, document-, task- and ai-service. Each at least 32 characters; services refuse to start on a missing, placeholder or weak required secret. **Since Wave 5** auth-service and workspace-service also refuse to start without `INTERNAL_SERVICE_TOKEN`, and auth-service refuses to start when the two JWT secrets are equal (SEC-018, SEC-019).
- **`CORS_ORIGIN` (gateway, SEC-015).** Set it to the frontend's exact origin(s) in any deployment; unset allows only loopback origins (local development). `API_DOCS_ENABLED=true` turns Swagger UI on (off by default, SEC-016). `UPLOAD_TMP_DIR` (document-service) moves the upload temp folder (default `<OS temp>/researchmind-uploads`, SEC-024).
- Service URLs default to `localhost` ports; set every `*_SERVICE_URL` explicitly when services run on different hosts.
- **Listen address (SEC-004, Wave 4).** auth, workspace, document, task and ai-service listen on `127.0.0.1` by default; the gateway on `0.0.0.0`. When services run in separate containers or on different hosts, set `HOST=0.0.0.0` for each service that must be reachable from another host, and keep those ports on a private network. A port already in use stops the service with exit code 1 (`EADDRINUSE`).
- **Behind a reverse proxy**, set `TRUST_PROXY` on the gateway to the number of proxies (or their addresses) so rate limits see the real client IP; without it every user shares the proxy's per-IP buckets (login, register and the 60/min auth limiter for refresh, `/me` and logout, SEC-021) (`true` and over-broad CIDRs such as `0.0.0.0/0` are refused). `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` (default 120 s) bounds how long the gateway waits on a silent upstream before answering `504`.
- `VITE_API_URL` is baked into the frontend bundle at build time and must include the `/api` suffix. The build also writes its origin into the bundle's Content-Security-Policy (`connect-src`), so a bundle only talks to the API origin it was built for. A static host should also send the CSP as a header (see [security.md](../architecture/security.md#8-cors-and-http-headers)).
- **Dependencies.** Install with a plain `npm ci` (verified for the Wave 4 lockfile); run it again after pulling a lockfile change.
- There is no secret manager integration; secrets come from `.env` files or the process environment.

---

## Runtime Dependencies

| Process | Required at startup | Needed at request time | External providers |
|---------|--------------------|------------------------|--------------------|
| api-gateway (5000) | `JWT_ACCESS_SECRET` | Redis (rate limits; fails open), all downstream services | — |
| auth-service (5001) | MongoDB | — | — |
| workspace-service (5002) | MongoDB | auth-service (member names only) | — |
| document-service (5003) | MongoDB | Redis (queue), workspace-service (membership), ai-service (vector removal on delete) | Cloudinary |
| task-service (5004) | MongoDB | workspace-service (membership) | — |
| ai-service (5006) | MongoDB; provider keys present; Pinecone accepts the key (401 is fatal) and the index matches the embedding dimension (skipped with a warning if Pinecone is unreachable) | Redis (in-process worker), workspace-service, document-service (worker claim/status, live-document check for every retrieval and for the session history) | Voyage AI, Pinecone, Groq or xAI |
| ai-service worker (no port) | `INTERNAL_SERVICE_TOKEN`; provider keys; Pinecone index check | Redis, document-service | Voyage AI, Pinecone |
| frontend (5173 dev) | — | api-gateway | — |

---

## Health Endpoints

| Service | Endpoint | Checks | Response |
|---------|----------|--------|----------|
| api-gateway | `GET http://<host>:5000/health` | Rate-limit Redis connection state (ISS-044) | Always `200` `{ success, service, status: "healthy"\|"degraded", dependencies: { rateLimitStore: "up"\|"down" } }`; `degraded` = rate limits currently fail open |
| auth-service | `GET http://<host>:5001/health` | MongoDB | `200` healthy / `503` unhealthy |
| workspace-service | `GET http://<host>:5002/health` | MongoDB | `200` / `503` |
| document-service | `GET http://<host>:5003/health` | MongoDB + Redis | `200` / `503` |
| task-service | `GET http://<host>:5004/health` | MongoDB | `200` / `503` |
| ai-service | `GET http://<host>:5006/health` | MongoDB (+ Redis reported) | `503` only when MongoDB is down; Redis down alone gives `200` with `status: "degraded"` (ARC-008, Wave 5) |
| ai-service | `GET http://<host>:5006/health/ready` | MongoDB + Redis | `200` / `503` (strict; use it for monitors that must notice the embedding queue) |
| ai-service worker | none | — | Monitor its logs |

The shared handler (`packages/shared/health/healthCheck.ts`) answers `{ success, service, status: "healthy" | "degraded" | "unhealthy", uptime, dependencies: { mongo, redis? } }`. Only ai-service has a separate strict `/health/ready`; elsewhere `/health` is the combined liveness/readiness check. No endpoint checks Cloudinary, Voyage, Pinecone, the LLM provider or peer services. Service health endpoints are not proxied by the gateway; call each service's port directly.

---

## Startup Ordering

1. **MongoDB and Redis.** MongoDB-backed services make one bounded connection attempt (about 30 s) and exit with code 1 if it fails. Redis may come later: clients reconnect indefinitely, and ai-service starts without it (its worker waits).
2. **workspace-service** (and auth-service). Every workspace-scoped request in document-, task- and ai-service asks workspace-service about membership; while it is unreachable those requests answer `503`.
3. **document-service before or together with ai-service.** The embedding worker claims every job through document-service's internal endpoint `POST /internal/documents/:id/embedding/claim` before doing any work. If document-service is unreachable when a job is popped, the claim fails, the error is logged and the job is not processed; the document stays `pending` until document-service's recovery sweep (at its startup and every 5 minutes) re-queues it. When upgrading, deploy document-service first: an ai-service talking to a document-service without the claim endpoint treats the missing endpoint as an error rather than skipping jobs. See [operations/background-jobs.md](../operations/background-jobs.md).
4. **task-service, api-gateway, frontend** in any order. The gateway answers `503` for a downstream service it cannot reach.

**Wave 4 upgrade notes.** document-service and ai-service can be updated in either order (the internal live-documents response only gained a field). At the first start after the update, document-service and task-service build new MongoDB indexes for list paging on the existing collections, and document-service's recovery sweep marks existing documents without text as `failed` (`No extractable text`). Remove `ACCESS_TOKEN_EXPIRES=15m` from `services/auth-service/.env` to get the new 5-minute default.

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

- All services log to stdout/stderr with `console`; there is no log shipping and no log level setting (except document-service's `winston` logger, which logs `debug` when `NODE_ENV=development`, otherwise `info`).
- HTTP access logs (morgan) in api-gateway, auth-, document-, task- and ai-service (not workspace-service) use one shared format that includes the request id (`packages/shared/http/access-log.ts`). The gateway assigns or keeps `X-Request-ID` on every request (ISS-044), forwards it, and returns it in the response, so one request can be followed across the gateway and the service logs.
- document-service additionally uses `winston` (JSON lines) and writes `error.log` and `combined.log` into its working directory, without rotation. In a container, mount or discard that directory accordingly.
- Secrets are never logged by the startup checks (only variable names); embedding jobs are not logged in full because they carry document text.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| A service exits immediately naming a variable | Required secret missing, placeholder, shorter than 32 characters or known-insecure; or `MONGO_URI` / `MONGODB_URI` not set. Since Wave 5: auth-service or workspace-service without `INTERNAL_SERVICE_TOKEN`, or auth-service with `JWT_ACCESS_SECRET` equal to `JWT_REFRESH_SECRET` |
| Gateway does not start: `CORS_ORIGIN` error | `CORS_ORIGIN=*`, an origin with a path, or a malformed entry; list exact origins such as `https://app.example.com` |
| Browser shows a CORS error for the API | The frontend's origin is not in `CORS_ORIGIN` (when set, loopback is not added implicitly) |
| `/api-docs` answers `404 Route not found` | Swagger UI is off by default since Wave 5; set `API_DOCS_ENABLED=true` |
| A service exits after ~30 s | MongoDB unreachable or wrong credentials (service users live in `admin`: the URI needs `?authSource=admin`; use `127.0.0.1`, not `localhost`) |
| Fresh install: every service fails with `Authentication failed`, although `docker compose ps` shows mongodb healthy | The provisioning script rejected an input on the first start, so no service user exists (init never runs again on that volume). `docker compose logs mongodb` shows a `provision-service-users:` error naming the variable instead of five `created …` lines. Fix the value, `docker compose up -d`, run the script by hand: see **Check the first start** under [Infrastructure Services](#infrastructure-services-docker-composeyml) |
| A service starts but requests fail with `not authorized on <db>` | The service user has no role on the database its URI names: `MONGO_<SERVICE>_DATABASE` differs from the URI; fix it and re-run the provisioning script |
| `/health` on 5003 or `/health/ready` on 5006 shows `redis: "down"`; gateway logs `NOAUTH` or `WRONGPASS` | `REDIS_URL` has no or the wrong password |
| `docker compose up` fails with `required variable … is missing a value` | Root `.env` missing that variable (see `.env.example`) |
| ai-service exits with "vector index check failed" | Pinecone index missing, or its dimension differs from `VOYAGE_EMBEDDING_DIMENSION` |
| ai-service exits naming a provider key | `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX` or `XAI_API_KEY`/`GROQ_API_KEY` empty |
| Documents stay `pending` | No worker running, Redis down (`/health` on 5003/5006 shows it), document-service unreachable from ai-service, or `INTERNAL_SERVICE_TOKEN` differs between document- and ai-service (claims rejected with `401`) |
| Deleting a document answers `503` | ai-service unreachable or the Pinecone delete failed; nothing was deleted |
| Workspace-scoped requests answer `503` | workspace-service unreachable from the calling service |
| Gateway answers `503` "Service temporarily unavailable" | Downstream service not running or wrong `*_SERVICE_URL` |
| Workspace members show a placeholder name | `INTERNAL_SERVICE_TOKEN` / `AUTH_SERVICE_URL` not set or not matching in workspace-service and auth-service |
| New compose credentials are ignored | MongoDB volume already initialised with the old ones: see [Securing an existing installation](#securing-an-existing-installation-host-remediation) |
| `EADDRINUSE` (`[<service>] cannot listen on <host>:<port>: EADDRINUSE`, exit 1) | Another process already uses the port; set `PORT` or stop it |
| Gateway answers `502`/`503` for a service that runs in another container or on another host | The service listens on `127.0.0.1` (default since Wave 4); set `HOST=0.0.0.0` for it |
| Gateway answers `504` "The service took too long to respond" | The upstream service sent nothing for `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` (default 120 s) |
| Gateway does not start: `TRUST_PROXY` error | `TRUST_PROXY=true`, an unrecognised value, or a CIDR that is too wide (below `/8` IPv4 or `/32` IPv6, e.g. `0.0.0.0/0`); use a hop count, specific proxy addresses/ranges, a keyword (`loopback`, `linklocal`, `uniquelocal`) or `off` |
| Browser console shows Content-Security-Policy errors on the built frontend | `VITE_API_URL` at build time differs from the API the browser calls; rebuild with the right value |

---

## Quick Commands

```bash
# One-time, only if there is no root .env yet: create it, then fill in every empty value   [UNTESTED]
# Never copy over an existing .env. -n (no-clobber) leaves an existing file untouched.
cp -n .env.example .env
docker compose config --quiet      # no output = every required variable is set

# Start MongoDB and Redis (not mongo-express)                       [UNTESTED on the default project; TESTED in a throwaway project by tests/compose-security.runtime.test.ts]
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

PowerShell has no no-clobber `Copy-Item` switch (`Copy-Item` overwrites silently), so create the root `.env` with a guard:

```powershell
# One-time, only if there is no root .env yet                    [UNTESTED]
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose config --quiet
```

---

## Missing for a Production Deployment

- Dockerfiles / images for the six services and the frontend, and a compose or orchestration file that runs them.
- Deployment manifests and a CD step; CI (five jobs since Wave 6: `static`, `build`, `test`, `compose-runtime`, `audit`) only checks, builds and tests.
- TLS termination, a reverse proxy, restricted CORS on the gateway (it currently allows any origin) and private networking for MongoDB/Redis.
- Separate readiness checks for providers and peers, metrics, structured logging and alerting.
- Managed MongoDB/Redis (with TLS), backups and secret management. Locally, Redis has a password and MongoDB has per-service users, but secrets live in plain `.env` files.
