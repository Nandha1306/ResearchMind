# API reference

This reference was built from the route registrations, mount prefixes, gateway proxy filters, validation schemas and controllers on branch `fix/wave-4`. Paths are given **as seen through the API gateway** (`http://localhost:5000`). The frontend calls `${VITE_API_URL}` (default `http://localhost:5000/api`) plus the path after `/api`.

Contents:
1. Conventions (envelope, authentication, errors, body limits)
2. Rate limits
3. Route index
4. Route details: Auth · Workspaces · Documents · Boards · Tasks · AI
5. SSE protocol of `POST /api/ai/query`
6. Response object shapes
7. Internal service-to-service routes
8. Health endpoints and Swagger UI
9. Swagger files vs. code
10. Unverified items

---

## 1. Conventions

### 1.1 Gateway routing (`services/api-gateway/src/app.ts`)

| Gateway prefix (`pathFilter`) | Target (env, default) | Gateway auth | Gateway rate limiters |
|---|---|---|---|
| `/api/auth` | `AUTH_SERVICE_URL`, `http://localhost:5001` | **none** | `POST /api/auth/login`, `POST /api/auth/register`, then `auth-api` (60/min per IP) for every auth route (SEC-021) |
| `/api/workspaces` | `WORKSPACE_SERVICE_URL`, `http://localhost:5002` | `authenticate` | general |
| `/api/documents` | `DOCUMENT_SERVICE_URL`, `http://localhost:5003` | `authenticate` | general |
| `/api/tasks` | `TASK_SERVICE_URL`, `http://localhost:5004` | `authenticate` | general |
| `/api/ai` | `AI_SERVICE_URL`, `http://localhost:5006` | `authenticate` | AI-specific, then general |

- **Paths are forwarded unchanged.** The proxy is mounted at the root, and each service mounts its router under the same `/api/...` prefix.
- **The gateway parses no bodies.** It streams them through.
- **`/internal/*` is never proxied.** No path filter covers it.
- **The gateway checks the bearer token only.** It does **not** check workspace membership. Every service also verifies the token itself.
- **Request id (ISS-044).** Every response from the gateway carries `X-Request-ID`. A client-supplied `X-Request-ID` matching `^[A-Za-z0-9._:-]{1,128}$` is kept; anything else is replaced by a new UUID. The id is forwarded to the upstream service and appears in every service's access log, so one request can be followed across services.
- **Upstream timeout (RT-003).** If an upstream service sends nothing (no response and no data) for `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` (default 120 s), the gateway answers **504** `The service took too long to respond. Please try again.` The timer restarts on every chunk of data, so answer streams are not cut. The upstream may still complete the work after the 504.
- **Security headers (SEC-008, SEC-017).** Gateway responses carry helmet's default headers including a `Content-Security-Policy` (`default-src 'self'` …). Swagger UI at `/api-docs` (only when `API_DOCS_ENABLED=true`, SEC-016) works under it. Upstream `X-Powered-By` headers are removed.
- **CORS (SEC-015).** Only the gateway answers CORS. `CORS_ORIGIN` unset: any `http://localhost:<port>` or `http://127.0.0.1:<port>` origin (local development); set: exactly the listed origins. A disallowed origin gets no `Access-Control-Allow-Origin`. `*` or a malformed entry stops the gateway at startup.
- **Unknown routes (ISS-041).** Any path that no proxy, `/health` or `/api-docs` handles, and any unknown route inside a service, answers **404** `{ "success": false, "message": "Route not found" }` (JSON; the path is not echoed). It used to be Express's HTML `Cannot GET …` page.

### 1.2 Authentication

- **Access token.** Send `Authorization: Bearer <accessToken>`. Tokens are HS256 JWTs signed with `JWT_ACCESS_SECRET`; the payload is `{ userId }` and the default lifetime is 5 min (`ACCESS_TOKEN_EXPIRES`, SEC-007; it was 15 min before Wave 4). Every verifier pins `algorithms: ["HS256"]`. Since Wave 5 every verifier goes through one shared `verifyAccessToken` (`packages/shared/auth/access-token.ts`, SEC-019/ISS-047), which also requires `userId` to be a 24-character hex string; any other payload (missing, an object, a number, another string) is rejected with the same 401 as an invalid signature. Refresh tokens get the same `userId` check.
- **Gateway `authenticate`** (`services/api-gateway/src/middlewares/auth.middleware.ts`):
  - No `Bearer ` prefix: **401** `Unauthorized`.
  - Verification fails: **401** `Invalid token`.
- **Service-level messages:**
  - Shared `authenticate` (document, task, ai; `packages/shared/auth/authenticate.ts`) and auth-service: **401** `Authentication required`, or `Invalid or expired access token`.
  - workspace-service: **401** `Unauthorized`, or `Invalid or expired token`.
- **Refresh token.** Sent in the JSON body of `/api/auth/refresh` and `/api/auth/logout`, not in a header or cookie.

### 1.3 Workspace membership checks

document, task and ai services call workspace-service with the caller's own bearer token (`packages/shared/auth/workspace-membership.ts`).

| Outcome | Status | Message |
|---|---|---|
| Workspace id is not a 24-hex ObjectId | 400 | `Invalid workspace ID` |
| No `Authorization` header forwarded, or workspace-service answers 401 | 401 | `Authentication required` |
| Not a member | 403 | Route-specific (see each route) |
| Timeout (3 s), network error, non-2xx or malformed reply | **503** | `Workspace access could not be verified right now. Please try again.` |

Task assignees are validated with `GET /api/workspaces/:id`. When that lookup returns 404 or 403, the caller gets **403** `You are not a member of this workspace`.

### 1.4 Response envelope

