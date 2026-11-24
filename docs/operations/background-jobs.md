# Background Jobs — Embedding Worker and Recovery Sweep

ResearchMind has one kind of background job: **embedding a document**. Its text is split into chunks, embedded with Voyage AI, and written to Pinecone. Two background loops cooperate:

| Loop | Runs in | Source |
|---|---|---|
| **Embedding worker.** Takes jobs from Redis and processes them. | ai-service | `services/ai-service/src/workers/embedding.worker.ts` |
| **Recovery sweep.** Re-queues work that was lost or abandoned, and finishes interrupted deletions. | document-service | `recoverEmbeddingWork` in `services/document-service/src/services/document.service.ts`, scheduled in `services/document-service/src/server.ts` |

There are no other schedulers, cron jobs or queues. The notification service is an empty placeholder.

> **Delivery guarantee: at-most-once, made reliable by the sweep.** Jobs sit in a Redis list and are taken with `BLPOP`, which removes the job from Redis as soon as a worker receives it. If the worker dies mid-job, or Redis loses its data, that job is gone. Correctness comes from two things. MongoDB stores each document's status durably. The recovery sweep re-queues documents that stopped making progress. A claim on the document stops duplicate deliveries from doing the same work twice. This is **not** exactly-once processing, and the queue is **not** durable. A document can be processed more than once (vector ids are deterministic, so this is harmless), and recovery takes minutes, not seconds.

See also: [../architecture/documents-and-ai.md](../architecture/documents-and-ai.md) (pipeline and states), [../architecture/system-architecture.md](../architecture/system-architecture.md).

---

## 1. What runs where

| Command | Process | Embedding worker? | HTTP? | MongoDB? |
|---|---|---|---|---|
| Root `npm run dev` or `npm run dev:services` (runs `dev:ai`) | ai-service `ts-node src/server.ts` | **Yes, in-process** | Yes, port 5006 | Yes |
| `services/ai-service`: `npm run dev` / `npm start` (built `dist/.../server.js`) | ai-service HTTP server | **Yes, in-process** | Yes | Yes |
| `services/ai-service`: `npm run dev:worker` / `npm run start:worker` (built `dist/.../worker.js`) | Standalone worker (`src/worker.ts`) | Yes, worker only | **No** (no `/health`) | **No** |
| document-service `npm run dev` / `npm start` | document-service | No. Runs the **recovery sweep** and is the queue **producer**. | Yes, port 5003 | Yes |

- The HTTP service always starts a worker. **No setting turns it off**, so an "HTTP-only" ai-service is not possible.
- A standalone worker running alongside the HTTP service is a second **competing consumer** on the same list. Each `BLPOP` hands a job to exactly one consumer. The atomic claim prevents two consumers from working on the same document at the same time.
- Inside one process, `startEmbeddingWorker()` is idempotent: a second call returns the loop that is already running. Each worker processes **one job at a time**.
- Every running document-service instance runs its own sweep. The instances do not coordinate. Duplicate re-queues are absorbed by the claim.
- `docker-compose.yml` starts only MongoDB and Redis (mongo-express is opt-in through `docker-compose.tools.yml`). Redis requires a password, so the producer and the worker need `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379`. No repository file defines a production process manager or container for the worker.

---

## 2. How jobs are created

All producers call `addEmbeddingJob()`, which runs `RPUSH researchmind:embedding:jobs <json>`. The JSON is a **pointer only**: `{ "documentId": "...", "workspaceId": "..." }` (SEC-006/ARC-007). No document text is written to Redis.

**Text fetch.** After claiming a document, the worker fetches its text, uploader and file type from document-service: `GET /internal/documents/:id/embedding-source?workspaceId=&claimToken=` with `X-Internal-Token` (`INTERNAL_SERVICE_TOKEN`). document-service answers only for the **current** claim of a non-deleted document in the job's workspace (409 stale claim, 410 deleted, 403 workspace mismatch, 404 unknown), with `Cache-Control: no-store`. Nothing a queue entry carries is trusted.

**Older queue entries.** Entries written by an older document-service still carry `extractedText`, `uploadedBy` and `fileType`. The worker accepts them and ignores those fields: the text is always fetched. **Deploy order:** deploy and restart **ai-service first** (it handles both shapes), then document-service. An old worker would drop pointer-only jobs as invalid; the affected documents stay `pending` until the recovery sweep re-queues them (within about 10 minutes). Never flush the real Redis to clean up; old entries drain normally.

