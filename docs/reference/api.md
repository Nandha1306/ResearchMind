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
| `/api/auth` | `AUTH_SERVICE_URL`, `http://localhost:5001` | **none** | `POST /api/auth/login`, `POST /api/auth/register` only |
| `/api/workspaces` | `WORKSPACE_SERVICE_URL`, `http://localhost:5002` | `authenticate` | general |
| `/api/documents` | `DOCUMENT_SERVICE_URL`, `http://localhost:5003` | `authenticate` | general |
| `/api/tasks` | `TASK_SERVICE_URL`, `http://localhost:5004` | `authenticate` | general |
| `/api/ai` | `AI_SERVICE_URL`, `http://localhost:5006` | `authenticate` | AI-specific, then general |

- **Paths are forwarded unchanged.** The proxy is mounted at the root, and each service mounts its router under the same `/api/...` prefix.
- **The gateway parses no bodies.** It streams them through.
- **`/internal/*` is never proxied.** No path filter covers it.
- **The gateway checks the bearer token only.** It does **not** check workspace membership. Every service also verifies the token itself.

### 1.2 Authentication

- **Access token.** Send `Authorization: Bearer <accessToken>`. Tokens are HS256 JWTs signed with `JWT_ACCESS_SECRET`; the payload is `{ userId }` and the default lifetime is 15 min. Every verifier pins `algorithms: ["HS256"]`.
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
- There are no machine-readable error codes. `ResearchMind_readme.md` §13 describes a `{ error: { code } }` envelope as a design only.

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
| 409 | Business conflicts (route-specific). Mongo duplicate key `11000` | `A resource with the same unique value already exists` |
| 410 | Internal routes only (document deleted) | — |
| 413 | JSON body > 100 kB (Express `express.json()` default) | `Request body is too large` |
| 413 | Upload > 10 MB | `File is too large` |
| 415 / 422 | Upload type or content problems (§4.3) | — |
| 429 | Gateway rate limit (§2) | limiter message |
| 500 | Anything unclassified | `Internal Server Error` |
| 502 | LLM failure on non-streaming AI routes; Cloudinary failure on upload | `AI service is temporarily unavailable. Please try again.` / `File storage is temporarily unavailable. Please try again later.` |
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

- **Unlimited routes.** `/api/auth/refresh`, `/api/auth/me` and `/api/auth/logout` have **no** rate limit.
- **Rejected tokens are not counted.** The user-keyed limiters run after gateway `authenticate`, so requests it rejects never reach them.
- **IP keys.** These use Express `req.ip`, and the gateway sets no `trust proxy`.

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
| POST | `/api/documents/upload` | Bearer | yes | yes | 4.3 |
| POST | `/api/documents` | Bearer | yes | no | 4.3 |
| GET | `/api/documents/workspace/:workspaceId` | Bearer | yes | yes | 4.3 |
| GET | `/api/documents/:id` | Bearer | yes | no | 4.3 |
| DELETE | `/api/documents/:id` | Bearer | yes | yes | 4.3 |
| POST | `/api/documents/:id/reindex` | Bearer | yes | yes | 4.3 |
| POST | `/api/tasks/workspaces/:workspaceId/boards` | Bearer | yes | yes | 4.4 |
| GET | `/api/tasks/workspaces/:workspaceId/boards` | Bearer | yes | yes | 4.4 |
| GET | `/api/tasks/workspaces/:workspaceId/boards/:id` | Bearer | yes | no | 4.4 |
| PATCH | `/api/tasks/workspaces/:workspaceId/boards/:id` | Bearer | yes | no | 4.4 |
| DELETE | `/api/tasks/workspaces/:workspaceId/boards/:id` | Bearer | yes | no | 4.4 |
| POST | `/api/tasks/workspaces/:workspaceId/tasks` | Bearer | yes | yes | 4.5 |
| POST | `/api/tasks/workspaces/:workspaceId/tasks/bulk` | Bearer | yes | yes | 4.5 |
| GET | `/api/tasks/workspaces/:workspaceId/tasks` | Bearer | yes | yes | 4.5 |
| GET | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Bearer | yes | yes | 4.5 |
| GET | `/api/tasks/workspaces/:workspaceId/tasks/:id/activities` | Bearer | yes | yes | 4.5 |
| PATCH | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Bearer | yes | yes | 4.5 |
| DELETE | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Bearer | yes | yes | 4.5 |
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
| `GET /api/workspaces/:workspaceId/membership` | `workspaceId` (ObjectId) | `{ success, data: { isMember: boolean } }`. A non-member gets **200 with `false`**, not 403 | 400 `Invalid resource ID` (malformed id) |
| `GET /api/workspaces/:workspaceId` | `workspaceId` | `{ success, data: Workspace }` | 404 `Workspace not found or access denied` (missing or not a member); 400 malformed id |
| `GET /api/workspaces/:workspaceId/members` | `workspaceId` | `{ success, data: [{ userId, name, email, avatar? }] }`. Profiles come from auth-service `/internal/users/bulk`. If that call fails or `INTERNAL_SERVICE_TOKEN` is unset, `name` is `"Researcher"` and `email` is `""` | 404 / 400 as above |