- Success: `{ "success": true, "data": ..., "message"?: string }`. Some routes add fields; each route lists them.
- Error: `{ "success": false, "message": string }`.
- Zod validation failures (`packages/validation/validation.ts`) also return `"errors": string[]`. `message` is those strings joined with `", "`.
- Unknown body keys are **stripped** by `validate()`.
- There are no machine-readable error codes (product scope, ISS-041/REQ-020). `ResearchMind_readme.md` §13 describes a `{ error: { code } }` envelope as a design only.
- Unknown routes use this envelope too: **404** `Route not found` (ISS-041, §1.1).
- **List paging (ISS-043, additive).** The list routes for documents, boards, tasks and task activities accept optional `limit` and `cursor` query parameters and add `meta: { limit, nextCursor, hasMore }` next to `data`:
  - `limit` defaults to the cap and is clamped to it: documents 500, tasks 500, boards 200, activities 200. A non-integer or `< 1` `limit` returns **400**.
  - `cursor` is the opaque `meta.nextCursor` of the previous page (base64url of `createdAt|_id`). A malformed cursor returns **400** `Invalid cursor`.
  - Order is stable: newest first (`createdAt` desc, `_id` desc) for documents, tasks and activities; oldest first for boards.
  - `hasMore: false` and `nextCursor: null` on the last page. Without `limit`/`cursor` the response shape is unchanged apart from `meta`, and holds everything up to the cap.
  - The frontend follows `nextCursor` for up to 10 pages per list and shows "Showing the first N …" when more exist.

### 1.5 Error statuses produced

Mapped by `packages/shared/errors/error.middleware.ts` unless noted otherwise.

| Status | When | Message |
|---|---|---|
| 400 | Zod validation | joined messages, plus `errors[]` |
| 400 | Malformed JSON body | `Malformed JSON in request body` |
| 400 | Mongoose `CastError` (a malformed ObjectId reaching a query) | `Invalid resource ID` |
| 400 | Mongoose `ValidationError` | Mongoose message |
| 400 | Other multer errors (wrong field name, too many parts) | multer message |
| 401 | See §1.2. Internal routes return `Unauthorized` | — |
| 403 | Not a workspace member | route-specific |
| 404 | Not found, or found but not visible to the caller (route-specific) | route-specific |
| 404 | Unknown route, in any service or at the gateway (`notFoundHandler`, ISS-041) | `Route not found` |
| 409 | Business conflicts (route-specific). Mongo duplicate key `11000` | `A resource with the same unique value already exists` |
| 410 | Internal routes only (document deleted) | — |
| 413 | JSON body > 100 kB (Express `express.json()` default); `POST /api/ai/summarize-meeting` allows 320 kB so 50,000 characters of any script fit (REQ-082) | `Request body is too large` |
| 413 | Upload > 10 MB | `File is too large` |
| 415 / 422 | Upload type or content problems (§4.3) | — |
| 429 | Gateway rate limit (§2) | limiter message |
| 500 | Anything unclassified | `Internal Server Error` |
| 504 | Gateway: the upstream service sent nothing for `GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS` (§1.1) | `The service took too long to respond. Please try again.` |
| 502 | LLM failure on non-streaming AI routes; Cloudinary failure on upload; Voyage or Pinecone failure on `POST /api/ai/search` (RT-011) | `AI service is temporarily unavailable. Please try again.` / `File storage is temporarily unavailable. Please try again later.` / the search route's fixed retrieval message (§4.6) |
| 503 | Gateway cannot reach the upstream service (`handleProxyError`) | `Service temporarily unavailable. Please try again.` |
| 503 | MongoDB unavailable (driver connection errors, buffering timeout) | `Service temporarily unavailable. Please try again later.` |
| 503 | Membership check failed (§1.3); vector cleanup failed on delete; indexing queue unavailable on re-index | route-specific |

---

## 2. Rate limits

Defined in `services/api-gateway/src/middlewares/rate-limit.middleware.ts`.

- **Storage.** Counters live in Redis (`REDIS_URL`) under the prefix `rl:<name>:`.
- **Fail-open.** If Redis errors, requests are **not** limited (`passOnStoreError: true`).
- **Headers.** `RateLimit` and `RateLimit-Policy` (IETF draft-7). Legacy `X-RateLimit-*` headers are off.
- **429 body.** `{ success: false, message }`.

| Limiter | Applies to | Limit | Key | Notes / 429 message |
|---|---|---|---|---|
| `login` | `POST /api/auth/login` | 5 per 15 min | client IP | Only **failed** responses (status ≥ 400) count (`skipSuccessfulRequests`). `Too many sign-in attempts. Please wait 15 minutes and try again.` |
| `register` | `POST /api/auth/register` | 3 per hour | client IP | Every request counts. `Too many accounts created from this network. Please try again later.` |
| `ai-query` | `POST /api/ai/query`, `POST /api/ai/search` (shared counter) | 30 per hour | `user:<userId>` | `You've reached the hourly limit for AI research requests. Please try again later.` |
| `ai-summarize` | `POST /api/ai/summarize-meeting` | 20 per hour | `user:<userId>` | `You've reached the hourly limit for meeting summaries. Please try again later.` |
| `api` (general) | everything under `/api/workspaces`, `/api/documents`, `/api/tasks`, `/api/ai` | 100 per minute | `user:<userId>` | Applied after the AI limiters, so AI calls count against both. `Too many requests. Please slow down and try again shortly.` |
| `auth-api` (`authApiRateLimiter`, Wave 5) | every `/api/auth/*` route: refresh, `/me`, logout, and login/register after their own limiters | 60 requests per minute | client IP | SEC-021: refresh, `/me` and logout used to have no limit. `Too many requests. Please slow down and try again shortly.` A `429` on refresh does **not** sign the SPA out; it keeps the session and retries later. |

- **No unlimited auth routes since Wave 5.** `/api/auth/refresh`, `/api/auth/me` and `/api/auth/logout` share the `auth-api` limit (60 requests per minute per IP).
- **Rejected tokens are not counted.** The user-keyed limiters run after gateway `authenticate`, so requests it rejects never reach them.
- **IP keys.** These use Express `req.ip`. By default the gateway trusts no proxy, so `req.ip` is the socket address. Behind a reverse proxy set `TRUST_PROXY` (RT-008) to the number of proxies or their addresses; `true` and over-broad CIDRs (below `/8` IPv4 or `/32` IPv6, for example `0.0.0.0/0`) are refused at startup. **Without `TRUST_PROXY` behind a proxy, every user shares the proxy's address, so the per-IP limits (login, register, `auth-api`) apply to all users together.**

---

## 3. Route index

Key:
- **FE** = called by `frontend/src/api/*.ts`.
- **M** = workspace membership is checked.

