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
| Password hashing (bcrypt, cost 10; kept deliberately, see §2) | Implemented | `services/auth-service/src/utils/hash.ts` |
| Access tokens: HS256, algorithm pinned on verify, `userId` must be a 24-hex id | Implemented (one shared verifier since Wave 5, SEC-019/ISS-047) | `packages/shared/auth/access-token.ts`, used by the gateway and each service |
| Refresh-token rotation with atomic claim and reuse detection | Implemented | `services/auth-service/src/services/auth.service.ts` |
| Logout revokes the presented refresh token | Implemented | auth-service |
| Revoking access tokens before they expire | **Not implemented** | — |
| Workspace membership check on every workspace-scoped request | Implemented | document-, task-, ai-service (not the gateway) |
| Roles and permissions inside a workspace | **Not implemented** | — |
| Server-owned document fields | Implemented | document-service upload controller and service (the client sends only the file and `workspaceId`; the unused `createDocumentSchema` was deleted in Wave 5, ARC-009) |
| Upload validation (extension, magic bytes, size, parseability) | Implemented | document-service |
| Workspace isolation in the vector store | Implemented (code only; Pinecone not tested live) | ai-service |
| Internal service authentication (shared token) | Implemented | `/internal` routers |
| Startup check on secrets | Implemented | `packages/shared/config/secrets.ts` |
| Rate limiting | Partial (gateway limits fail open, fast, while Redis is down; services can be called directly, skipping it). Since Wave 5 refresh, `/me` and logout share a 60/min per-IP limit (SEC-021). Non-canonical paths are rejected first, so no path variant skips a limiter. Per-account sign-in throttle in auth-service. Behind a reverse proxy `TRUST_PROXY` is required (§7) | api-gateway, auth-service |
| CORS restricted to known origins | Implemented (Wave 5, SEC-015): gateway allow-list from `CORS_ORIGIN`; loopback-only default when unset; internal services send no CORS headers | `services/api-gateway/src/app.ts`, `packages/shared/http/cors-origins.ts` |
| Swagger UI off by default | Implemented (Wave 5, SEC-016): `API_DOCS_ENABLED=true` turns it on | gateway, document-, task-service `app.ts` |
| Provider error details kept out of logs and responses | Implemented (Wave 5, RT-007): redacted log lines; fixed failure reasons | `packages/shared/errors/safe-error.ts` |
| Content Security Policy | Implemented (Wave 4, SEC-008): helmet's default CSP on gateway responses; a build-time `<meta>` CSP in the production SPA and the same policy as a header in `vite preview` | `services/api-gateway/src/app.ts`, `frontend/csp.ts`, `frontend/vite.config.ts` |
| Tokens kept out of JavaScript-readable storage | **Not implemented** (tokens are in `localStorage`; accepted exception S10). Mitigated by the CSP and the 5-minute access-token lifetime | — |
| Internal services not exposed on the network | Implemented (Wave 4, SEC-004): auth, workspace, document, task and ai listen on `127.0.0.1` unless `HOST` is set | `packages/shared/lifecycle/listen.ts` |
| AI answers rendered without raw HTML, images or script links | Implemented (Wave 4, ARC-002) | `frontend/src/components/ui/markdown-options.ts` |
| Document text isolated from prompt instructions | Implemented (Wave 4, SEC-011): nonce-tagged source blocks, neutralised text, system-prompt rule | `services/ai-service/src/services/context.service.ts`, `src/prompts/rag.prompt.ts` |

---

## 2. Authentication

### Registration and login

- `POST /api/auth/register` and `POST /api/auth/login` are proxied without a JWT check. Their bodies are validated with Zod (`packages/validation/schemas/auth.schema.ts`).
- Password rules: at least 8 characters, containing at least one letter and one digit. There is no upper length limit and no check against breached-password lists.
- Emails are stored in lower case (`User` model, `lowercase: true`). Passwords are hashed with bcrypt at cost 10. **Why cost 10 (ISS-050, accepted):** `bcryptjs` is pure JavaScript and runs on the service's own thread (in chunks), and each step up doubles the CPU time of every sign-in, every registration and the dummy check for unknown e-mails (timing not measured for this document). Cost 10 is the library default and within common guidance for bcrypt. bcrypt uses only the first 72 bytes of a password: registration allows 128 characters (W6-SEC-04), but bytes beyond 72 do not count (accepted residual W6-R5-06); the per-account throttle (SEC-025) and the gateway limits bound online guessing. To raise it, change the `SALT_ROUNDS` constant in `hash.ts` **and** regenerate the dummy hash with the same cost (the login-timing test checks they match); existing hashes keep working.
- The client registration form applies the same name and password rules as the server since Wave 5 (ISS-039), so a weak password is refused before the request.
- A failed login always answers `401 "Invalid credentials"`, whether or not the email exists. Registration with an existing email answers `409 "User already exists"`, so registration can be used to test whether an email has an account.
- Both calls return `{ user, accessToken, refreshToken }` in the JSON body. No cookies are used.