| Trigger | Status before push | If the push fails |
|---|---|---|
| Upload (`POST /api/documents/upload`) | `pending` (new record) | Document set to `failed` with **no** `embeddingError`. Upload still answers `201`. |
| Manual re-index (`POST /api/documents/:id/reindex`) | `pending`, `embeddingAttempts: 0`, error cleared. Refused with `409` while a claim under 15 minutes old exists. | Document set to `failed`, "Could not queue the document for indexing". Request answers `503`. |
| Recovery sweep | Unchanged at push time; updated afterwards (section 6) | Counted as an error and logged. Retried on the next sweep. |

`POST /api/documents` (metadata only) was removed in Wave 4 (ARC-001). An upload whose file has no extractable text is stored as `failed` (`No extractable text`) and no job is pushed (see [documents-and-ai.md](../architecture/documents-and-ai.md#21-upload-document-service)).

---

## 3. Worker loop

`runWorkerLoop()`:

1. `BLPOP researchmind:embedding:jobs 5`. The 5 s timeout lets the loop notice a stop request.
2. Discard malformed jobs:
   - Invalid JSON: logged and dropped.
   - `documentId` or `workspaceId` missing or not an ObjectId: logged with the `documentId` only and dropped. Legacy fields (`extractedText`, `uploadedBy`, `fileType`) are ignored.

   Dropped jobs are **not** re-queued by the worker. If they belonged to a real document, the sweep picks that document up later.
3. `processEmbeddingJob(job)`: claim → workspace check → **fetch the text for this claim** → chunk → embed → replace vectors → report. See [documents-and-ai.md §2.4](../architecture/documents-and-ai.md#24-worker-processing-ai-service).
4. Any exception is logged as "Embedding worker error". The loop then waits 1 s and continues; one failed job never stops the worker.

**Watchdog (ISS-037).** Every job has a deadline, `EMBEDDING_JOB_TIMEOUT_MS` (default 10 min, always below the 15 min claim lease). Each provider call is also bounded on its own: Voyage `VOYAGE_DOCUMENT_TIMEOUT_MS` (30 s per batch; the LangChain client retries at most once), Pinecone `PINECONE_TIMEOUT_MS` (20 s per call), the text fetch `DOCUMENT_SOURCE_TIMEOUT_MS` (30 s). A call that never answers is abandoned at its limit or at the job deadline, whichever comes first; no vector is written and no `indexed` is reported after the deadline. The job is reported `failed` (`Embedding timed out after N s`) **with the same claim token**, so if another worker has meanwhile taken the claim over, the report is refused (`409`, outcome `superseded`) and changes nothing. The loop then takes the next job, and the recovery sweep retries the document within its attempt limit. Before this, a hung Voyage request held the only worker for about 36 minutes (6 silent SDK retries × 300 s). Residual: an abandoned call cannot be cancelled, so a timed-out upsert can still land later. For a document that is retried, the next attempt rewrites the same deterministic ids. For a document that was **deleted** in the meantime, nothing rewrites or removes those vectors (a deleted document is never claimed again): they stay in Pinecone as orphans. Retrieval therefore checks every match against document-service's records (one batched `POST /internal/documents/live` per query/search) and drops matches whose document is deleted, missing or in another workspace, so such text is never returned, put into a prompt or cited (SEC-012 retrieval side). Removing the orphaned vectors themselves is not automated.

The worker's Redis client uses `maxRetriesPerRequest: null` and reconnects forever, with backoff `min(attempt × 200 ms, 5 s)`. While Redis is down, the pending `BLPOP` waits.

---

## 4. Claim and fencing

Before doing any work, the worker calls `POST {DOCUMENT_SERVICE_URL}/internal/documents/:id/embedding/claim` with `X-Internal-Token` and a 15 s timeout. Document-service runs a single atomic `findOneAndUpdate` (`claimDocumentForEmbedding`). The document can be claimed when **all** of these hold:

- `deletedAt` is null
- `embeddingAttempts` < 3, or the field is missing (older records)
- the status is `pending` or `failed`, **or** it is `indexing` with `indexingStartedAt` older than 15 minutes or null (an abandoned claim)

A successful claim sets `embeddingStatus: "indexing"`, `indexingStartedAt: now` and `embeddingError: null`, and increments both `embeddingAttempts` and `claimSequence`.

| Claim answer | Meaning | Worker action |
|---|---|---|
| `200` with `claimToken` and `workspaceId` | Claimed | Process the job. Refuse it if the job's `workspaceId` differs from the one returned. |
| `409 reason: in-progress` | Another worker holds a claim that is under 15 minutes old | Skip (duplicate delivery) |
| `409 reason: already-indexed` | Already done | Skip |
| `409 reason: retry-limit` | 3 attempts used. The document is set to `failed`, "Indexing failed after 3 attempts", unless a live claim exists. | Skip |
| `410 reason: deleted` / `404 reason: not-found` | Deleted, or unknown | Skip |
| `404` **without** `reason`, `401`, `5xx`, network error, or `200` without a token | Deployment or availability problem | Throw. The job is lost. The document is recovered by the sweep. |

**Fencing.** The `claimToken` (the document's `claimSequence`) is sent with every status update. `PATCH /internal/documents/:id/embedding-status` applies the update only while the document is still `indexing` with that same `claimSequence` and is not deleted. Otherwise:

| Answer | Meaning |
|---|---|
| `409` | The claim was superseded, for example because it went stale and another worker took over, possibly after a re-index |
| `410` | The document was deleted |
| `404` | The document does not exist |

A worker whose claim expired therefore cannot overwrite the current holder's result. A status update **without** `claimToken` is still accepted unconditionally, for backward compatibility. The worker always sends one.

---

## 5. Retry and failure handling

| Level | Behaviour |
|---|---|
| Voyage rate limit during document embedding | Per batch of 20 chunks: up to 3 attempts, waiting 20 s and then 40 s. Other errors fail the job immediately. |
| Final status report | Up to 3 attempts to report `indexed`, retrying network errors and `5xx` with waits of 1 s and then 2 s (`embedding.worker.ts`, `reportFinalStatus`). If all 3 fail, the job is handled like any other error: up to 3 more attempts, with the same backoff, to report `failed`. A `4xx` is acted on immediately (`404`/`410` = deleted, `409` = superseded). |
| Job failure | The worker reports `failed` with the error message (first 300 characters). If that report also fails, the document stays `indexing` until the claim goes stale. |
| Per document | At most **3 claims** (`MAX_EMBEDDING_ATTEMPTS`). Every claim counts, including one whose worker crashed. The sweep re-queues `failed` documents while attempts remain. Once all 3 are used, the document stays `failed` until someone re-indexes it manually, which resets the count. |
| Permanent errors | Errors such as "Document contains no usable text" are retried like any other until the limit is reached. The code does not distinguish permanent from transient failures. |

There is no dead-letter queue. A document that keeps failing ends in `failed` with its last `embeddingError`. Since Wave 5 (RT-007) that is a fixed text (`Indexing failed`, `Indexing timed out` or `Document contains no usable text`); the provider's own error goes only to the ai-service log, redacted (`Embedding processing failed for document <id>: <ErrorName> status=… code=…: …`). Look there for the cause.

---

## 6. Recovery sweep

`recoverEmbeddingWork()` runs once when document-service starts, then every **5 minutes** (`setInterval`). A run is skipped if the previous one is still in progress. Each run does the following, in order, with a batch limit of 100 per step:

1. **Finish interrupted deletions.** Documents with `deletedAt` set more than 5 minutes ago go through vector delete → Cloudinary destroy (guarded) → record delete.
2. **Exhausted stale claims.** `indexing` documents with attempts ≥ 3 and a claim older than 15 minutes are set to `failed` with "Indexing failed after 3 attempts".
   
   **2b. Documents without text (ARC-001, Wave 4).** Documents that have no stored text (empty, missing, or only pdf-parse page markers) can never be indexed. They are set to `failed` with `embeddingError: "No extractable text"`, which the UI shows, instead of being re-queued forever:
   - `pending` documents, and `failed` documents whose last update is older than 10 minutes;
   - `indexing` documents whose claim is stale (older than 15 minutes) or was never started.
   
   The ids and the count are logged (`Marked N document(s) without extractable text as failed: <ids>`), never the content. No record, file or vector is deleted. This step is idempotent. **User-visible change:** existing records of that kind (for example metadata-only records created by the removed `POST /api/documents`, or scanned PDFs uploaded before Wave 4) change from `pending` to `failed` at the first sweep after the update. New uploads without text are stored as `failed` immediately and never queued. The re-queue step below only considers documents that have text.
3. **Backlog check.** `LLEN` on the queue. If Redis cannot be read, the run stops here. If **100 or more** jobs are waiting, re-queueing is deferred, so that repeated sweeps do not pile up duplicate jobs in Redis while workers are down. (The sweep no longer loads documents' text: jobs are pointers.)
4. **Re-queue** documents that are not deleted and have attempts left, oldest first, when any of these holds:
   - `indexing`, with a claim older than 15 minutes or no start time recorded
   - `pending` or `failed`, with no update (`updatedAt`) for more than **10 minutes**

   After pushing each job, the sweep updates the document conditionally, using the values it read, so that a claim taken in between is never overwritten:
   - an abandoned claim goes back to `pending` with `indexingStartedAt: null`
   - in every case, `updatedAt` is set to now, which restarts the 10-minute window
5. A summary is logged if anything happened, for example `Embedding recovery sweep: { requeued, exhausted, textless, deletionsFinished, errors, backlog }`.

A sweep may re-queue a document whose original job is still waiting in a slow queue. The claim makes the duplicate harmless: it is skipped as `in-progress` or `already-indexed`. If the document failed in the meantime, the duplicate starts its next attempt.

---

## 7. Recovery after crashes

| What happened | Effect | How it recovers | Typical delay |
|---|---|---|---|
| Worker process crashed or was killed mid-job | Job lost. Document stuck in `indexing`. | Claim goes stale after 15 min. The next sweep re-queues it (one attempt has been used). | 15–20 min |
| Worker crashed after writing vectors but before reporting `indexed` | Same as above. The vectors exist. | Re-processing deletes and rewrites the same deterministic ids | 15–20 min |
| Redis restarted and lost the list (no persistence, or data lost) | `pending` documents have no job | The sweep re-queues `pending` documents with no update for 10 min | 10–15 min |
| document-service unreachable when the worker claims | Claim throws and the job is lost. The document stays `pending`. | Sweep, after 10 min with no update | 10–15 min |
| document-service unreachable when the worker reports | up to 3 attempts to report `indexed`, then up to 3 to report `failed`; if all fail, the document stays `indexing` | Stale claim, then sweep | 15–20 min |
| A job ran longer than 15 min (for example Voyage backoff on a large document) | Another worker may take over the stale claim | The first worker's report is rejected with `409` and its result discarded. Both write the same vector ids; the last write wins. | — |
| Upload could not enqueue (Redis down) | `failed`, no reason shown | Sweep, after 10 min, while attempts remain | 10–15 min |
| document-service stopped part-way through a deletion | Record hidden (`deletedAt` set) | Sweep finishes deletions older than 5 min | 5–10 min |
| All workers down for a long time | Queue grows. The sweep stops re-queueing at 100 waiting jobs. | Workers drain the queue when they return, then later sweeps re-queue whatever is still unfinished | Depends on backlog |

### Deletion during processing

When a document is deleted while a worker is processing it:

- The claim is refused (`410`) if the worker had not claimed it yet.
- If the worker already holds the claim, its final report gets `410`/`404`. The worker then deletes the vectors it may have written (`removeVectorsOfDeletedDocument`).
- The cleanup is retried: up to **3 attempts**, waiting about 1 s and then 3 s (SEC-012 b, Wave 4).
- If every attempt fails, the worker logs `... was deleted during indexing but its vectors could NOT be removed after 3 attempts (workspace <id>); they are excluded from retrieval`. The orphaned vectors stay in Pinecone, but retrieval never returns them: every query checks its matches against document-service (`POST /internal/documents/live`) and drops matches of deleted documents. To remove them, call ai-service's internal `DELETE /internal/vectors/workspaces/:workspaceId/documents/:documentId` with the internal token. There is no automatic orphan sweep (accepted residual).

### Deploy order (Wave 4)

- document-service's internal `POST /internal/documents/live` now also returns `liveDocuments: [{ id, name }]` (ISS-029); `liveDocumentIds` is unchanged. ai-service works with either response, so **document-service and ai-service can be updated in either order**.
- The new MongoDB indexes for paging (documents, tasks, boards, task activities) are built by Mongoose on the existing collections at the next start of document-service and task-service (`syncIndexes`/`autoIndex`). On large collections this takes a moment at startup.
- The step 2b status change applies to existing records at the first sweep after document-service is updated.

---

## 8. Shutdown behaviour

Shutdown is wired through `registerGracefulShutdown` (`packages/shared/lifecycle/shutdown.ts`) on SIGINT and SIGTERM.

- **ai-service (HTTP + worker).** Overall timeout 30 s.
  1. Stop HTTP; in-flight requests and SSE streams get 5 s.
  2. `stopEmbeddingWorker()`: no new job is started, and the job in progress is allowed to finish. If Redis is reachable, the loop exits within the 5 s `BLPOP` timeout. A job popped in that window is still processed, never abandoned. If Redis is unreachable, the worker client is disconnected first (so a queued `BLPOP` cannot pop a job after Redis returns) and the pending pop is abandoned.
  3. Close MongoDB, the general Redis client, and the worker Redis client.
- **Standalone worker.** Stop worker → close worker Redis. Timeout 30 s.
- **document-service.** Stop HTTP → stop the sweep timer → MongoDB → Redis. A sweep already running is not awaited; it is cut off when the connections close, and the next start's sweep continues the work.
- **When the timeout is exceeded.** A job can take longer than the 30 s limit, for example while in a 20 s + 40 s Voyage backoff. The process then exits with code 1. The document stays `indexing` and is recovered as a crashed claim (15–20 min). Supervisors such as `docker stop -t` must allow at least 30 s for a clean stop.
- A second signal forces an immediate `exit(1)`. SIGKILL behaves like a crash.

---

## 9. Dependencies and configuration

| Dependency | Needed by | Variables |
|---|---|---|
| Redis | Producer (document-service), consumer (worker) | `REDIS_URL` (default `redis://127.0.0.1:6379`) |
| document-service internal API | Worker (claim, status) | `DOCUMENT_SERVICE_URL` (default `http://localhost:5003`), `INTERNAL_SERVICE_TOKEN` (same value in both services) |
| ai-service internal API | document-service (vector deletion, sweep deletions) | `AI_SERVICE_URL` (default `http://127.0.0.1:5006`), `INTERNAL_SERVICE_TOKEN` |
| Voyage AI | Worker | `VOYAGE_API_KEY`, `VOYAGE_MODEL` (default `voyage-3`), `VOYAGE_EMBEDDING_DIMENSION` (default 1024) |
| Pinecone | Worker | `PINECONE_API_KEY`, `PINECONE_INDEX`. The index dimension must equal `VOYAGE_EMBEDDING_DIMENSION`. If Pinecone is reachable at startup and they differ, the worker will not start. If Pinecone is unreachable, the check is skipped with a warning. |
| MongoDB | document-service (status and claims). The worker does not use MongoDB directly. | `MONGODB_URI` or `MONGO_URI` |

Fixed values in code (no environment override):

| Setting | Value |
|---|---|
| Maximum attempts | 3 |
| Stale claim | 15 min |
| Stale `pending`/`failed` | 10 min |
| Sweep interval | 5 min |
| Backlog cap | 100 |
| Stale deletion | 5 min |
| `BLPOP` timeout | 5 s |
| Internal HTTP timeout (claim, status) | 15 s |
| Text fetch timeout (`DOCUMENT_SOURCE_TIMEOUT_MS`) | 30 s |
| Voyage batch / Pinecone call timeout | 30 s / 20 s |
| Job deadline (`EMBEDDING_JOB_TIMEOUT_MS`) | 10 min |
| Embedding batch | 20 chunks |
| Pinecone upsert batch | 100 vectors |

Voyage AI and Pinecone were **not tested against live accounts**. The rate-limit handling relies on error shapes (status 429, "429" in the message, `RateLimitQuotaExhaustedError`) that were not confirmed against the real SDK and API.

---

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Documents stay `pending` | Is a worker running? Look for `Embedding worker listening on researchmind:embedding:jobs` in the ai-service log. Can it reach Redis? (`Redis ready` / `reconnecting` log lines, ai-service `GET /health`.) What is the queue length? (`redis-cli LLEN researchmind:embedding:jobs`.) Does document-service log `Embedding queue backlog is N; recovery re-queueing deferred`? |
| A document stays `indexing` for a long time | Look in the worker log for `[Voyage AI] Rate limit (429) hit` (backoff) or for a worker crash or restart. After 15 minutes the claim is stale: the sweep re-queues it within about 5 more minutes, or a user can re-index. |
| `failed` with no `embeddingError` | Enqueueing at upload time failed (Redis was down). Look for `Failed to enqueue embedding job` in the document-service log. The sweep retries after 10 min. |
| `failed`: "Document contains no usable text" | The PDF has no text layer (a scanned image) or the file is empty. There is no OCR. Retrying will not help. |
| `failed`: "Invalid embedding dimension…" or "Embedding count mismatch" | `VOYAGE_EMBEDDING_DIMENSION` does not match what the model returns, or the provider response was unexpected |
| `failed`: "Indexing failed after 3 attempts" | Look in the logs for the earlier attempts' errors (`Embedding processing failed for document <id>`). Fix the cause, then re-index, which resets the attempts. |
| `failed`: "Embedding job did not match the document's workspace" | A job in Redis named the wrong workspace (corrupt, or injected). Investigate who can write to Redis. Re-index once resolved. |
| Worker logs `Failed to claim document for embedding: 401 internal authentication rejected` | `INTERNAL_SERVICE_TOKEN` differs between ai-service and document-service |
| Worker logs a claim `404` with no reason | `DOCUMENT_SERVICE_URL` points at the wrong service or an old document-service build |
| Worker logs `Skipping embedding job … in-progress` / `already-indexed` | A duplicate delivery. This is normal after sweeps. |
| Worker logs `Embedding claim for document <id> was superseded` | The job took longer than 15 minutes. Check Voyage rate limits and document size. |
| Worker logs `… deleted during indexing but its vectors could NOT be removed after 3 attempts` | The vectors are not retrievable, but still stored. Remove them by hand if needed. See [Deletion during processing](#deletion-during-processing). |
| A document shows `failed` with `No extractable text` | The file has no text layer (for example a scanned PDF). It cannot be indexed; upload a version with text. |
| `DELETE /api/documents/:id` answers 503 | Vector deletion failed. Check `AI_SERVICE_URL` and `INTERNAL_SERVICE_TOKEN` in document-service, that ai-service is up, and Pinecone errors in the ai-service log. |
| ai-service or worker exits at startup with `vector index check failed` | Pinecone was reachable and either the index was not found or its dimension differs from `VOYAGE_EMBEDDING_DIMENSION`. If Pinecone is **unreachable** (or `listIndexes` takes more than 10 s), startup only logs `Could not verify the Pinecone index at startup; continuing` and the check is skipped (`services/ai-service/src/utils/verify-pinecone.ts`). A mismatch then shows up later as failed jobs or failed queries. |
| ai-service or worker exits at startup with `Pinecone rejected PINECONE_API_KEY (invalid or revoked credentials)` | Pinecone answered 401 (RT-006, Wave 4). Fix `PINECONE_API_KEY` and restart. |
| ai-service exits on startup with `VOYAGE_API_KEY is not configured` / `PINECONE_…` / `XAI_API_KEY…` | A provider key is missing. The service fails as soon as it imports the module that needs the key. |
| Shutdown logs `shutdown timed out after 30000 ms` | A job was still running, usually in Voyage backoff. Its document recovers as a crashed claim. |
| Checking that a workspace has vectors | `npm run verify:vectors -- <documentId> <workspaceId>` (ai-service). **Note:** despite its name and arguments, the script only prints index and namespace statistics (record count). It does not check the given document's vectors. |

---

## 11. Not implemented

- Exactly-once or acknowledged delivery: there is no `BLMOVE` or processing list, and no visibility timeout.
- Durable queue configuration: the compose file runs Redis with its defaults.
- Dead-letter queue, job priorities, delayed or scheduled jobs.
- Worker concurrency above one job per process. Horizontal scaling means running more worker processes.
- Metrics, queue dashboards and alerting. Visibility today is limited to logs, `LLEN` and each document's status.
- A setting to run ai-service without its in-process worker.