| Method | Path | Auth | M | FE | Section |
|---|---|---|---|---|---|
| POST | `/api/auth/register` | — | — | yes | 4.1 |
| POST | `/api/auth/login` | — | — | yes | 4.1 |
| POST | `/api/auth/refresh` | refresh token in body | — | yes | 4.1 |
| GET | `/api/auth/me` | Bearer (auth-service) | — | yes | 4.1 |
| POST | `/api/auth/logout` | Bearer (auth-service) + refresh token in body | — | yes | 4.1 |
| POST | `/api/workspaces` | Bearer | — | yes | 4.2 |
| GET | `/api/workspaces` | Bearer | — | yes | 4.2 |
| POST | `/api/workspaces/join` | Bearer | — | yes | 4.2 |
| GET | `/api/workspaces/:workspaceId/membership` | Bearer | (answers it) | no (used by services) | 4.2 |
| GET | `/api/workspaces/:workspaceId` | Bearer | yes (404) | no (used by task-service) | 4.2 |
| GET | `/api/workspaces/:workspaceId/members` | Bearer | yes (404) | yes | 4.2 |
| DELETE | `/api/workspaces/:workspaceId/members/:userId` | Bearer | **owner only** | yes | 4.2 |
| POST | `/api/workspaces/:workspaceId/members/:userId/readmit` | Bearer | **owner only** | yes | 4.2 |
| POST | `/api/documents/upload` | Bearer | yes | yes | 4.3 |
| GET | `/api/documents/:id/file` | Bearer | yes | yes | 4.3 |
| GET | `/api/documents/workspace/:workspaceId` | Bearer | yes | yes | 4.3 |
| GET | `/api/documents/:id` | Bearer | yes | no | 4.3 |
| DELETE | `/api/documents/:id` | Bearer | **owner only** | yes | 4.3 |
| POST | `/api/documents/:id/reindex` | Bearer | yes | yes | 4.3 |
| POST | `/api/tasks/workspaces/:workspaceId/boards` | Bearer | yes | yes | 4.4 |
| GET | `/api/tasks/workspaces/:workspaceId/boards` | Bearer | yes | yes | 4.4 |
| GET | `/api/tasks/workspaces/:workspaceId/boards/:id` | Bearer | yes | no | 4.4 |
| PATCH | `/api/tasks/workspaces/:workspaceId/boards/:id` | Bearer | yes | no | 4.4 |
| DELETE | `/api/tasks/workspaces/:workspaceId/boards/:id` | Bearer | **owner only** | no | 4.4 |
| POST | `/api/tasks/workspaces/:workspaceId/tasks` | Bearer | yes | yes | 4.5 |
| POST | `/api/tasks/workspaces/:workspaceId/tasks/bulk` | Bearer | yes | yes | 4.5 |
| GET | `/api/tasks/workspaces/:workspaceId/tasks` | Bearer | yes | yes | 4.5 |
| GET | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Bearer | yes | yes | 4.5 |
| GET | `/api/tasks/workspaces/:workspaceId/tasks/:id/activities` | Bearer | yes | yes | 4.5 |
| PATCH | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Bearer | yes | yes | 4.5 |
| DELETE | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Bearer | **owner only** | yes | 4.5 |
| POST | `/api/ai/query` (SSE) | Bearer | yes | yes | 4.6, 5 |
| POST | `/api/ai/search` | Bearer | yes | yes | 4.6 |
| GET | `/api/ai/sessions/workspace/:workspaceId` | Bearer | yes | yes | 4.6 |
| POST | `/api/ai/summarize-meeting` | Bearer | yes | yes | 4.6 |

"Bearer" means the token is checked by both the gateway and the service, except where the table says "(auth-service)".

---

## 4. Route details

### 4.1 Auth (`services/auth-service/src/routes/auth.routes.ts`, mounted at `/api/auth`)

#### POST `/api/auth/register`

- **Body** (`registerSchema`):
  - `name`: string, ≥ 2 chars.
  - `email`: valid email.
  - `password`: string, ≥ 8 chars, with at least one letter and one digit.
- **201:** `{ success, message: "User registered successfully", data: { user: { id, name, email, avatar }, accessToken, refreshToken } }`.
- **Errors:**
  - 400 validation.
  - 409 `User already exists`.
  - 429.
  - 503.

#### POST `/api/auth/login`

- **Body** (`loginSchema`): `email` (valid email), `password` (non-empty).
- **200:** `{ success, message: "Login successful", data: { user: { id, name, email, avatar }, accessToken, refreshToken } }`.
- **Errors:**
  - 400 validation.
  - 401 `Invalid credentials`, for both an unknown email and a wrong password.
  - 429.
  - 503.

#### POST `/api/auth/refresh`

- **Body:** `{ refreshToken: string }`. There is no schema; a missing token fails verification and returns 401.
- **200:** `{ success, data: { accessToken, refreshToken } }`. The pair is always rotated.
- **Errors (401):**
  - `Invalid or expired refresh token`.
  - `Refresh token has already been used`: the token was rotated within `REFRESH_REUSE_GRACE_MS` (default 10 s). Other sessions are kept.
  - `Invalid or revoked refresh token`: reuse outside the grace window, or an unknown token. **All of the user's refresh tokens are deleted.**
- **Errors (503):** the database is unavailable. The claim is released, so the same token can be retried.

#### GET `/api/auth/me`

- **Auth:** Bearer, checked by auth-service. The gateway does not check `/api/auth`.
- **200:** `{ success, data: { id, name, email, avatar } }`.
- **Errors:** 401, 404 `User not found`.

#### POST `/api/auth/logout`

- **Auth:** Bearer (auth-service).
- **Body** (`logoutSchema`): `refreshToken`, a non-empty string.
- **200:** `{ success, data: { message: "Logged out successfully" } }`. The response is identical whether or not the token existed or belonged to the caller. Only the caller's own matching token is deleted.
- **Errors:** 400 `Refresh token is required`; 401.

### 4.2 Workspaces (`services/workspace-service/src/routes/workspace.routes.ts`, mounted at `/api/workspaces`)

All routes go through gateway `authenticate`, the general limiter, and workspace-service's own `authenticate`. The response object is the **Workspace** shape in §6.

