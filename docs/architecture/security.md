# Security — ResearchMind

This page describes the security controls that exist in the code, where each one is enforced, and the risks that remain. Each control is marked as one of:

- **Implemented:** present in the code. Many of these controls have automated tests in `tests/` (for example `refresh-rotation.integration.test.ts`, `internal-auth.test.ts`, `workspace-isolation.test.ts`, `upload-and-model-validation.test.ts`), but not every row is covered.
- **Partial:** present but incomplete
- **Not implemented:** absent

Provider-side behaviour (Cloudinary, Voyage AI, Pinecone, Groq/xAI) was **not tested against live accounts**.

Nothing on this page is a guarantee. Unresolved risks are collected in [Known limitations and unresolved risks](#known-limitations-and-unresolved-risks).

See also: [system-architecture.md](system-architecture.md), [documents-and-ai.md](documents-and-ai.md), [../operations/background-jobs.md](../operations/background-jobs.md).

---

## 1. Summary

| Control | Status | Enforced in |
|---|---|---|
| Password hashing (bcrypt, cost 10) | Implemented | `services/auth-service/src/utils/hash.ts` |
| Access tokens: HS256, algorithm pinned on verify | Implemented | gateway, plus each service |
| Refresh-token rotation with atomic claim and reuse detection | Implemented | `services/auth-service/src/services/auth.service.ts` |
| Logout revokes the presented refresh token | Implemented | auth-service |
| Revoking access tokens before they expire | **Not implemented** | — |
| Workspace membership check on every workspace-scoped request | Implemented | document-, task-, ai-service (not the gateway) |
| Roles and permissions inside a workspace | **Not implemented** | — |
| Server-owned document fields | Implemented | `packages/validation/schemas/document.schema.ts`, document controllers |
| Upload validation (extension, magic bytes, size, parseability) | Implemented | document-service |
| Workspace isolation in the vector store | Implemented (code only; Pinecone not tested live) | ai-service |
| Internal service authentication (shared token) | Implemented | `/internal` routers |
| Startup check on secrets | Implemented | `packages/shared/config/secrets.ts` |
| Rate limiting | Partial (fails open; refresh is not limited; services can be called directly, skipping it) | api-gateway |
| CORS restricted to known origins | **Not implemented** at the gateway (any origin allowed) | — |
| Content Security Policy for the SPA | **Not implemented** | — |
| Tokens kept out of JavaScript-readable storage | **Not implemented** (tokens are in `localStorage`) | — |

---

## 2. Authentication

### Registration and login

- `POST /api/auth/register` and `POST /api/auth/login` are proxied without a JWT check. Their bodies are validated with Zod (`packages/validation/schemas/auth.schema.ts`).
- Password rules: at least 8 characters, containing at least one letter and one digit. There is no upper length limit and no check against breached-password lists.
- Emails are stored in lower case (`User` model, `lowercase: true`). Passwords are hashed with bcrypt at cost 10.
- A failed login always answers `401 "Invalid credentials"`, whether or not the email exists. Registration with an existing email answers `409 "User already exists"`, so registration can be used to test whether an email has an account.
- Both calls return `{ user, accessToken, refreshToken }` in the JSON body. No cookies are used.

### Access tokens

- Signed with HS256 using `JWT_ACCESS_SECRET` (`services/auth-service/src/utils/jwt.ts`). The payload is `{ userId }` plus `iat`/`exp`. There is no `aud` or `iss` claim.
- Lifetime is `ACCESS_TOKEN_EXPIRES`, default `15m`.
- **Where tokens are verified.** Every component that verifies an access token pins `algorithms: ["HS256"]`:
  - The gateway verifies them for `/api/workspaces`, `/api/documents`, `/api/tasks` and `/api/ai` (`services/api-gateway/src/middlewares/auth.middleware.ts`).
  - Each service verifies them again: auth-service for `/me` and `/logout`, workspace-service for all routes, and document-, task- and ai-service for all `/api` routes.
- A service never trusts the gateway's result, so a request sent straight to a service port still needs a valid token.
- Access tokens are not stored on the server and are not revoked by logout. A token remains valid until it expires.

### Refresh tokens and rotation

Refresh tokens are signed with `JWT_REFRESH_SECRET` (HS256), which is separate from the access secret. Lifetime is `REFRESH_TOKEN_EXPIRES`, default `7d`. Each token carries a random `jti` (`crypto.randomUUID()`), so two tokens issued in the same second are always different. Only the SHA-256 hash is stored, in the `RefreshToken` collection. That collection has a unique index on `tokenHash` and a TTL index on `expiresAt`.

`POST /api/auth/refresh` with `{ refreshToken }` in the body (`refreshAccessToken`):

1. Verify the token's signature and expiry. If either fails: `401`, and nothing is revoked.
2. **Atomic claim.** The server runs `findOneAndUpdate({ tokenHash, rotatedAt: null }, { rotatedAt: now, expiresAt: now + grace })`. Only one request can claim a given token. This is a single-document update, so it needs no transaction (the deployment uses a standalone MongoDB).
3. If the claim succeeds, a new access token and refresh token are issued and the new token's hash is stored. If storing fails, the claim is released (`rotatedAt` is set back to null) and the error is returned, so the client's current token still works for a retry.
4. If the claim fails, the server looks up the token's record:
   - **Rotated within `REFRESH_REUSE_GRACE_MS`** (default 10 000 ms, capped at 60 000 ms, `0` disables it; unset or invalid values mean the default): the request is treated as a concurrent refresh, for example from a second tab. Answer `401 "Refresh token has already been used"`. **No other sessions are revoked.**
   - **Anything else** (rotated longer ago, revoked by logout, removed by TTL, or never stored): treated as reuse. **All of the user's refresh tokens are deleted** (`deleteMany({ userId })`) and the answer is `401 "Invalid or revoked refresh token"`.

Trade-off: inside the grace window, a replayed token is not treated as theft. If an attacker refreshes first, a victim's refresh within the following 10 s does not revoke the attacker. The window is kept short for this reason.

The MongoDB TTL monitor runs about once a minute, so a rotated record can outlive its grace window by up to that long. This does not weaken the check: step 4 compares `rotatedAt` against the grace window directly.

### Logout

`POST /api/auth/logout` requires a valid access token (`authenticate`) and a body of `{ refreshToken }`; a missing token answers `400`. It deletes only the record that matches **both** the token's hash and the caller's `userId`, so presenting someone else's refresh token revokes nothing. The response is the same whether or not a record was deleted. The access token is not revoked and stays valid until it expires.

### Client session handling

Files: `frontend/src/lib/token-refresh.ts`, `frontend/src/api/auth-interceptors.ts`, `frontend/src/api/axios.ts`, `frontend/src/lib/session.ts`, `frontend/src/store/auth.store.ts`.

- **Storage.** The access token, refresh token, user and `isAuthenticated` are kept in `localStorage` under `researchmind-auth`, through zustand `persist`. Any script running on the SPA's origin can read them. An XSS bug would expose both tokens, and a stolen refresh token can be used for up to 7 days unless reuse detection fires. Nothing on the client reduces this today: there is no `HttpOnly` cookie and no CSP (see [Known limitations](#known-limitations-and-unresolved-risks)). AI answers on the search page are rendered as plain React text. Meeting summaries are rendered with `react-markdown` without `rehype-raw`, so raw HTML in model output is not rendered. This reduces the main XSS exposure, but it is not a guarantee.
- **Single flight.** One coordinator is shared by the axios interceptor, the SSE client and sign-out. Concurrent `401`s wait on the same refresh request. A request that failed with an access token that has since been replaced is retried with the current token, without another refresh.
- **Cross-tab.** Refreshes are serialised across tabs with the Web Locks API (`navigator.locks`, lock name `researchmind-token-refresh`) where the browser supports it. Inside the lock, a tab first takes over a newer token pair that another tab has saved for the same user. A `storage` event listener (`installCrossTabSessionSync`) handles three cases:
  - another tab rotated the tokens: this tab adopts them
  - another tab signed out: this tab ends its session and revokes the refresh token it held
  - a different account signed in: this tab reloads
- **Race fallback.** Without Web Locks, two tabs can send the same refresh token. The loser gets a `401` inside the grace window. It then polls `localStorage` for up to 1.5 s for the winner's tokens before deciding the session is over.
- **Ending the session.** Only a `401`/`403` from `/auth/refresh` ends the session. A network error or `5xx` raises `RefreshUnavailableError` and the user stays signed in. Each sign-in increments a `sessionId`. A refresh that completes after sign-out never writes its tokens back, and the tokens it received are revoked as a best effort.
- **Sign-out** (`signOutClientSession`) works like this:
  1. Wait for any refresh in progress.
  2. Call `/auth/logout` with the current refresh token.
  3. If that answers `401` because the access token has expired, refresh first and then revoke the newly issued refresh token.
  4. Always clear the workspace store, the React Query cache and the auth store, and remove both `localStorage` keys, even if revocation failed.

---

## 3. Authorization

### Workspace authorization

Workspaces are the only authorization boundary. Membership means appearing in `Workspace.members`. There are no roles: `ownerId` is stored but no code reads it.

- **The gateway does not check membership.** It only verifies the JWT.
- document-, task- and ai-service call `checkWorkspaceMembership()` (`packages/shared/auth/workspace-membership.ts`) on every workspace-scoped request. The call goes to `GET {WORKSPACE_SERVICE_URL}/api/workspaces/:id/membership` with the caller's own `Authorization` header and a 3 s timeout. The user id is never taken from the request body. Possible outcomes:

  | Outcome | Status |
  |---|---|
  | Workspace id is not a 24-hex ObjectId (checked before any network call) | `400 Invalid workspace ID` |
  | No bearer token, or workspace-service answers `401` | `401` |
  | Workspace-service answers `isMember: false` (also returned for a workspace that does not exist) | `403` |
  | Timeout, network error, non-2xx answer, or an unexpected body | `503` "Workspace access could not be verified right now" |

- task-service also calls `getWorkspaceMemberIds()` (`GET /api/workspaces/:id`) to check that an assignee is a member. A `404`/`403` from that call becomes `403`.
- For document routes that take a document id (`GET`, `DELETE /:id`, `POST /:id/reindex`), the document is loaded first and membership is checked against the document's **stored** `workspaceId`.
- workspace-service itself filters by `members: userId` for detail and member list. A non-member gets `404 "Workspace not found or access denied"`.

**Inside a workspace, every member can do everything.** Any member can delete or re-index any document (not just ones they uploaded), edit or delete any board or task, read all members' AI Q&A history (the last 20 sessions per workspace), and see the invite code.

### Invite codes

8 characters drawn from a 32-character alphabet with `crypto.randomBytes` (about 40 bits; 256 is a multiple of 32, so there is no modulo bias) (`services/workspace-service/src/utils/invite-code.ts`). Codes are matched after trimming and upper-casing. Joining is a single atomic update. An unknown code answers `404` and an existing member gets `409`. Codes **never expire, cannot be rotated, and are returned to every member** in the workspace list and detail responses. Members cannot be removed and cannot leave.

### Document ownership and server-owned fields

- `uploadedBy` always comes from the verified JWT and never from the request (upload service and `createDocumentHandler`).
- `POST /api/documents` (metadata-only record) accepts only `workspaceId`, `originalName` (1–255 characters), `fileType` (`pdf`/`docx`) and `fileSize`. `validate()` drops unknown keys. The handler builds the record field by field, setting `cloudinaryUrl`/`cloudinaryPublicId` to `null` and `extractedText` to `""`. A client cannot point a record at another tenant's Cloudinary asset or inject text into the index.
- No client request body can set embedding status, attempts, claim sequence or `embeddingError`. Workers change them through the `/internal` routes (claim and status update). One public route also writes them: `POST /api/documents/:id/reindex`, open to any workspace member, resets the document to `pending` with `embeddingAttempts: 0`, `embeddingError: null` and `indexingStartedAt: null` (`reindexDocument` in `services/document-service/src/services/document.service.ts`). It is refused with `409` while a claim under 15 minutes old exists. `claimSequence` is never reset.
- **Cloudinary deletion guard.** Before destroying an asset, document-service checks that no other document record references the same `cloudinaryPublicId`. This protects against older records that copied another tenant's id.

### Upload validation

In `services/document-service/src/middlewares/upload.middleware.ts`, `utils/file-signature.ts`, `utils/pdf-extractor.ts` and `utils/docx-extractor.ts`:

| Check | Result |
|---|---|
| Extension is not `.pdf` or `.docx` (the browser MIME type is ignored) | `415` |
| File larger than 10 MB (`LIMIT_FILE_SIZE`) | `413` |
| Other multer limits (1 file, 10 fields, 64 KB per field, 20 parts) | `400` |
| Empty file | `422` |
| Magic bytes: PDF must contain `%PDF-` in the first 1024 bytes; DOCX must start with `PK\x03\x04` | `415` on mismatch |
| PDF unreadable, encrypted or malformed (`InvalidPDFException`, `PasswordException`, `FormatError`) | `422` |
| DOCX is not a valid Word zip | `422` |
| Cloudinary upload fails | `502` (details are logged on the server only) |

Temporary files go to `uploads/`, relative to the working directory, and are deleted on every path. multer's default (`preservePath: false`) removes directory parts from the client-supplied file name. A text-free PDF (for example a scanned image) is accepted. It fails later during indexing with "Document contains no usable text".

### External URL handling

Opening a stored document URL in the browser always goes through `getSafeExternalUrl()` (`frontend/src/utils/fileUtils.ts`), which accepts only absolute `http:`/`https:` URLs. It is used in `DocumentCard.tsx`, `PdfViewerModal.tsx` and `SemanticSearchPage.tsx`, and it blocks `javascript:` and similar schemes when a URL is opened with `window.open`. Cloudinary URLs are public delivery URLs: **anyone who has the URL can download the file without authenticating.** The code does not use signed or authenticated Cloudinary delivery. Whether a Cloudinary account adds restrictions of its own was not verified.

---

## 4. AI and workspace isolation

- **Vectors.** Every vector is written to the Pinecone namespace named after the document's `workspaceId`, with ids `<documentId>-chunk-<n>`. Queries run against the caller's workspace namespace only, and only after the membership check. Deleting a document's vectors is scoped to the namespace and filtered on `documentId`.
- **Claim check.** The worker uses the namespace from the job only if it matches the `workspaceId` that document-service returns when the document is claimed. A job naming another workspace is refused and the document is marked `failed` (`services/ai-service/src/workers/embedding.worker.ts`).
- **Text source.** The worker embeds the `extractedText` **carried in the Redis job**. It does not re-read the text from document-service. Anyone able to write to Redis could push a job for a real, claimable document of the matching workspace with substitute text. Treat Redis as a trusted component and do not expose it. The bundled `docker-compose.yml` runs Redis with no password and publishes port 6379 on all interfaces.
- **Deletion ordering.** Vectors are deleted before the record. If vector deletion fails, the deletion is rolled back and the request answers `503`. If a worker finishes indexing a document that was deleted meanwhile, it gets `404`/`410` and removes the vectors it wrote. If that cleanup fails as well, it logs a loud error. That is the one path where deleted content could remain searchable.
- **Prompt injection.** Document text is placed in the LLM prompt as context. The system prompt tells the model to use only that context, but text inside a document can still influence the answer. No filtering is done.
- **Error hygiene.** LLM errors reach the client only as the fixed message `"AI service is temporarily unavailable. Please try again."`. Provider messages are logged on the server without request payloads. Queue errors log only the error message, because ioredis errors include the command arguments, which contain the document text.

---

## 5. Internal service authentication

- Every `/internal` route requires the header `X-Internal-Token` to equal `INTERNAL_SERVICE_TOKEN`. Both values are SHA-256-hashed and compared with `crypto.timingSafeEqual`. Every rejection is the same opaque `401`.
  - `packages/shared/auth/internal-auth.middleware.ts`: auth- and ai-service
  - `services/document-service/src/middlewares/internal-auth.middleware.ts`: document-service
- A user's access token is never accepted on `/internal` routes.
- Fail-closed: the shared middleware runs `requireSecret()` on every request and rejects if the configured token is unusable. document-service and ai-service also refuse to start without a valid token. auth-service does not check the token at startup; its internal route just rejects every request until the token is set. workspace-service skips user-name lookups (members are shown as "Researcher") when the token is unset.
- The token is a single shared secret with no per-service identity or scoping. Any holder can call every internal route, including the **unfenced** form of `PATCH /internal/documents/:id/embedding-status` (no `claimToken`), which still overwrites status unconditionally for backward compatibility.

## 6. Secret validation at startup

`assertRequiredSecrets()` and `requireSecret()` (`packages/shared/config/secrets.ts`) reject a value that is:

- missing or empty
- a `<placeholder>`
- one of a list of known weak values, including the literals this repository used to ship as defaults
- shorter than 32 characters

Only variable names are printed and the process exits with code 1. Checked at startup:

| Service | Secrets |
|---|---|
| api-gateway | `JWT_ACCESS_SECRET` |
| auth-service | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` |
| workspace-service | `JWT_ACCESS_SECRET` |
| document-service | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` |
| task-service | `JWT_ACCESS_SECRET` |
| ai-service | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` |
| standalone worker | `INTERNAL_SERVICE_TOKEN` |

The modules that sign or verify tokens also call `requireSecret()` at import time, so importing them without a valid secret throws. Provider keys (Voyage, Pinecone, Groq/xAI) are only checked for presence, at import. Cloudinary credentials are not checked at startup.

## 7. Rate limiting

All limits are defined in `services/api-gateway/src/middlewares/rate-limit.middleware.ts` and stored in Redis:

| Route | Limit | Key |
|---|---|---|
| `POST /api/auth/login` | 5 per 15 min; successful logins are not counted | IP |
| `POST /api/auth/register` | 3 per hour | IP |
| `POST /api/ai/query`, `POST /api/ai/search` (shared counter) | 30 per hour | user id (from the verified JWT), otherwise IP |
| `POST /api/ai/summarize-meeting` | 20 per hour | user id, otherwise IP |
| All other `/api/workspaces`, `/api/documents`, `/api/tasks`, `/api/ai` requests | 100 per minute | user id, otherwise IP |

Gaps:

- If Redis is unavailable, the limiters **fail open**.
- `/api/auth/refresh`, `/api/auth/me` and `/api/auth/logout` have no limit.
- The gateway has no `trust proxy` setting. Behind a reverse proxy, every client therefore shares the proxy's IP for the IP-keyed limits.
- Calling a service port directly skips all limits.
- There is no account lockout.

## 8. CORS and HTTP headers

| Service | CORS | Helmet |
|---|---|---|
| api-gateway | `cors()` with defaults: `Access-Control-Allow-Origin: *` | Yes, with `contentSecurityPolicy: false` |
| auth-service, ai-service | `cors()` defaults (any origin) | Yes |
| document-service, task-service | `CORS_ORIGIN` (comma-separated list) if set, otherwise every origin is reflected | Yes |
| workspace-service | No CORS middleware | No |

The browser only talks to the gateway, so the gateway's policy is the one that applies. Tokens travel in an `Authorization` header and no cookies are used, so a permissive CORS policy does not on its own let another site act as a user. It is still wider than needed. The SPA has no Content Security Policy, and it loads the PDF.js worker from `unpkg.com`.

---

## Known limitations and unresolved risks

These are open issues. None of them is mitigated by the current code unless the entry says so.

1. **Tokens in `localStorage`.** Any XSS exposes the access token and the 7-day refresh token. There is no `HttpOnly` cookie and no CSP.
2. **Access tokens cannot be revoked.** Logout and reuse detection remove refresh tokens only. An access token stays valid for up to `ACCESS_TOKEN_EXPIRES` (default 15 min).
3. **No roles.** Every member can delete any document, board or task and read every member's AI history. Members cannot be removed and cannot leave.
4. **Invite codes never expire**, cannot be rotated, and are visible to every member.
5. **Server keeps generating after the client stops.** When a user presses Stop or closes the tab, generation continues: there is no disconnect handling in the controller (`queryStreamHandler` in `services/ai-service/src/controllers/query.controller.ts` registers no `close` handler). The LLM call runs to completion and the session is still saved, so provider tokens are still spent. This comes from reading the code; it was not exercised against a live provider.
6. **Model names are recorded but not checked.**
   - `XAI_MODEL` is logged at startup and stored on every `AISession`, but the provider is never asked whether the model exists.
   - Each vector stores its `embeddingModel`, but queries do not filter or compare on it. After changing `VOYAGE_MODEL` without re-indexing, old vectors are silently compared with query vectors from a different model. Only the dimension is checked, at startup.
7. **Cloudinary URLs are public** to anyone who has the link.
8. **Redis is trusted but unauthenticated** in the bundled compose file. The worker embeds text taken from the job payload. The rate limiter fails open.
9. **Shared internal token.** There is one secret for all internal routes, with no per-service identity, and an unfenced status update path remains.
10. **Account enumeration** is possible through `409` on registration. Passwords are not checked against breach lists. There is no lockout beyond the per-IP login limit.
11. **Refresh-token record lifetime is fixed at 7 days** (`saveRefreshToken`), whatever `REFRESH_TOKEN_EXPIRES` is set to. If the JWT lifetime is configured longer than 7 days, a still-valid token whose record has expired is treated as reuse and revokes all of the user's sessions.
12. **Malformed timeout settings.** `LLM_REQUEST_TIMEOUT_MS` and `LLM_STREAM_IDLE_TIMEOUT_MS` are passed through `Number()` without validation. A non-numeric value becomes `NaN`. For the idle watchdog this makes the timer fire almost at once, aborting every stream.
13. **Dependency advisories are outstanding.** On 2026-11-11, `npm audit --omit=dev` at the repository root reported 30 advisories (2 critical, 14 high, 9 moderate, 5 low). They have not been triaged in this wave. Re-run `npm audit` for the current state.
14. **Third-party script.** The PDF.js worker is loaded at runtime from `unpkg.com`, with no Subresource Integrity check.
15. **Network exposure.** Services listen on all interfaces. The bundled compose file publishes MongoDB (with default credentials unless overridden), Redis and mongo-express on `0.0.0.0`. Do not run it unmodified on a reachable host.