### Access tokens

- Signed with HS256 using `JWT_ACCESS_SECRET` (`services/auth-service/src/utils/jwt.ts`). The payload is `{ userId }` plus `iat`/`exp`. There is no `aud` or `iss` claim (accepted residual, SEC-019: the access and refresh secrets must differ, and auth-service refuses to start when they are equal, so one token type cannot be replayed as the other).
- **Payload check (SEC-019, Wave 5).** Every verifier uses `verifyAccessToken` in `packages/shared/auth/access-token.ts`: HS256 only, and `userId` must be a 24-character hex string. Before Wave 5 a correctly signed token with an object `userId` reached MongoDB queries as an operator (for example `{ "$ne": "" }` matched another user's membership). Tokens are only signed by auth-service, so this needed the signing secret, but the services no longer trust the payload shape. The refresh path applies the same check.
- Lifetime is `ACCESS_TOKEN_EXPIRES`, default `5m` since Wave 4 (SEC-007; it was `15m`). The short lifetime bounds how long a stolen or logged-out access token stays usable, since access tokens cannot be revoked. **User action:** a `services/auth-service/.env` that still sets `ACCESS_TOKEN_EXPIRES=15m` keeps the old lifetime; remove the line or set `5m`.
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

Workspaces are the only authorization boundary. Membership means appearing in `Workspace.members`. There is one role distinction (SEC-010): the **owner** (`Workspace.ownerId`).

- **Owner-only actions.** Deleting documents, boards and tasks, and removing members. Other members get `403` (`Only the workspace owner can delete documents.` / `…boards.` / `…tasks.` / `Only the workspace owner can remove members`); the uploader or creator has no special right. The membership endpoint returns `{ isMember, isOwner }`; the shared `assertWorkspaceOwner()` treats a missing `isOwner` as "not owner" (fails closed).
- **Member removal.** `DELETE /api/workspaces/:id/members/:userId`, owner only; the owner cannot be removed (400, including themself). Every service checks membership live through workspace-service on each request (no cache), so a removed member gets `403`/`404` on their very next request with the same, still-valid token: workspace, documents, files, tasks, boards and AI. An answer stream already in progress finishes. Their tasks in that workspace are unassigned (task-service internal route, best effort and logged). Their AI history and uploaded documents stay in the workspace.
- **No rejoin.** The removal is one atomic update that also **rotates the invite code** (every member could see the old one) and records the user in `removedMembers` (never returned by the API). Joining with any code then answers `403 You were removed from this workspace…` for that user, until the owner lifts the block with `POST /api/workspaces/:id/members/:userId/readmit`; the user can then join with the **current** code, which the owner shares. Other members are unaffected and see the new code.
- **Residuals.** No admin delegation, no ownership transfer, no leave route and no manual invite-code rotation (product scope, S7).

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
| DOCX is not a valid Word zip (no End-of-Central-Directory, damaged directory, ZIP64/multi-disk, encryption, unsupported compression, duplicate names, missing `[Content_Types].xml` or `word/document.xml`) | `422` |
| DOCX whose zip layout is not canonical, so another zip reader could see a different archive: an archive comment, data after the End-of-Central-Directory record or a second such record, concatenated or nested archives, unreferenced bytes between entries, or a local header that disagrees with the central directory | `422` |
| DOCX expands too much, checked on the zip directory before parsing (SEC-002): more than 1,000 entries, more than 50 MB uncompressed in total, `word/document.xml` over 20 MB, or an expansion ratio above 100:1 for an entry (or the archive) larger than 1 MB uncompressed | `413` |
| DOCX whose real contents do not match its declared sizes or CRCs (checked in the extraction process before parsing) | `422` |
| DOCX parse exceeds the extraction process's limits (256 MB heap via `--max-old-space-size`, 20 s); a fatal out-of-memory abort ends only that process | `422` |
| More than 2,000,000 characters of extracted text (PDF or DOCX) | `413` |
| More than 2 DOCX extractions running and 8 waiting | `503` |
| Cloudinary upload fails | `502` (details are logged on the server only) |

DOCX text is extracted in a separate child process (`node -e` with a plain CommonJS script, so it works the same under ts-node, tsx and the compiled build; it gets no secrets and no environment beyond `PATH`), off the HTTP event loop; at most 2 run at once, and a slot is freed only after its process has exited. The child rebuilds a fresh archive from the validated entries only and parses that, so the parser never reads bytes the pre-check did not validate. Since Wave 6 (SEC-002-PDF) PDF extraction runs in the same sandbox (`services/document-service/src/utils/extraction-sandbox.ts`): the same minimal child environment (no `JWT_*`, `INTERNAL_SERVICE_TOKEN`, `CLOUDINARY_*`, `MONGO_URI`, `NODE_OPTIONS`), ONE concurrency gate shared with DOCX (2 running, 8 waiting, then `503`), a 512 MB V8 heap limit, a 30 s wall-clock limit with SIGKILL (`422 "The PDF file took too long to process."`), and the text cap applied inside the child (`413`); successful output is unchanged byte for byte and corrupt, empty or password-protected PDFs keep their `422`. **Decoded-stream memory (Wave 6 Stage E, W6-R5-01):** the heap limit does NOT cover ArrayBuffer memory, and pdf.js decodes each stream (whatever the filter chain, encrypted or not) into one growing `Uint8Array`. The child therefore refuses any single typed-array/ArrayBuffer allocation above 128 MiB (`PDF_MAX_DECODED_BUFFER_BYTES`); the same constructor trap keeps a running total of every allocation of at least 1 MiB (`PDF_LARGE_ALLOCATION_BYTES`) and refuses the one that would take it past 512 MiB (`PDF_MAX_TOTAL_LARGE_ALLOCATION_BYTES`, Stage E round 2, W6-R5-09); and a watchdog, sampled every 25 ms, stops the child when ArrayBuffer memory exceeds 384 MiB or RSS exceeds 1,280 MiB. All three end with `422 "The PDF file is too large or too complex to process."`. The two allocation checks are synchronous; the watchdog is not: pdf.js decodes a filter chain (for example `[/FlateDecode /ASCII85Decode …]`) in one synchronous run, so before round 2 a chain whose stages each stayed under 128 MiB could pass the 384 MiB watchdog limit before the next sample (scaled-down reproduction: 44.1 MiB peak against a 24 MiB watchdog limit; with the budget, 20.1 MiB). Measured: the reviewer's 204 KB PDF decoding to 200 MB, a 1 MB PDF decoding to 1 GiB and the same bomb behind `[/ASCIIHexDecode /FlateDecode]` are refused in about 4.5 s with a child peak of about 130 MB ArrayBuffers / 210 MB RSS (before: the 200 MB file was accepted after about 7 s with about 400 MB). Per extraction, memory is therefore bounded by: the 512 MB V8 heap; large (≥ 1 MiB) ArrayBuffer allocations of at most 512 MiB in total over the whole extraction (enforced synchronously, counting freed buffers too, so live large buffers never exceed it); and the sampled 384 MiB ArrayBuffer / 1,280 MiB RSS watchdog for everything else (allocations under 1 MiB). Two extractions run at a time. A legitimate PDF whose streams decode to more than 512 MiB in total (counting pdf.js's buffer doubling) is refused with the same `422`; ordinary documents stay far below that. As defence in depth, run document-service with a container memory limit (for example `mem_limit` / `--memory` of 2 GB) in any deployment. Temporary files go to `uploads/`, relative to the working directory, and are deleted on every path. multer's default (`preservePath: false`) removes directory parts from the client-supplied file name. A text-free PDF (for example a scanned image) is accepted. It fails later during indexing with "Document contains no usable text".