| Route | Body / params | 200/201 response | Errors |
|---|---|---|---|
| `POST /api/workspaces` | `name`: string ≥ 3 (trimmed by the model); `description`?: string ≤ 500 | **201** `{ success, data: Workspace }`. The caller becomes `ownerId` and the only member. An 8-char invite code is generated. | 400 validation; 500 `Failed to generate a unique workspace invite code` (after 5 collisions) |
| `GET /api/workspaces` | — | `{ success, data: Workspace[] }`: workspaces the caller belongs to, newest first | 401 |
| `POST /api/workspaces/join` | `inviteCode`: string, trimmed, 1..64. Matching is case-insensitive (code is trimmed and upper-cased) | `{ success, data: Workspace }` (after the join) | 400 validation; 404 `Invalid invite code`; 409 `You are already a member of this workspace` |
| `GET /api/workspaces/:workspaceId/membership` | `workspaceId` (ObjectId) | `{ success, data: { isMember: boolean, isOwner: boolean } }`. A non-member gets **200 with `false`**, not 403. `isOwner` is true for `Workspace.ownerId` only; services use it for owner-only actions | 400 `Invalid resource ID` (malformed id) |
| `GET /api/workspaces/:workspaceId` | `workspaceId` | `{ success, data: Workspace }` | 404 `Workspace not found or access denied` (missing or not a member); 400 malformed id |
| `GET /api/workspaces/:workspaceId/members` | `workspaceId` | `{ success, data: [{ userId, name, email, avatar? }] }`. Profiles come from auth-service `/internal/users/bulk`. **E-mail visibility (SEC-018, Wave 5):** the workspace owner sees every member's e-mail; any other member sees only their own, and `""` for everyone else. If the profile call fails, `name` is `"Researcher"` and `email` is `""` | 404 / 400 as above |

| `DELETE /api/workspaces/:workspaceId/members/:userId` | — | `{ success, message: "Member removed", data: { removedUserId, tasksUnassigned } }`. **Owner only.** The removed user loses access on their next request to any service (membership is checked live). Their tasks in this workspace are unassigned through task-service (`tasksUnassigned` is `null` if that cleanup could not run; the removal stands) | 403 `Only the workspace owner can remove members`; **400** `The workspace owner cannot be removed` (including the owner removing themself); 404 `That user is not a member of this workspace`; 404 `Workspace not found or access denied` (caller not a member) |
| `POST /api/workspaces/:workspaceId/members/:userId/readmit` | — | `{ success, message, data: { readmittedUserId } }`. **Owner only.** Lifts a removal: the user may join again with the **current** invite code | 403 `Only the workspace owner can re-admit members`; 404 `That user was not removed from this workspace`; 404 (caller not a member) |

**Removal also rotates the invite code and blocks rejoining (SEC-010).** The removal, a new `inviteCode` and the record of the removed user are one atomic update. `POST /api/workspaces/join` then answers **404** `Invalid invite code` for the old code and **403** `You were removed from this workspace. Ask the workspace owner to re-admit you.` for the removed user with the new code, until the owner re-admits them.

`inviteCode` is returned to every member in every Workspace response.

**Owner-only actions (SEC-010).** Only the workspace owner (`Workspace.ownerId`) may delete documents, boards and tasks, and remove members. Other members get **403** with `Only the workspace owner can delete documents.` / `…boards.` / `…tasks.`; non-members get 403 `…not a member…` as before.

### 4.3 Documents (`services/document-service/src/routes/document.routes.ts`, mounted at `/api/documents`)

All routes go through gateway `authenticate`, the general limiter, and the shared `authenticate`. Non-member responses are **403** `Access denied. You are not a member of this workspace.` The response object is the **Document** shape in §6.

#### POST `/api/documents/upload` (multipart/form-data)

- **Form fields:**
  - `file`: exactly one file, extension `.pdf` or `.docx` (case-insensitive), ≤ 10 MB.
  - `workspaceId`: text field.
  - Multer limits: 1 file, 10 fields, 20 parts, 64 KiB per field.
- **Processing order and errors:**
  1. Extension filter: **415** `Only PDF and DOCX files are allowed.` Size: **413** `File is too large`. Wrong field name or other multer error: **400**.
  2. No file: **400** `No file uploaded`. No `workspaceId`: **400** `Workspace ID is required`.
  3. Membership: 400 / 401 / **403** / **503** (§1.3).
  4. Byte check: empty file returns **422** `The uploaded file is empty.`; content that does not match the extension returns **415** `The file content is not a valid PDF document.` (or `DOCX`).
  5. Text extraction fails: **422** `Could not read the PDF file. It may be corrupted or password-protected.`, or the DOCX equivalent.
  6. Cloudinary upload fails: **502** `File storage is temporarily unavailable. Please try again later.` The file is stored as a private (`authenticated`) Cloudinary asset with a random UUID public id (SEC-005).
  7. The record is created with `embeddingStatus: "pending"`, and an embedding job is pushed to Redis. The job holds only `{ documentId, workspaceId }` (SEC-006).
     - **No extractable text (ARC-001, Wave 4)**, for example a scanned PDF: the document is still stored (201), but with `embeddingStatus: "failed"` and `embeddingError: "No extractable text"`, and no job is queued. pdf-parse page markers such as `-- 1 of 1 --` do not count as text.
     - **The record cannot be saved (SEC-013):** the asset just uploaded to Cloudinary is deleted again and the error is returned, so no orphaned file remains.
- **201:** `{ success, message: "Document uploaded successfully", data: Document }`. `data` **includes `extractedText`** and `hasFile`; it never includes a storage URL or public id.
- **If the Redis push fails, the request still succeeds.** The stored document is set to `failed`, but the response body still shows `"pending"` because it is the in-memory object from before the update.

#### ~~POST `/api/documents`~~ (removed in Wave 4, ARC-001)

The metadata-only route is gone; `POST /api/documents` now returns **404**. It created records without a file or text that stayed `pending` forever. Documents are created only by `POST /api/documents/upload`. Existing records without text are marked `failed` with `No extractable text` by the recovery sweep (see `docs/operations/background-jobs.md`).

#### GET `/api/documents/workspace/:workspaceId`

- **Query:** `limit`?, `cursor`? (§1.4 list paging; cap 500).
- **200:** `{ success, data: Document[], meta: { limit, nextCursor, hasMore } }`. Newest first (`createdAt` desc, `_id` desc). `extractedText` is excluded. Documents that are being deleted are excluded.
- **Errors:** 400 `Invalid workspace ID`, invalid `limit` or `cursor`; 403; 503.

#### GET `/api/documents/:id`