`inviteCode` is returned to every member in every Workspace response.

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
  6. Cloudinary upload fails: **502** `File storage is temporarily unavailable. Please try again later.`
  7. The record is created with `embeddingStatus: "pending"`, and an embedding job is pushed to Redis.
- **201:** `{ success, message: "Document uploaded successfully", data: Document }`. `data` **includes `extractedText`**.
- **If the Redis push fails, the request still succeeds.** The stored document is set to `failed`, but the response body still shows `"pending"` because it is the in-memory object from before the update.

#### POST `/api/documents` (metadata-only record)

- **Body** (`createDocumentSchema`):
  - `workspaceId`: string ≥ 1.
  - `originalName`: trimmed, 1..255.
  - `fileType`: `"pdf"` or `"docx"`.
  - `fileSize`: positive number.
  - Server-owned fields (`uploadedBy`, `cloudinaryUrl`, `cloudinaryPublicId`, `extractedText`, status fields) are stripped.
- **201:** `{ success, data: Document }`, with `cloudinaryUrl: null`, `extractedText: ""` and `embeddingStatus: "pending"`. **No embedding job is queued.**
- **Errors:** 400 validation or malformed workspace id; 403; 503.

#### GET `/api/documents/workspace/:workspaceId`

- **200:** `{ success, data: Document[] }`. Newest first. `extractedText` is excluded. Documents that are being deleted are excluded.
- **Errors:** 400 `Invalid workspace ID`; 403; 503.

#### GET `/api/documents/:id`

- **200:** `{ success, data: Document }`, including `extractedText`.
- **Errors:** 404 `Document not found`, also returned for a malformed id or a document that is being deleted; 403; 503.

#### DELETE `/api/documents/:id`

- **Steps:**
  1. Marks the document as deleting.
  2. Removes its vectors through ai-service `DELETE /internal/vectors/...`.
  3. Deletes the Cloudinary asset, unless another record shares it, then deletes the record.
- **200:** `{ success, message: "Document deleted successfully", data: Document }`. This is the document as marked, with `deletedAt` set.
- **Errors:**
  - 404 `Document not found`, also returned when a concurrent delete won.
  - 403.
  - **503** `The document could not be removed from the search index. Please try again later.`: vector cleanup failed, and the delete was rolled back.

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
| `GET …/workspaces/:workspaceId/boards` | — | `{ success, data: Board[] }`, oldest first | — |
| `GET …/workspaces/:workspaceId/boards/:id` | — | `{ success, data: Board }` | 404 `Board not found` |
| `PATCH …/workspaces/:workspaceId/boards/:id` | `name`?: string | `{ success, data: Board }` | 400 `Board name must be a string`; 404 |
| `DELETE …/workspaces/:workspaceId/boards/:id` | `?cascade=true` or body `{ "cascade": true }` | `{ success, message: "Board deleted successfully", data: { deletedTaskCount, deletedActivityCount } }` | **409** `This board still contains N task(s). Delete or move them first, or repeat the request with "cascade": true…` (when the board has tasks and no cascade was requested); 404 |

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
| `POST …/workspaces/:workspaceId/tasks/bulk` | `tasks`: 1..50 task items; `importKey`?: 8..200 chars matching `^[\w:.,-]+$` | **201** `{ success, data: Task[], replayed: false }`, or **200** `{ …, replayed: true }` when the same `importKey` was already fully imported | 400 (`Board "<id>" does not belong…`, `Parent task "<id>" does not belong…`, assignee); **409** `Only part of this import exists…` or `This import is already being processed…` |
| `GET …/workspaces/:workspaceId/tasks` | `?boardId=`; `?parentTaskId=` (`null` returns top-level tasks only) | `{ success, data: Task[] }`, newest first | 400 malformed id in a filter |
| `GET …/workspaces/:workspaceId/tasks/:id` | — | `{ success, data: Task }` | 404 `Task not found` |
| `GET …/workspaces/:workspaceId/tasks/:id/activities` | — | `{ success, data: TaskActivity[] }`, newest first | 404 `Task not found` |
| `PATCH …/workspaces/:workspaceId/tasks/:id` | any task field | `{ success, data: Task }`. Records activity entries | 400 as above; 404 |
| `DELETE …/workspaces/:workspaceId/tasks/:id` | — | `{ success, message: "Task deleted successfully", data: { deletedTaskCount, deletedSubtaskCount, deletedActivityCount } }`. Deletes the whole subtask tree | 404 |