### File delivery (SEC-005)

- **Private storage.** New uploads are Cloudinary `authenticated` assets (no unsigned URL works) with a random UUID public id (not derived from the file name or time) and `overwrite: false`.
- **Streaming only.** The API never returns a storage URL or public id (responses carry `hasFile`). `GET /api/documents/:id/file` checks authentication, live membership and "not deleted", then document-service builds a signed URL **itself** from the stored public id and streams the bytes (`Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, sanitised `Content-Disposition`). The upstream request refuses redirects, has a 60 s limit, is cancelled when the client disconnects and is cut off past 20 MB; storage errors map to 502/503 without the URL.
- **No SSRF.** The only URLs ever fetched are signed URLs built from the stored id and, for legacy records, a stored URL. Both must be a plain delivery URL of one of our documents: `https://res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/(image|raw)/(upload|authenticated|private)/[s--sig--/][v<n>/]researchmind/documents/<id>` (no credentials, port or other host; no remote-fetch delivery such as `/image/fetch/`; no transformation segment, which also excludes `l_fetch:` overlays; no other folder; no encoded separators). Anything else is refused (502) without a request. Residual: a legacy record whose asset lies outside `researchmind/documents` cannot be opened (502) and would need a manual fix.
- **Frontend.** The PDF viewer and DOCX download fetch the file through the axios client (token refresh works; no token in a URL) and use an object URL that is revoked on unmount / after the download. `getSafeExternalUrl()` remains for any other external link.
- **Legacy assets (BLOCKED on the owner).** The documents uploaded before SEC-005 are public `upload` assets: they keep opening through the same endpoint, but **anyone who still has an old public URL can download them** until they are migrated. The reviewed migration script `services/document-service/src/scripts/migrate-cloudinary-private.ts` changes them to `authenticated` (Cloudinary `rename … to_type: "authenticated"`, same public id, CDN invalidation) and updates the records. It is a dry run unless `--apply` is given, prints only document ids, per-document outcomes and counts, and is idempotent per document: if an earlier run made an asset private but could not update its record, a re-run detects the private asset (Admin API lookup) and completes the record ("reconciled"), so no document is left pointing at a dead public URL. Run it yourself from `services/document-service` (it uses that service's `.env`): `npx ts-node src/scripts/migrate-cloudinary-private.ts` (dry run), then `npx ts-node src/scripts/migrate-cloudinary-private.ts --apply`. Residual: CDN caches of old public URLs can take a few minutes to expire; a member can still save a file they were allowed to open.

---

## 4. AI and workspace isolation

- **Vectors.** Every vector is written to the Pinecone namespace named after the document's `workspaceId`, with ids `<documentId>-chunk-<n>`. Queries run against the caller's workspace namespace only, and only after the membership check. Deleting a document's vectors is scoped to the namespace and filtered on `documentId`.
- **Deleted documents are never retrieved (SEC-012, retrieval side).** Every query and search checks its matches against document-service's records in one batched call (`POST /internal/documents/live`) and drops matches whose document is deleted, missing or belongs to another workspace, before anything is returned, put into the LLM prompt or cited. If the check cannot run, retrieval fails closed. This covers vectors that outlive their document (for example a timed-out upsert that lands after the deletion); those orphaned vectors are not removed automatically.
- **Claim check.** The worker uses the namespace from the job only if it matches the `workspaceId` that document-service returns when the document is claimed. A job naming another workspace is refused and the document is marked `failed` (`services/ai-service/src/workers/embedding.worker.ts`).
- **Text source (SEC-006).** Queue jobs are pointers (`{ documentId, workspaceId }`). After claiming, the worker fetches the text, uploader and file type from document-service's internal route (`GET /internal/documents/:id/embedding-source`, shared-secret header compared with `timingSafeEqual`, refused when the secret is unset), which answers only for the current claim of a non-deleted document in the job's workspace. Text in a queue entry (forged, or written by an older producer) is ignored. Residual: anyone with Redis write access can still trigger re-indexing of claimable documents (harmless) or fill the queue (DoS); Redis requires a password and is bound to `127.0.0.1` (SEC-001).
- **Deletion ordering.** Vectors are deleted before the record. If vector deletion fails, the deletion is rolled back and the request answers `503`. If a worker finishes indexing a document that was deleted meanwhile, it gets `404`/`410` and removes the vectors it wrote, retrying up to 3 times (about 1 s and 3 s apart, SEC-012 b). If every attempt fails, it logs a loud error; the orphaned vectors stay in Pinecone but are never retrieved (the live-documents filter above drops them). Removing such orphans is an accepted residual (no automatic sweep).
- **AI session history (SEC-012 a).** `GET /api/ai/sessions/workspace/:id` keeps each stored question and answer, but a source citing a deleted document is returned redacted (`documentId: ""`, `deleted: true`) at the same position. If the liveness check cannot run, every source is redacted (fail closed).
- **Prompt injection (SEC-011, Wave 4).** Each retrieved chunk is enclosed in a `<source-<nonce> …>` block with a random 16-hex nonce per request. Document text and file names are neutralised before they go into the prompt: `<` and `>` become look-alike characters, `[Source` becomes `[source-text`, and the nonce is removed, so a document cannot close its block, open another one or forge a `[Source N]` citation. The system prompt marks the blocks as untrusted data that must never be followed as instructions. Sources are labelled by file name (capped at 200 characters), not by database id (ISS-029). This reduces, but cannot eliminate, the influence of document text on an answer: a model can still be persuaded by content it reads. Answers are rendered with hardened Markdown in the browser (no raw HTML, no images, http(s) links only with `rel="noopener noreferrer nofollow"`, KaTeX without `trust`, ARC-002), so an injected answer cannot load a tracking image or run script.
- **Retrieval quality filters.** Matches below `MIN_RELEVANCE_SCORE` (default 0.2, ISS-028) and vectors embedded with another model than `VOYAGE_MODEL` (ISS-027) are not used as sources.
- **Client disconnect (ISS-015).** When the client leaves an answer stream, generation is aborted and nothing is saved.
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
| api-gateway | `JWT_ACCESS_SECRET` (plus `TRUST_PROXY` / `CORS_ORIGIN` validity since Wave 6) |
| auth-service | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN` (Wave 5; secrets must differ) and, since Wave 6, `ACCESS_TOKEN_EXPIRES` / `REFRESH_TOKEN_EXPIRES` bounds |
| workspace-service | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` (Wave 5) |
| document-service | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` |
| task-service | `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_TOKEN` (Wave 6) |
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

**Canonical paths (SEC-003).** The first gateway middleware (`src/middlewares/path-guard.middleware.ts`) answers `400 {"success":false,"message":"Invalid request path"}` for any path (the part before `?`) that is not in canonical form: repeated slashes, a backslash, `.`/`..` segments, percent-encoded `/`, `\`, control characters or unreserved characters (`%2e`, `%6C`, …), malformed escapes, NUL, and non-origin-form targets (`http://…`, `*`). Before this, `/api/auth//login` skipped the login limiter and `/api/ai\query` skipped `authenticate` and the limiters, while the proxy still delivered them to the real route. One trailing slash is accepted: Express routes it to the same handler at the gateway and in the services, so it counts against the same limit. Proxy prefixes are segment-bounded (`/api/authx` is not forwarded).

**Redis outages (RT-001).** The limiters fail open, and fast: while the limiter's Redis client is not ready, or for 5 s after a Redis error or timeout, requests skip Redis; every limiter command times out after 300 ms (a frozen Redis). One log line per outage. The Lua scripts are reloaded whenever Redis becomes ready, so limits resume within seconds after an outage, including when the gateway started while Redis was down. There is no in-memory fallback store.

**Per-account sign-in throttle (SEC-025, auth-service).** Failed sign-ins are counted per account in MongoDB (`loginthrottles`, keyed by a SHA-256 of the lower-cased e-mail; unknown e-mails are counted the same way, and a sign-in for an unknown e-mail runs one bcrypt check of the same cost against a fixed dummy hash, so neither the response nor its timing reveals whether an account exists; registration still answers `409` for an existing e-mail, SEC-009). After `LOGIN_THROTTLE_MAX_FAILURES` (10) failures within `LOGIN_THROTTLE_WINDOW_MS` (15 min), every sign-in for that account answers `429 "Too many failed sign-in attempts for this account. Please try again later."` for `LOGIN_THROTTLE_LOCK_MS` (15 min), without checking the password. A successful sign-in clears the count. It does not depend on Redis, so it holds while the gateway limiters fail open. Residual: anyone who knows an address can lock that account for 15 minutes; a concurrent burst can exceed the limit by the requests in flight.

Gaps:

- If Redis is unavailable, the gateway limiters **fail open** (the account throttle above still applies to sign-in).
- ~~`/api/auth/refresh`, `/api/auth/me` and `/api/auth/logout` have no limit.~~ Since Wave 5 (SEC-021) every `/api/auth` route shares a per-IP limit of 60 requests per minute (`authApiRateLimiter`). A `429` on refresh does not sign the SPA out; it keeps the session and retries later.
- **Proxies (RT-008).** By default the gateway trusts no proxy, so behind a reverse proxy every client shares the proxy's IP for the IP-keyed limits (login, register and the SEC-021 auth limiter), which then throttle all users together. **`TRUST_PROXY` is required behind a reverse proxy.** Set `TRUST_PROXY` to the number of proxies (`1`..`10`) or their addresses/CIDR ranges so `req.ip` is the real client. `TRUST_PROXY=true` is refused at startup, because it would let any client pick its own rate-limit key with `X-Forwarded-For`; so are CIDR ranges that amount to the same thing (prefix below `/8` for IPv4 or `/32` for IPv6, such as `0.0.0.0/0` and `::/0`, and IPv6 ranges covering the IPv4-mapped block `::ffff:0:0/96`; Wave 4 review L1). The `proxy-addr` advisory that affected this setting is fixed by the Wave 4 lockfile update (2.0.8).
- Calling a service port directly skips all gateway limits. Since Wave 4 the services listen on `127.0.0.1` only by default (SEC-004), so this requires local access unless `HOST=0.0.0.0` is set.

## 8. CORS and HTTP headers

| Service | CORS | Helmet |
|---|---|---|
| api-gateway | Allow-list (Wave 5, SEC-015): `CORS_ORIGIN` (exact origins, comma-separated); unset = any `http://localhost:<port>` / `http://127.0.0.1:<port>` origin (local development; one startup log line). `*` or a malformed entry stops the gateway at startup | Yes, with helmet's default Content-Security-Policy (Wave 4, SEC-008; Swagger UI at `/api-docs`, when `API_DOCS_ENABLED=true`, works under it). Every response also carries `X-Request-ID`. Upstream `X-Powered-By` headers are stripped (SEC-017) |
| auth-, document-, task-, ai-service | **None since Wave 5** (they used to reflect any origin) | Yes |
| workspace-service | None | No helmet; `X-Powered-By` disabled since Wave 5 (SEC-017) |

The browser only talks to the gateway, so the gateway's policy is the one that applies. Tokens travel in an `Authorization` header and no cookies are used, so even the loopback development default exposes no credentials. **Production must set `CORS_ORIGIN`** to the SPA's origin(s).

**Swagger UI (SEC-016, Wave 5).** `/api-docs` is mounted on the gateway, document- and task-service only when `API_DOCS_ENABLED=true`; by default it is a JSON 404. Leave it off in production.

**SPA Content-Security-Policy (SEC-008, Wave 4; ISS-050, Wave 5).** `npm run build` injects a `<meta http-equiv="Content-Security-Policy">` tag (`frontend/csp.ts`); `vite preview` sends the same policy as a header plus `frame-ancestors 'none'`. The dev server has no CSP (its React-refresh preamble is an inline script). Policy: `default-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self' blob: <API origin>; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'`.
- `<API origin>` is the origin of `VITE_API_URL` at build time (default `http://localhost:5000`); a relative URL such as `/api` is same-origin and adds nothing. **A build only talks to the API origin it was built for.**
- `blob:` in `connect-src` is needed by the PDF viewer, which reads the document as an object URL.
- **No third-party script origin since Wave 5 (ISS-050).** The PDF.js worker is bundled into `/assets` from the exact `pdfjs-dist` copy react-pdf uses (5.4.296; a Vite alias resolves it from react-pdf's location, `frontend/pdf-worker.ts`), so `https://unpkg.com` was removed from `script-src` and `worker-src`. The heavy pages and the PDF viewer are lazy-loaded chunks from the same origin (ARC-011), which `'self'` covers.
- `'unsafe-inline'` is allowed for styles only (KaTeX and UI components set inline styles), never for scripts.
- A production static host should send the policy as a response header (with `frame-ancestors 'none'`), since a meta tag cannot carry every directive.
- **User action:** open the production build in a browser once and check the PDF viewer, KaTeX formulas, sign-in and an AI answer stream for CSP errors in the console. There is no automated browser test (ARC-005).

---

## Known limitations and unresolved risks

These are open issues. None of them is mitigated by the current code unless the entry says so.

1. **Tokens in `localStorage`.** Any XSS exposes the access token and the 7-day refresh token. There is no `HttpOnly` cookie (accepted exception S10). Since Wave 4 the production build has a CSP that blocks inline and foreign scripts, which narrows (but does not remove) the XSS risk.
2. **Access tokens cannot be revoked.** Logout and reuse detection remove refresh tokens only. An access token stays valid for up to `ACCESS_TOKEN_EXPIRES` (default 5 min since Wave 4).
3. **Few roles.** Only the owner can delete documents, boards and tasks and remove members (SEC-010). Since Wave 5 each member sees only their own AI history (SEC-023) and only the owner sees other members' e-mail addresses (SEC-018). Members cannot leave on their own.
4. **Invite codes never expire** and are visible to every member. They rotate only when the owner removes a member (SEC-010); there is no rotate button. Legacy-format codes can be rotated in bulk with the user-run hygiene script (SEC-024, `services/workspace-service/src/scripts/legacy-data-hygiene.ts --rotate-legacy-invite-codes`; codes already shared then stop working).
5. ~~**Server keeps generating after the client stops.**~~ Fixed in Wave 4 (ISS-015): a client disconnect aborts the LLM request and nothing is saved. Verified with a stubbed provider only.
6. **Model names are recorded but only partly checked.**
   - `XAI_MODEL` is logged at startup and stored on every `AISession`, but the provider is never asked whether the model exists.
   - Since Wave 4 (ISS-027) retrieval ignores vectors labelled with another `embeddingModel` than `VOYAGE_MODEL`. After changing `VOYAGE_MODEL`, existing documents are therefore not found until they are re-indexed (unlabelled legacy vectors are still used). A Pinecone key rejected at startup (401) now stops the server and worker (RT-006); Voyage, LLM and Cloudinary keys are still only checked per request.
7. **Legacy Cloudinary assets stay public** until the owner runs the migration script (section 3, File delivery). New uploads are private and served only through the authenticated stream endpoint.
8. **Redis** requires a password and holds only pointer jobs (no document text); the gateway rate limiter fails open while it is down.
9. **Shared internal token.** There is one secret for all internal routes, with no per-service identity, and an unfenced status update path remains.
10. **Account enumeration** is possible through `409` on registration. Passwords are not checked against breach lists. There is no lockout beyond the per-IP login limit.
11. ~~**Refresh-token record lifetime is fixed at 7 days.**~~ Fixed in Wave 5 (SEC-019): the stored expiry is taken from the token's own `exp`, so `REFRESH_TOKEN_EXPIRES` applies to the record too.
12. ~~**Malformed timeout settings.**~~ Fixed: `LLM_REQUEST_TIMEOUT_MS` and `LLM_STREAM_IDLE_TIMEOUT_MS` are read with bounds (1 000..600 000 ms) and fall back to their defaults (`services/ai-service/src/config/timeouts.ts`, ARC-013).
13. **Dependency advisories (SEC-022, Wave 4 lockfile update, 2026-11-13).** Before: `npm audit --omit=dev` 30 (2 critical, 14 high, 9 moderate, 5 low); full `npm audit` 43 (4 critical, 15 high, 19 moderate, 5 low). After: `--omit=dev` **4 low** (the katex chain under `rehype-katex`/`remark-math`: only fixable by a major downgrade; accepted residual, the frontend's own katex is 0.18.4); full `npm audit` 20 (0 critical, 2 high, 13 moderate, 5 low), all in development tools (shadcn CLI and its zod copy, eslint/typescript-eslint, nodemon, ts-morph) whose only fixes are downgrades. Re-run `npm audit` for the current state.
14. ~~**Third-party script.**~~ Fixed in Wave 5 (ISS-050): the PDF.js worker is bundled and served from the app's own origin; the CSP names no CDN.
15. **Network exposure.** Since Wave 4 (SEC-004) only the gateway listens on all interfaces; auth, workspace, document, task and ai listen on `127.0.0.1` unless `HOST` is set (set `HOST=0.0.0.0` for container or multi-host use, and protect those ports at the network level). The bundled compose file publishes MongoDB and Redis on `127.0.0.1` only. It has no default credentials: compose refuses to start without them. Redis requires a password, and each service has its own MongoDB user with `readWrite` on its own database only. mongo-express is opt-in (`docker-compose.tools.yml`, also `127.0.0.1` only, required basic auth). Installations created from the earlier compose file (all interfaces, default credentials) must follow [Securing an existing installation](../deployment/docker-process.md#securing-an-existing-installation-host-remediation). Residual: the passwords live in plain `.env` files and are visible via `docker inspect`.
16. **Provider error details (RT-007, Wave 5).** Provider SDK errors (Voyage, Pinecone, Groq/xAI, Cloudinary) are logged through `describeErrorForLog` (`packages/shared/errors/safe-error.ts`), which keeps the error name, status and code and redacts key-like values, bearer/basic credentials, cookies and URL query strings. Stored document failure reasons are fixed texts (`Indexing failed`, `Indexing timed out`, …), and older stored provider texts are masked when read. Residual: the redaction is pattern-based, so an unusual secret format could still appear in a log line. Wave 6: credentials inside connection URIs (`scheme://user:password@host`) are redacted too (A-1), the shared error middleware logs 5xx AppErrors and database outages through the same helper (W5-L3), and so does `logLlmFailure` (W6-SEC-02). Stage E corrections: only real `    at` stack frames are logged (at most 8, 300 characters each), so the continuation lines of a multi-line message cannot bypass redaction (W6-R5-02); JSON-quoted secret keys (`{"apiKey":"…"}`), bare JWTs and the error `name`, `code` and `status` (each capped at 100 characters) are redacted too (W6-R5-05). Stage E round 2: redaction runs in linear time: the input is cut to 4 KB (`MAX_REDACTION_INPUT`, at the last whitespace, so a secret is never cut in half and echoed) and every quantifier in the URI, JWT and query rules is bounded, so a crafted 100 KB message is redacted in under 1 ms instead of 4 to 10 s (W6-R5-08); every kept stack-frame line also goes through the redaction before the 300-character cap, since a message line can look like a frame (`    at … (redis://:pw@host)`) (W6-R5-10).
17. **Wave 6 hardening (2026-11-15).** The gateway removes client-supplied `x-internal-token`, `x-forwarded-for/-host/-proto/-port` and `forwarded` before proxying (W6-SEC-03; it sets none of them itself). Registration bounds: name ≤ 100 (trimmed), e-mail ≤ 254, password ≤ 128 (W6-SEC-04). Token lifetimes are validated at startup: access ≤ 15 min, refresh ≤ 30 days and longer than access (W6-SEC-05). task-service requires `INTERNAL_SERVICE_TOKEN` (W6-SEC-06). An invalid `TRUST_PROXY` / `CORS_ORIGIN` stops the gateway with one clean line; IPv4-compatible IPv6 values that proxy-addr cannot compile are refused (W6-SEC-01). The session-history liveness check is batched to 200 ids per request, still failing closed (W5-L1). The CI token is read-only, checkout credentials are not persisted and actions are pinned to commit SHAs (W6-SEC-07).
18. **Residuals after Wave 6 (accepted or owner actions):**
    - SEC-002-PDF: **fixed** in Wave 6 (sandboxed; see Upload validation). The 512 MB heap limit alone does not bound decoded-stream (ArrayBuffer) memory; since Wave 6 Stage E (W6-R5-01) decoded data is bounded inside the child (128 MiB per decode buffer; since Stage E round 2, W6-R5-09, at most 512 MiB of large (≥ 1 MiB) allocations in total, enforced synchronously; a 25 ms-sampled 384 MiB ArrayBuffers / 1,280 MiB RSS watchdog; then 422). Residuals: a crafted PDF can still cost up to 30 s of one of the two extraction slots; memory per extraction is bounded by the 512 MB heap plus 512 MiB of large buffers, while allocations under 1 MiB are bounded only by the sampled watchdog (it can overshoot between two samples); a legitimate PDF that decodes to more than 512 MiB in total is refused. Use a container memory limit as defence in depth.
    - Password length (W6-R5-06, Info, accepted): bcrypt reads only the first 72 bytes of a password, so registration accepts up to 128 characters but characters beyond 72 bytes do not change the hash (a longer password that shares the first 72 bytes also signs in). Pre-existing behaviour; pre-hashing would need a migration and is out of scope.
    - ARC-010 DEP0060 (`util._extend` from http-proxy inside http-proxy-middleware 3): accepted exception until the http-proxy-middleware 4 upgrade.
    - SEC-022: `npm audit --omit=dev` 4 low (the katex chain), full tree 19 (0 critical, 2 high, 12 moderate, 5 low), all development tools or katex; accepted residual (Wave 6 re-measured: unchanged by the Wave 6 lockfile change).
    - SEC-019: no `iss` / `aud` / `typ` claims (distinct secrets enforced instead). SEC-009: registration `409` reveals existing e-mails. SEC-007: no access-token denylist (5-minute default). SEC-008: tokens in `localStorage` (CSP mitigates). SEC-011: residual model influence through prompt injection.
    - W6-SEC-08 (document-service keeps its own internal-token guard) and W6-SEC-09 (document-service log files in the working directory): informational, unchanged.
    - GitHub Actions: all actions are SHA-pinned (no unpinned residual); the workflow has not run on GitHub yet.
    - Owner actions (host and data): SEC-001 / SEC-014 (the running `researchmind-*` containers still publish MongoDB, Redis and mongo-express on all interfaces without the provisioned per-service users: follow "Securing an existing installation"), SEC-005 legacy Cloudinary assets (run the migration script), and the Wave 6 startup requirements (task `INTERNAL_SERVICE_TOKEN`; `ACCESS_TOKEN_EXPIRES` / `REFRESH_TOKEN_EXPIRES` within bounds).