- **200:** `{ success, data: Document }`, including `extractedText`.
- **Errors:** 404 `Document not found`, also returned for a malformed id or a document that is being deleted; 403; 503.

#### GET `/api/documents/:id/file`

The only way to get a document's file (SEC-005). No storage URL is ever returned to a client.

- **Order:** authentication (401) → document lookup (404 for unknown, malformed, deleted or being-deleted documents) → live membership check (403 / 503) → no stored file (404 `This document has no stored file`).
- document-service then fetches the file from Cloudinary itself: a signed URL it builds from the stored public id for private assets, or the stored URL of a legacy public asset, which must be `https://res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/…` (anything else is never fetched). Redirects are refused.
- **200:** the bytes, streamed. Headers: `Content-Type` `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; `Content-Disposition` `inline` (PDF) or `attachment` (DOCX) with a sanitised `filename` and the exact `filename*`; `X-Content-Type-Options: nosniff`; `Cache-Control: private, no-store`.
- **Errors:** **502** `The stored file could not be retrieved.` (storage answered with an error, a location outside the allowlist, or a file over 20 MB); **503** `File storage is temporarily unavailable. Please try again later.` (unreachable or timed out; the whole transfer is limited to 60 s). Messages never contain a URL. If the client disconnects, the upstream download is cancelled.

#### DELETE `/api/documents/:id`

**Workspace owner only** (SEC-010); other members get 403 `Only the workspace owner can delete documents.`

- **Steps:**
  1. Marks the document as deleting.
  2. Removes its vectors through ai-service `DELETE /internal/vectors/...`.
  3. Deletes the Cloudinary asset (with its own delivery type: `authenticated` for new assets, `upload` for legacy ones), unless another record shares it, then deletes the record.
- **200:** `{ success, message: "Document deleted successfully", data: Document }`. This is the document as marked, with `deletedAt` set.
- **Errors:**
  - 404 `Document not found`, also returned when a concurrent delete won.
  - 403.
  - **503** `The document could not be removed from the search index. Please try again later.`: vector cleanup failed, and the delete was rolled back. **Exception (RT-010, Wave 5):** a document whose stored `claimSequence` is `0` was never claimed by the worker, so it has no vectors; it is deleted even when vector cleanup fails (logged as a warning). Legacy records without the field are treated as possibly indexed (503 as before).

#### POST `/api/documents/:id/reindex`

- Resets `embeddingStatus` to `pending`, `embeddingAttempts` to 0 and `embeddingError` to null, then re-queues the job.
- **200:** `{ success, message: "Re-indexing initiated successfully", data: Document }`.
- **Errors:**
  - 404.
  - 403.
  - **409** `The document is currently being indexed. Try again when it finishes.`: a live claim younger than 15 min exists.
  - **503** `Indexing queue is temporarily unavailable. Please try again later.`: the document is marked `failed`.

### 4.4 Boards (`services/task-service/src/routes/board.routes.ts`, mounted at `/api/tasks`)

All task-service routes go through gateway `authenticate`, the general limiter, the shared `authenticate`, and then `requireWorkspaceMembership`. That middleware returns:
- 400 `Invalid workspace ID`;
- **403** `You are not a member of this workspace`;
- 503 if the check cannot complete.

These checks run **before** body validation. A malformed `:id` returns 400 `Invalid resource ID`. The response object is the **Board** shape in §6.

| Route | Body / query | Success | Errors |
|---|---|---|---|
| `POST …/workspaces/:workspaceId/boards` | `name`: non-empty string, ≤ 100 (model) | **201** `{ success, data: Board }` | 400 `Board name is required`; 400 Mongoose validation (> 100 chars) |
| `GET …/workspaces/:workspaceId/boards` | `limit`?, `cursor`? (§1.4, cap 200) | `{ success, data: Board[], meta }`, oldest first | 400 invalid `limit` or `cursor` |
| `GET …/workspaces/:workspaceId/boards/:id` | — | `{ success, data: Board }` | 404 `Board not found` |
| `PATCH …/workspaces/:workspaceId/boards/:id` | `name`?: string | `{ success, data: Board }` | 400 `Board name must be a string`; 404 |
| `DELETE …/workspaces/:workspaceId/boards/:id` (**owner only**) | `?cascade=true` or body `{ "cascade": true }` | `{ success, message: "Board deleted successfully", data: { deletedTaskCount, deletedActivityCount } }` | **403** `Only the workspace owner can delete boards.`; **409** `This board still contains N task(s). Delete or move them first, or repeat the request with "cascade": true…` (when the board has tasks and no cascade was requested); 404 |

### 4.5 Tasks (`services/task-service/src/routes/task.routes.ts`, mounted at `/api/tasks`)

Same middleware chain as boards. The response objects are the **Task** and **TaskActivity** shapes in §6.

**Task fields** (`packages/validation/schemas/task.schema.ts`):

| Field | Create | Update | Rule |
|---|---|---|---|
| `boardId` | required | optional | Must be a board in this workspace, else 400 `Board does not belong to this workspace` |
| `title` | required | optional | Trimmed, 1..200 |
| `description` | optional | optional | ≤ 5000 |
| `status` | optional (`todo`) | optional | `todo` \| `in_progress` \| `done` |
| `priority` | optional (`medium`) | optional | `low` \| `medium` \| `high` |
| `assigneeId` | optional | optional | User id ≤ 100, or `null`; `""` becomes `null`. Must be a workspace member, else 400 `Assignee must be a member of this workspace` |
| `dueDate` | optional | optional | ISO 8601 datetime string, or `null` |
| `parentTaskId` | optional | optional | Task id in this workspace or `null`, else 400 `Parent task does not belong to this workspace`. On update: 400 for self-parent, cycle, or nesting deeper than the supported limit |

| Route | Body / query | Success | Errors (besides the common ones) |
|---|---|---|---|
| `POST …/workspaces/:workspaceId/tasks` | task fields | **201** `{ success, data: Task }` | 400 validation, board, parent or assignee; 403/503 from the assignee lookup |
| `POST …/workspaces/:workspaceId/tasks/bulk` | `tasks`: 1..50 task items; `importKey`?: 8..200 chars matching `^[\w:.,-]+$` | **201** `{ success, data: Task[], replayed: false }`, or **200** `{ …, replayed: true }` when the same `importKey` was already fully imported **with the same tasks** | 400 (`Board "<id>" does not belong…`, `Parent task "<id>" does not belong…`, assignee); **409** `Only part of this import exists…` or `This import is already being processed…`; **409** `This importKey was already used with a different set of tasks. Submit it as a new import.` (RT-004: the replay compares a SHA-256 of the normalised task list; imports stored before Wave 4 have no hash and are still matched by count only) |
| `GET …/workspaces/:workspaceId/tasks` | `?boardId=`; `?parentTaskId=` (`null` returns top-level tasks only); `limit`?, `cursor`? (§1.4, cap 500) | `{ success, data: Task[], meta }`, newest first | 400 malformed id in a filter, invalid `limit` or `cursor` |
| `GET …/workspaces/:workspaceId/tasks/:id` | — | `{ success, data: Task }` | 404 `Task not found` |
| `GET …/workspaces/:workspaceId/tasks/:id/activities` | `limit`?, `cursor`? (§1.4, cap 200) | `{ success, data: TaskActivity[], meta }`, newest first | 404 `Task not found`; 400 invalid `limit` or `cursor` |
| `PATCH …/workspaces/:workspaceId/tasks/:id` | any task field | `{ success, data: Task }`. Records activity entries | 400 as above; 404 |
| `DELETE …/workspaces/:workspaceId/tasks/:id` (**owner only**) | — | `{ success, message: "Task deleted successfully", data: { deletedTaskCount, deletedSubtaskCount, deletedActivityCount } }`. Deletes the whole subtask tree | **403** `Only the workspace owner can delete tasks.`; 404 |

### 4.6 AI (`services/ai-service/src/routes/ai.routes.ts`, mounted at `/api/ai`)

All routes go through gateway `authenticate` and the shared `authenticate`. The rate limits are in §2.

**Common body fields** (`packages/validation/schemas/ai.schema.ts`):
- `workspaceId`: 24-hex string, else `Invalid workspace ID`.
- `query`: trimmed, 1..2000.
- `topK`: integer 1..10, default 5.

| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /api/ai/query` | `workspaceId`, `query`, `topK`?, `sessionId`? (string ≤ 100: **accepted and ignored**) | **200** `text/event-stream` (§5) | Before the stream starts, returned as JSON: 400 validation; 401; **403** `Access denied. You are not a member of this workspace.`; 503 membership; 429 |
| `POST /api/ai/search` | `workspaceId`, `query`, `topK`? | `{ success, data: RetrievedChunk[] }`, where each item is `{ documentId, workspaceId, chunkIndex, text, score, fileType }` from Pinecone metadata | 400; 401; 403 (as above); 503 membership; 429; **502** `Could not search this workspace's documents right now. Please try again.` on a Voyage or Pinecone failure (RT-011, Wave 5; it was a bare 500). The provider error is logged redacted |
| `GET /api/ai/sessions/workspace/:workspaceId` | `limit`?, `cursor`? (query; §1.4 paging rules, default 20, cap 100) | `{ success, data: AISession[], meta: { limit, nextCursor, hasMore } }`. **Private (SEC-023, Wave 5):** only the caller's own sessions in that workspace, newest first (§6); other members' questions, including the owner's, are never returned. A new index `{ workspaceId, userId, createdAt, _id }` is built at the next ai-service start. **Sources of deleted documents are redacted in place (SEC-012):** such a source is returned as `{ documentId: "", chunkIndex, score, deleted: true }` at the same position, so `[Source N]` numbers in the stored answer still line up. If document-service cannot be asked which documents still exist, **every** source is redacted this way (the question and answer stay readable) | 400 `Invalid workspace ID`; 403 (as above); 503 |
| `POST /api/ai/summarize-meeting` | `workspaceId`; `text`: trimmed, 10..50000 chars | `{ success, data: { meeting_date, attendees: string[], summary, decisions: string[], action_items: [{ task, assignee, due }], open_questions: string[], next_meeting } }`. Missing values are returned as `""` or `[]`. The summary is **not stored** | The membership check runs **before** validation: no workspace id returns 400 `Workspace ID is required`, a malformed one returns 400 `Invalid workspace ID`, and a non-member gets **403** `You are not a member of this workspace`. Then 400 validation; **502** `AI service is temporarily unavailable. Please try again.` (provider error, timeout, or empty or unparseable output); 413 only if the JSON body exceeds 320 kB (REQ-082, Wave 5: 50,000 characters of any script, even fully JSON-escaped, fit; it was 100 kB, which rejected 40,000 Tamil characters); 429 |