### 4.6 AI (`services/ai-service/src/routes/ai.routes.ts`, mounted at `/api/ai`)

All routes go through gateway `authenticate` and the shared `authenticate`. The rate limits are in §2.

**Common body fields** (`packages/validation/schemas/ai.schema.ts`):
- `workspaceId`: 24-hex string, else `Invalid workspace ID`.
- `query`: trimmed, 1..2000.
- `topK`: integer 1..10, default 5.

| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /api/ai/query` | `workspaceId`, `query`, `topK`?, `sessionId`? (string ≤ 100: **accepted and ignored**) | **200** `text/event-stream` (§5) | Before the stream starts, returned as JSON: 400 validation; 401; **403** `Access denied. You are not a member of this workspace.`; 503 membership; 429 |
| `POST /api/ai/search` | `workspaceId`, `query`, `topK`? | `{ success, data: RetrievedChunk[] }`, where each item is `{ documentId, workspaceId, chunkIndex, text, score, fileType }` from Pinecone metadata | 400; 401; 403 (as above); 503 membership; 429; **500** `Internal Server Error` on a Voyage or Pinecone failure |
| `GET /api/ai/sessions/workspace/:workspaceId` | — | `{ success, data: AISession[] }`: the latest 20 sessions, newest first (§6) | 400 `Invalid workspace ID`; 403 (as above); 503 |
| `POST /api/ai/summarize-meeting` | `workspaceId`; `text`: trimmed, 10..50000 chars | `{ success, data: { meeting_date, attendees: string[], summary, decisions: string[], action_items: [{ task, assignee, due }], open_questions: string[], next_meeting } }`. Missing values are returned as `""` or `[]`. The summary is **not stored** | The membership check runs **before** validation: no workspace id returns 400 `Workspace ID is required`, a malformed one returns 400 `Invalid workspace ID`, and a non-member gets **403** `You are not a member of this workspace`. Then 400 validation; **502** `AI service is temporarily unavailable. Please try again.` (provider error, timeout, or empty or unparseable output); 413 if the JSON body exceeds 100 kB (possible with ≤ 50000 multi-byte characters); 429 |

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

**Client disconnect.** `query.controller.ts` registers no handler for the client closing the connection, and no abort signal from the request is passed to the LLM call, so generation continues (and the session is saved) after the client disconnects or presses Stop. This is read from the code; it was not exercised against a live provider.

---

## 6. Response object shapes

These are raw Mongoose documents serialised to JSON, so they include `_id`, `createdAt`, `updatedAt` and `__v`.

| Shape | Fields |
|---|---|
| Workspace | `_id, name, description` (default `""`), `ownerId, inviteCode, members: string[]` |
| Document | `_id, workspaceId, uploadedBy, originalName, fileType` (`pdf`\|`docx`), `fileSize, cloudinaryUrl` (string\|null), `cloudinaryPublicId, extractedText` (omitted in the list route), `embeddingStatus` (`pending`\|`indexing`\|`indexed`\|`failed`), `embeddingAttempts, claimSequence, indexingStartedAt, embeddingError, deletedAt` |
| Board | `_id, workspaceId, name` |
| Task | `_id, workspaceId, boardId, title, description, status, priority, assigneeId, dueDate, parentTaskId, createdBy`; `importKey`, `importIndex` only on bulk-imported tasks |
| TaskActivity | `_id, workspaceId, taskId, userId, action` (`created`, `status_changed`, `assigned`, `unassigned`, `due_date_set`, `due_date_changed`, `due_date_removed`, `priority_changed`, `title_changed`, `description_changed`, `board_changed`, `comment`), `payload` (object) |
| AISession | `_id, workspaceId, userId, query, answer, sources: [{ documentId, chunkIndex, score }], aiModel` |
| User (auth responses) | `id, name, email, avatar` (default `""`). The password is never returned |

---

## 7. Internal service-to-service routes

These routes are mounted at `/internal` on each service. They are **not proxied by the gateway**, because no `pathFilter` matches `/internal`.

**Authentication.** Callers send the header `X-Internal-Token: <INTERNAL_SERVICE_TOKEN>`. The token is compared using SHA-256 and `timingSafeEqual`. Every rejection is **401** `Unauthorized`. A user's JWT is not accepted.

**Exposure.** Services listen on their own ports, so the token is the only protection for anyone who can reach those ports directly.

| Method | Path (service) | Middleware | Called by | Body | Success | Errors |
|---|---|---|---|---|---|---|
| POST | `/internal/users/bulk` (auth-service :5001) | shared `requireInternalServiceToken`; rejects when the token is unusable per §1 of `environment-variables.md` | workspace-service (member list) | `{ userIds: string[] }` | `{ success, data: [{ userId, name, email, avatar }] }` | 400 `userIds must be an array of strings`; 400 `Invalid resource ID` (an id that is not an ObjectId) |
| PATCH | `/internal/documents/:id/embedding-status` (document-service :5003) | document-service's own copy; rejects only a **missing** token (a weak token already prevents startup) | ai-service worker | `{ status: "pending"\|"indexing"\|"indexed"\|"failed", error?: string, claimToken?: integer }`. `error` is stored, trimmed to 500 chars, when the status is `failed` | `{ success, data: { documentId, embeddingStatus } }` | 400 `Invalid embedding status`; 404 `Document not found`; **410** `Document has been deleted`; **409** `Embedding claim is no longer current` (`claimToken` given but stale) |
| POST | `/internal/documents/:id/embedding/claim` (document-service :5003) | as above | ai-service worker | — | `{ success, data: { documentId, workspaceId, embeddingAttempts, claimToken } }` | `{ success: false, message: "Document not claimable: <reason>", reason }`: 404 `not-found`, 410 `deleted`, 409 `already-indexed` \| `in-progress` \| `retry-limit` (maximum 3 attempts) |
| DELETE | `/internal/vectors/workspaces/:workspaceId/documents/:documentId` (ai-service :5006) | shared `requireInternalServiceToken` | document-service (delete, recovery sweep) | — | `{ success, data: { workspaceId, documentId, vectorsDeleted: true } }`. Idempotent | 400 `Invalid workspace or document id`; 500 on a Pinecone failure |

The document-service middleware is `services/document-service/src/middlewares/internal-auth.middleware.ts`. The shared one is `packages/shared/auth/internal-auth.middleware.ts`.

---

## 8. Health endpoints and Swagger UI

Health endpoints are not under `/api`. The gateway's `/health` reports only on the gateway itself.

| Service | Path | Checks | Response |
|---|---|---|---|
| api-gateway :5000 | `GET /health` | none (static) | 200 `{ success: true, service: "api-gateway" }`. Redis is not checked |
| auth-service :5001 | `GET /health` | MongoDB | 200 or 503 `{ success, service, status: "healthy"\|"unhealthy", uptime, dependencies: { mongo: "up"\|"down" } }` |
| workspace-service :5002 | `GET /health` | MongoDB | as above |
| document-service :5003 | `GET /health` | MongoDB, Redis | as above, plus `dependencies.redis` |
| task-service :5004 | `GET /health` | MongoDB | as above |
| ai-service :5006 | `GET /health` | MongoDB, Redis | as above, plus `dependencies.redis` |
| ai-service worker | — | — | The standalone worker has no HTTP endpoint |

Swagger UI (`swagger-ui-express`) is served at `GET /api-docs` on the **gateway**, **document-service** and **task-service**. ai-service ships `src/swagger.json` but does **not** mount `/api-docs`. auth-service and workspace-service have no Swagger file.

---

## 9. Swagger files vs. code

These files exist: `services/api-gateway/src/swagger.json`, `services/document-service/src/swagger.json`, `services/task-service/src/swagger.json` and `services/ai-service/src/swagger.json`. None were changed. **They do not match the code.** The main mismatches:

1. **Missing routes:**
   - Gateway file: `GET /api/workspaces/{workspaceId}`, `GET /api/workspaces/{workspaceId}/members`, `DELETE /api/documents/{id}`, `POST /api/documents/{id}/reindex`, `GET /api/ai/sessions/workspace/{workspaceId}`.
   - document-service file: `DELETE /api/documents/{id}` and `POST /api/documents/{id}/reindex`.
   - ai-service file: the sessions route.
   - No file describes the `/internal/*` routes.
2. **`POST /api/auth/logout`** has no `security` entry in the gateway file. The code requires a bearer token.
3. **`CreateDocumentDto`** lists `uploadedBy` as required and accepts `cloudinaryUrl`, `cloudinaryPublicId` and `extractedText`. The code strips all four (they are server-owned) and does not accept `uploadedBy`.
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

- **CORS through the gateway.** The effect of document/task `CORS_ORIGIN` on browser requests that go through the gateway, which applies `cors()` with no options first.
- **Client disconnect during SSE.** Generation continuing after a disconnect (§5) is read from the code, not exercised against a live provider.
- **Rate-limit headers on 429.** Exact headers beyond `RateLimit` / `RateLimit-Policy`, such as `Retry-After`. Not checked against the installed `express-rate-limit` version.
- **Mongoose subdocument `_id`.** Whether each element of `AISession.sources` carries its own `_id` (the Mongoose default for array subdocuments). This was not confirmed by running the code.
- **Runtime confirmation.** Every status code above was traced from source. None were confirmed by running the services.