---

## 5. SSE protocol: `POST /api/ai/query`

Sources: `services/ai-service/src/controllers/query.controller.ts`, `services/ai-service/src/services/rag.service.ts`, `services/ai-service/src/services/grok.service.ts`.

**Request.** `POST` with `Content-Type: application/json`, `Authorization: Bearer <token>` and the body from §4.6. The frontend uses `fetch` and a stream reader, not `EventSource`, because it must send a POST body and the header.

**Pre-stream failures are ordinary JSON responses** with the statuses in §4.6. The stream starts only after validation and the membership check pass.

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

**Frame format.** Every event is written as:

```
event: <name>\n
data: <single-line JSON>\n
\n
```

**Heartbeat.** While the answer is being prepared or streamed, the server also writes an SSE comment frame `: ping\n\n` every `SSE_HEARTBEAT_MS` (default 15 s), so proxies and clients do not close an idle connection. Comment frames carry no event; clients must ignore them (the frontend parser does). The heartbeat stops before the stream ends, so the last frame is always a real event.

There are no `id:` or `retry:` fields, no comments, and no heartbeats.

**Events:**

| Event | Payload | When |
|---|---|---|
| `start` | `{ "query": string }` (trimmed) | First event |
| `sources` | `{ "sources": [{ "documentId": string, "chunkIndex": number, "score": number, "fileType": "pdf"\|"docx" }] }` | Once, after retrieval. Can be `[]`. Answer markers `[Source N]` refer to `sources[N-1]` |
| `token` | `{ "text": string }` | Zero or more times, one per non-empty LLM delta |
| `done` | `{ "sessionId": string \| null, "unverifiedCitations": number[] }` | Success only. `sessionId` is `null` if saving the session to MongoDB failed. `unverifiedCitations` lists `[Source N]` numbers in the answer that have no matching retrieved chunk |
| `error` | `{ "message": string, "partial": boolean }` | On failure. Always the last event. **`done` is never sent after `error`** |

**Sequences:**

- Success: `start → sources → token* → done`.
- Retrieval fails (Voyage or Pinecone): `start → error`, with `message: "Could not search this workspace's documents right now. Please try again."` and `partial: false`. No LLM call is made.
- LLM fails (open error, timeout of `LLM_REQUEST_TIMEOUT_MS`, idle gap over `LLM_STREAM_IDLE_TIMEOUT_MS`, interruption, or empty output): `start → sources → token* → error`, with `message: "AI service is temporarily unavailable. Please try again."`. `partial` is `true` if tokens were already sent; the text the client received is then incomplete. Nothing is saved.
- Unexpected exception in the handler: an `error` event with the same fixed message and `partial: false`.
- An empty query after trimming sends a single `error` (`Query text cannot be empty`). Schema validation makes this unreachable in practice.

**Stream end.** The server always ends the response after `done` or `error`. If ai-service dies part-way, the gateway ends the client response (`endClientResponseIfUpstreamAborts`, `services/api-gateway/src/app.ts:55-61`). The stream then closes **without** a terminal event, and the client must treat the answer as incomplete.

**Persistence.** On success one `AISession` is stored with `{ workspaceId, userId, query, answer, sources, aiModel }`. `fileType` is not part of the stored source schema.

**Client disconnect (ISS-015, Wave 4).** When the client closes the connection (or presses Stop) before `done`, the controller aborts generation: the abort signal is passed to the LLM request, nothing more is written, and **no session is saved — a partial answer is never persisted.** If the client leaves during retrieval, no LLM call is started. Retrieval itself (Voyage, Pinecone) is not cancelled mid-call. Tested with a stubbed provider (`tests/ai-stream-disconnect.test.ts`), not against a live provider.

**Source labels and untrusted text (SEC-011, ISS-029).** In the prompt each retrieved chunk is wrapped in a `<source-<nonce> id="N" title="<document name>" …>` block with a random per-request nonce. Document text and names are neutralised (`<`/`>` replaced, `[Source` rewritten), so a document cannot close its block, open a new one or forge a `[Source N]` header, and the system prompt marks the blocks as untrusted data. Sources are labelled by document name (capped at 200 characters), never by database id. Chunks below `MIN_RELEVANCE_SCORE` (default 0.2, ISS-028) or embedded with another model than `VOYAGE_MODEL` (ISS-027) are not used.

---

## 6. Response object shapes

These are raw Mongoose documents serialised to JSON, so they include `_id`, `createdAt`, `updatedAt` and `__v`.

| Shape | Fields |
|---|---|
| Workspace | `_id, name, description` (default `""`), `ownerId, inviteCode, members: string[]` |
| Document | `_id, workspaceId, uploadedBy, originalName, fileType` (`pdf`\|`docx`), `fileSize, hasFile` (boolean: a file can be fetched from `GET /api/documents/:id/file`), `extractedText` (omitted in the list route), `embeddingStatus` (`pending`\|`indexing`\|`indexed`\|`failed`), `embeddingAttempts, claimSequence, indexingStartedAt, embeddingError, deletedAt` |
| Board | `_id, workspaceId, name` |
| Task | `_id, workspaceId, boardId, title, description, status, priority, assigneeId, dueDate, parentTaskId, createdBy`; `importKey`, `importIndex` only on bulk-imported tasks |
| TaskActivity | `_id, workspaceId, taskId, userId, action` (`created`, `status_changed`, `assigned`, `unassigned`, `due_date_set`, `due_date_changed`, `due_date_removed`, `priority_changed`, `title_changed`, `description_changed`, `board_changed`, `comment`), `payload` (object) |
| AISession | `_id, workspaceId, userId, query, answer, sources: [{ documentId, chunkIndex, score }], aiModel` |
| User (auth responses) | `id, name, email, avatar` (default `""`). The password is never returned |

---

## 7. Internal service-to-service routes

These routes are mounted at `/internal` on each service. They are **not proxied by the gateway**, because no `pathFilter` matches `/internal`.

**Authentication.** Callers send the header `X-Internal-Token: <INTERNAL_SERVICE_TOKEN>`. The token is compared using SHA-256 and `timingSafeEqual`. Every rejection is **401** `Unauthorized`. A user's JWT is not accepted.

**Exposure.** Services listen on their own ports. Since Wave 4 (SEC-004) the internal services bind to `127.0.0.1` by default (`HOST`), so they are not reachable from other machines unless `HOST=0.0.0.0` is set; the token remains the protection for anyone who can reach those ports.

| Method | Path (service) | Middleware | Called by | Body | Success | Errors |
|---|---|---|---|---|---|---|
| POST | `/internal/users/bulk` (auth-service :5001) | shared `requireInternalServiceToken`; rejects when the token is unusable per §1 of `environment-variables.md` | workspace-service (member list) | `{ userIds: string[] }` | `{ success, data: [{ userId, name, email, avatar }] }` | 400 `userIds must be an array of strings`; 400 `Invalid resource ID` (an id that is not an ObjectId) |
| PATCH | `/internal/documents/:id/embedding-status` (document-service :5003) | document-service's own copy; rejects only a **missing** token (a weak token already prevents startup) | ai-service worker | `{ status: "pending"\|"indexing"\|"indexed"\|"failed", error?: string, claimToken?: integer }`. `error` is stored, trimmed to 500 chars, when the status is `failed` | `{ success, data: { documentId, embeddingStatus } }` | 400 `Invalid embedding status`; 404 `Document not found`; **410** `Document has been deleted`; **409** `Embedding claim is no longer current` (`claimToken` given but stale) |
| POST | `/internal/documents/:id/embedding/claim` (document-service :5003) | as above | ai-service worker | — | `{ success, data: { documentId, workspaceId, embeddingAttempts, claimToken } }` | `{ success: false, message: "Document not claimable: <reason>", reason }`: 404 `not-found`, 410 `deleted`, 409 `already-indexed` \| `in-progress` \| `retry-limit` (maximum 3 attempts) |
| GET | `/internal/documents/:id/embedding-source?workspaceId=&claimToken=` (document-service :5003) | shared `requireInternalServiceToken` | ai-service worker (SEC-006: jobs are pointers; the text is fetched here) | — | `{ success, data: { documentId, workspaceId, uploadedBy, fileType, extractedText } }`, `Cache-Control: no-store`. Only for the **current** claim | 400 malformed parameters; 404 `not-found`; 410 `deleted`; **403** `workspace-mismatch` (the job names another workspace); **409** `claim-not-current` |
| POST | `/internal/documents/live` (document-service :5003) | shared `requireInternalServiceToken` | ai-service retrieval (query and search), once per request | `{ workspaceId, documentIds: string[] (≤ 200) }` | `{ success, data: { liveDocumentIds, liveDocuments } }`: `liveDocumentIds` are the ids that exist, are not deleted and belong to `workspaceId` (one batched query; unchanged). `liveDocuments: [{ id, name }]` was **added** in Wave 4 (ISS-029) with each document's original file name, used to label sources in the prompt. ai-service accepts responses with or without `liveDocuments`, so the two services can be deployed in either order. `Cache-Control: no-store`. Retrieval drops every other match; the session history uses the same route to redact sources of deleted documents | 400 malformed body |
| POST | `/internal/workspaces/:workspaceId/members/:userId/unassign` (task-service :5004) | shared `requireInternalServiceToken` | workspace-service, after a member removal | — | `{ success, data: { unassigned: number } }`: that user's tasks in the workspace get `assigneeId: null` | 400 malformed ids |
| DELETE | `/internal/vectors/workspaces/:workspaceId/documents/:documentId` (ai-service :5006) | shared `requireInternalServiceToken` | document-service (delete, recovery sweep) | — | `{ success, data: { workspaceId, documentId, vectorsDeleted: true } }`. Idempotent | 400 `Invalid workspace or document id`; 500 on a Pinecone failure |

The document-service middleware is `services/document-service/src/middlewares/internal-auth.middleware.ts`. The shared one is `packages/shared/auth/internal-auth.middleware.ts`.

---

## 8. Health endpoints and Swagger UI

Health endpoints are not under `/api`. The gateway's `/health` reports only on the gateway itself.

| Service | Path | Checks | Response |
|---|---|---|---|
| api-gateway :5000 | `GET /health` | rate-limit Redis connection state (no command is sent) | Always 200 (ISS-044, additive): `{ success: true, service: "api-gateway", status: "healthy"\|"degraded", dependencies: { rateLimitStore: "up"\|"down" } }`. `degraded` means rate limiting currently fails open; requests are still served. Upstream services are not checked |
| auth-service :5001 | `GET /health` | MongoDB | 200 or 503 `{ success, service, status: "healthy"\|"unhealthy", uptime, dependencies: { mongo: "up"\|"down" } }` |
| workspace-service :5002 | `GET /health` | MongoDB | as above |
| document-service :5003 | `GET /health` | MongoDB, Redis | as above, plus `dependencies.redis` |
| task-service :5004 | `GET /health` | MongoDB | as above |
| ai-service :5006 | `GET /health` | MongoDB, Redis | ARC-008 (Wave 5): 503 only when MongoDB is down. Redis down alone: **200** with `status: "degraded"` and `dependencies.redis: "down"` (the HTTP API works; only indexing waits) |
| ai-service :5006 | `GET /health/ready` | MongoDB, Redis | Strict readiness: 503 unless both are up. Use it for monitors that must notice a stalled embedding queue |
| ai-service worker | — | — | The standalone worker has no HTTP endpoint |

Swagger UI (`swagger-ui-express`) can be served at `GET /api-docs` on the **gateway**, **document-service** and **task-service**, but since Wave 5 **only when `API_DOCS_ENABLED=true`** (SEC-016); otherwise `/api-docs` is the JSON 404. ai-service ships `src/swagger.json` but does **not** mount `/api-docs`. auth-service and workspace-service have no Swagger file.

---

## 9. Swagger files vs. code

These files exist: `services/api-gateway/src/swagger.json`, `services/document-service/src/swagger.json`, `services/task-service/src/swagger.json` and `services/ai-service/src/swagger.json`. None were changed. **They do not match the code.** The main mismatches:

1. **Missing routes:**
   - Gateway file: `GET /api/workspaces/{workspaceId}`, `GET /api/workspaces/{workspaceId}/members`, `DELETE /api/documents/{id}`, `POST /api/documents/{id}/reindex`, `GET /api/ai/sessions/workspace/{workspaceId}`.
   - document-service file: `DELETE /api/documents/{id}` and `POST /api/documents/{id}/reindex`.
   - ai-service file: the sessions route.
   - No file describes the `/internal/*` routes.
2. **`POST /api/auth/logout`** has no `security` entry in the gateway file. The code requires a bearer token.
3. **`CreateDocumentDto`** belonged to `POST /api/documents`, which was removed in Wave 4 (ARC-001); the route was also removed from the gateway and document-service Swagger files.
4. **`BulkCreateTasksDto`** has no `importKey`, and its 200 replay response with `replayed` is not documented.
5. **`POST /api/ai/query`** reuses `SemanticSearchDto`. The SSE example's `done` payload lacks `unverifiedCitations`, and the `error` event payload (`message`, `partial`) is not described.
6. **Error statuses are largely missing:**
   - 403 and 503 for membership-checked document and AI routes.
   - 409 (`register`, `join`, board delete, re-index, bulk import).
   - 413, 415 and 422 for uploads; 502 for upload and meeting summary; 429 everywhere.
   - `summarize-meeting` lists 500 where the code returns 502.
7. **`DocumentResponse`** omits `embeddingAttempts`, `claimSequence`, `indexingStartedAt`, `embeddingError` and `deletedAt`.

---

## 10. Unverified items

- **Client disconnect during SSE.** Verified with a stubbed provider only (ai-service: `tests/ai-stream-disconnect.test.ts`; through the gateway: the ARC-012 guard in `tests/ai-validation-and-stream.test.ts`), not against a live provider.
- **Rate-limit headers on 429.** Exact headers beyond `RateLimit` / `RateLimit-Policy`, such as `Retry-After`. Not checked against the installed `express-rate-limit` version.
- **Mongoose subdocument `_id`.** Whether each element of `AISession.sources` carries its own `_id` (the Mongoose default for array subdocuments). This was not confirmed by running the code.
- **Runtime confirmation.** Every status code above was traced from source. None were confirmed by running the services.
