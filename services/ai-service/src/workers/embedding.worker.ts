import redisWorker from "../config/redis-worker";
import { EmbeddingJob } from "../types/embedding.types";

import { chunkText } from "../services/chunking.service";
import { generateEmbeddings } from "../services/embedding.service";

import { deleteDocumentEmbeddings, upsertDocumentEmbeddings } from "../services/vector-service";
import {
  claimDocumentForEmbedding,
  fetchEmbeddingSource,
  isClaimSupersededError,
  isDocumentGoneError,
  isTransientDocumentServiceError,
  updateDocumentEmbeddingStatus,
} from "../services/document-status.service";
import { timeouts } from "../config/timeouts";
import { describeErrorForLog } from "../../../../packages/shared/errors/safe-error";

const EMBEDDING_QUEUE = "researchmind:embedding:jobs";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Validate an embedding job received from Redis. A job is a pointer
 * (documentId + workspaceId, both ObjectIds). Entries from older producers
 * that also carry text, uploader or file type are accepted; those fields are
 * ignored (the worker fetches them from document-service).
 */
export const isValidEmbeddingJob = (
  value: unknown
): value is EmbeddingJob => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Record<string, unknown>;

  return (
    typeof job.documentId === "string" &&
    OBJECT_ID.test(job.documentId) &&
    typeof job.workspaceId === "string" &&
    OBJECT_ID.test(job.workspaceId)
  );
};

/** Collaborators of processEmbeddingJob; injectable so it can be unit-tested. */
export interface EmbeddingJobDeps {
  claim: typeof claimDocumentForEmbedding;
  fetchSource: typeof fetchEmbeddingSource;
  updateStatus: typeof updateDocumentEmbeddingStatus;
  chunk: typeof chunkText;
  embed: typeof generateEmbeddings;
  deleteVectors: typeof deleteDocumentEmbeddings;
  upsertVectors: typeof upsertDocumentEmbeddings;
}

export const defaultEmbeddingJobDeps: EmbeddingJobDeps = {
  claim: claimDocumentForEmbedding,
  fetchSource: fetchEmbeddingSource,
  updateStatus: updateDocumentEmbeddingStatus,
  chunk: chunkText,
  embed: generateEmbeddings,
  deleteVectors: deleteDocumentEmbeddings,
  upsertVectors: upsertDocumentEmbeddings,
};

const defaultDeps = defaultEmbeddingJobDeps;

/** The whole job exceeded its deadline (ISS-037 watchdog). */
export class EmbeddingJobTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Embedding timed out after ${Math.round(timeoutMs / 1000)} s`);
    this.name = "EmbeddingJobTimeoutError";
  }
}

/**
 * Job deadline: `guard(p)` settles with `p` or rejects with
 * EmbeddingJobTimeoutError when the deadline passes, whichever is first, so
 * a provider call that never answers cannot hold the worker. `check()`
 * throws once the deadline has passed (called before every write).
 */
const createDeadline = (timeoutMs: number) => {
  let expired = false;
  let expire: () => void = () => {};
  const expiredPromise = new Promise<never>((_resolve, reject) => {
    expire = () => reject(new EmbeddingJobTimeoutError(timeoutMs));
  });
  expiredPromise.catch(() => {});
  const timer = setTimeout(() => {
    expired = true;
    expire();
  }, timeoutMs);
  return {
    check: () => {
      if (expired) throw new EmbeddingJobTimeoutError(timeoutMs);
    },
    guard: <T>(promise: Promise<T>): Promise<T> => {
      promise.catch(() => {}); // a late rejection of an abandoned call
      if (expired) return Promise.reject(new EmbeddingJobTimeoutError(timeoutMs));
      return Promise.race([promise, expiredPromise]);
    },
    clear: () => clearTimeout(timer),
  };
};

/** Redacted detail for logs only (RT-007): never stored, never shown. */
const describeFailure = (error: unknown): string => describeErrorForLog(error);

/**
 * The failure reason STORED on the document and shown to members (RT-007):
 * a fixed, user-safe text. Raw provider messages (which can contain key
 * identifiers or internal hosts) go to the log only. ResearchMind's own
 * reasons ("Document contains no usable text") are kept as they are.
 */
const storedFailureReason = (error: unknown): string => {
  if (error instanceof EmbeddingJobTimeoutError || (error as { name?: string })?.name === "ProviderTimeoutError") {
    return "Indexing timed out";
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "Document contains no usable text") return message;
  return "Indexing failed";
};

/** Attempts to remove the vectors of a document deleted during indexing (SEC-012 b). */
export const DELETED_DOCUMENT_CLEANUP_ATTEMPTS = 3;

/**
 * The document was deleted while (or after) this job wrote its vectors:
 * remove them again, retrying a transient failure (3 attempts, waiting
 * `retryDelayMs` then 3 x `retryDelayMs`). If every attempt fails, the
 * vectors stay in Pinecone as orphans; retrieval never returns them (it
 * drops matches of deleted documents), and the failure is logged loudly.
 */
const removeVectorsOfDeletedDocument = async (
  deps: EmbeddingJobDeps,
  workspaceId: string,
  documentId: string,
  retryDelayMs = 1000
) => {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.deleteVectors(workspaceId, documentId);
      console.log(
        `Document ${documentId} was deleted during indexing; its vectors were removed`
      );
      return;
    } catch (cleanupError) {
      if (attempt >= DELETED_DOCUMENT_CLEANUP_ATTEMPTS) {
        console.error(
          `Document ${documentId} was deleted during indexing but its vectors could NOT be removed after ${attempt} attempts (workspace ${workspaceId}); they are excluded from retrieval:`,
          describeFailure(cleanupError)
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt === 1 ? 1 : 3)));
    }
  }
};

export type EmbeddingJobOutcome =
  | "indexed"
  | "skipped"
  | "superseded"
  | "deleted-during-processing";

/** Attempts (with backoff) for the final status report, which must not be lost. */
const FINAL_STATUS_ATTEMPTS = 3;

/**
 * Report a final status, retrying transient failures (network, 5xx) so a
 * brief document-service hiccup does not leave a finished job unrecorded.
 * 4xx decisions (deleted, superseded) are returned to the caller at once.
 */
const reportFinalStatus = async (
  deps: EmbeddingJobDeps,
  documentId: string,
  status: "indexed" | "failed",
  error: string | undefined,
  claimToken: number,
  retryDelayMs: number
) => {
  for (let i = 1; ; i++) {
    try {
      return await deps.updateStatus(documentId, status, error, claimToken);
    } catch (statusError) {
      if (i >= FINAL_STATUS_ATTEMPTS || !isTransientDocumentServiceError(statusError)) {
        throw statusError;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * i));
    }
  }
};

/**
 * Process a single document embedding job.
 *
 * 1. Claim the document atomically in document-service. Duplicate or
 *    concurrent deliveries, deleted documents and documents past their retry
 *    limit are skipped (not failed).
 * 2. Fetch the text, uploader and file type for THIS claim from
 *    document-service (SEC-006): the queue entry is only a pointer, and any
 *    text it carries (older producers) is ignored.
 * 3. Chunk, embed, replace the document's vectors (deterministic ids, so a
 *    retry overwrites rather than duplicates).
 * 4. Mark indexed. If document-service reports the document gone (404/410),
 *    it was deleted meanwhile: the vectors just written are removed.
 * On failure the document is marked failed with a reason; the recovery sweep
 * in document-service re-queues it while retries remain.
 *
 * Watchdog (ISS-037): the whole job has a deadline (EMBEDDING_JOB_TIMEOUT_MS,
 * below the 15 min claim lease). A provider call that never answers is
 * abandoned at the deadline, no vector is written after it, and the job is
 * reported failed with the SAME claim token -- so the report is refused
 * (superseded) if another worker has taken the claim over meanwhile, and the
 * worker moves on to the next job.
 */
export const processEmbeddingJob = async (
  job: EmbeddingJob,
  deps: EmbeddingJobDeps = defaultDeps,
  {
    statusRetryDelayMs = 1000,
    jobTimeoutMs = timeouts.embeddingJobMs(),
  }: { statusRetryDelayMs?: number; jobTimeoutMs?: number } = {}
): Promise<EmbeddingJobOutcome> => {
  const { documentId, workspaceId } = job;

  const deadline = createDeadline(jobTimeoutMs);
  try {
    return await processClaimedJob(documentId, workspaceId, deps, deadline, statusRetryDelayMs);
  } finally {
    deadline.clear();
  }
};

const processClaimedJob = async (
  documentId: string,
  workspaceId: string,
  deps: EmbeddingJobDeps,
  deadline: ReturnType<typeof createDeadline>,
  statusRetryDelayMs: number
): Promise<EmbeddingJobOutcome> => {
  const claim = await deadline.guard(deps.claim(documentId));
  if (!claim.claimed) {
    console.log(
      `Skipping embedding job for document ${documentId}: ${claim.reason}`
    );
    return "skipped";
  }
  const { claimToken } = claim;

  /*
   * The queue entry is only a pointer: the namespace written to must be the
   * workspace of the document actually claimed. A job naming a different
   * workspace (corrupt or injected into Redis) is refused, so it cannot write
   * one workspace's text into another workspace's index.
   */
  if (claim.workspaceId !== workspaceId) {
    console.error(
      `Refusing embedding job for document ${documentId}: job workspace does not match the document's workspace`
    );
    await reportFinalStatus(
      deps, documentId, "failed", "Embedding job did not match the document's workspace",
      claimToken, statusRetryDelayMs
    ).catch(() => {});
    return "skipped";
  }

  let vectorsWritten = false;

  try {
    console.log(
      `Starting embedding processing for document ${documentId}`
    );

    // The text and metadata come from document-service for this claim only.
    const source = await deadline.guard(deps.fetchSource(documentId, workspaceId, claimToken));
    const { uploadedBy, fileType } = source;

    const chunks = await deadline.guard(deps.chunk(
      source.extractedText
    ));

    if (chunks.length === 0) {
      throw new Error(
        "Document contains no usable text"
      );
    }

    console.log(
      `Document ${documentId} split into ${chunks.length} chunks`
    );

    const embeddings =
      await deadline.guard(deps.embed(
        chunks.map((chunk) => chunk.text)
      ));

    console.log(
      `Generated ${embeddings.length} embeddings`
    );

    deadline.check();
    await deadline.guard(deps.deleteVectors(
      workspaceId,
      documentId
    ));

    deadline.check();
    vectorsWritten = true;
    const result =
      await deadline.guard(deps.upsertVectors({
        documentId,
        workspaceId,
        uploadedBy,
        fileType,
        chunks,
        embeddings,
      }));

    console.log(
      `Stored ${result.vectorCount} vectors in Pinecone`
    );

    deadline.check();
    await reportFinalStatus(deps, documentId, "indexed", undefined, claimToken, statusRetryDelayMs);

    console.log(
      `Document ${documentId} indexing completed`
    );
    return "indexed";
  } catch (error) {
    if (isDocumentGoneError(error)) {
      await removeVectorsOfDeletedDocument(deps, workspaceId, documentId, statusRetryDelayMs);
      return "deleted-during-processing";
    }
    if (isClaimSupersededError(error)) {
      // Our claim expired and another worker took over; it rewrites the same
      // deterministic vector ids and reports the result. Nothing to undo.
      console.warn(`Embedding claim for document ${documentId} was superseded; result discarded`);
      return "superseded";
    }

    if (error instanceof EmbeddingJobTimeoutError) {
      console.error(`Embedding job for document ${documentId} exceeded its deadline; abandoned`);
    } else {
      console.error(
        `Embedding processing failed for document ${documentId}:`,
        describeFailure(error)
      );
    }

    try {
      await reportFinalStatus(
        deps, documentId, "failed", storedFailureReason(error), claimToken, statusRetryDelayMs
      );
    } catch (statusError) {
      if (isDocumentGoneError(statusError)) {
        if (vectorsWritten) {
          await removeVectorsOfDeletedDocument(deps, workspaceId, documentId, statusRetryDelayMs);
        }
        return "deleted-during-processing";
      }
      if (isClaimSupersededError(statusError)) {
        console.warn(`Embedding claim for document ${documentId} was superseded; failure discarded`);
        return "superseded";
      }
      console.error(
        `Failed to update document ${documentId} status to failed:`,
        describeFailure(statusError)
      );
    }

    throw error;
  }
};

/*
 * BLPOP waits at most this long so the loop can notice a stop request.
 * (It used to block forever, so a shutdown could never wait for it cleanly.)
 */
const BLPOP_TIMEOUT_SECONDS = 5;

let workerLoop: Promise<void> | null = null;
let currentJob: Promise<unknown> | null = null;
let stopRequested = false;

/** Resolves when a stop must abandon a BLPOP that can never settle. */
let abandonPendingPop: () => void = () => {};
let pendingPopAbandoned: Promise<null> = Promise.resolve(null);

/**
 * Start the long-running Redis embedding worker.
 *
 * Idempotent within a process: a second call returns the already-running loop
 * instead of starting a second consumer.
 */
export const startEmbeddingWorker = (
  /** Tests only: collaborators and job options for every job of this loop. */
  options: { deps?: EmbeddingJobDeps; jobTimeoutMs?: number; errorBackoffMs?: number } = {}
): Promise<void> => {
  if (workerLoop) {
    console.warn(
      "Embedding worker already running in this process; ignoring duplicate start"
    );
    return workerLoop;
  }

  stopRequested = false;
  pendingPopAbandoned = new Promise<null>((resolve) => {
    abandonPendingPop = () => resolve(null);
  });
  workerLoop = runWorkerLoop(options).finally(() => {
    workerLoop = null;
  });
  return workerLoop;
};

/**
 * Ask the worker to stop: no new job is taken from the queue, and the job
 * currently being processed (if any) is allowed to finish.
 *
 * - Redis reachable: wait for the loop. Its BLPOP returns within
 *   BLPOP_TIMEOUT_SECONDS, so a job it pops is processed, never abandoned.
 * - Redis unreachable: the pending BLPOP can never settle (ioredis keeps it
 *   in its offline queue), and it cannot deliver a job either, so it is
 *   abandoned and the loop exits immediately.
 */
export const stopEmbeddingWorker = async (): Promise<void> => {
  stopRequested = true;

  if (currentJob) {
    await currentJob.catch(() => {
      // Failure is already logged and recorded by processEmbeddingJob.
    });
  }

  if (redisWorker.status !== "ready") {
    // Stop the client from reconnecting first: otherwise the abandoned BLPOP,
    // still queued inside ioredis, could run if Redis came back moments later
    // and pop a job that nobody would process.
    redisWorker.disconnect();
    abandonPendingPop();
  }

  if (workerLoop) {
    await workerLoop;
  }
};

const runWorkerLoop = async ({
  deps = defaultDeps,
  jobTimeoutMs,
  errorBackoffMs = 1000,
}: { deps?: EmbeddingJobDeps; jobTimeoutMs?: number; errorBackoffMs?: number } = {}) => {
  console.log(
    `Embedding worker listening on ${EMBEDDING_QUEUE}`
  );

  while (!stopRequested) {
    try {
      const pop = redisWorker.blpop(
        EMBEDDING_QUEUE,
        BLPOP_TIMEOUT_SECONDS
      );
      // If the pop is abandoned on stop, its eventual rejection (client
      // closed) must not surface as an unhandled rejection.
      pop.catch(() => {});

      const result = await Promise.race([pop, pendingPopAbandoned]);

      if (!result) {
        continue;
      }

      const [, rawJob] = result;

      let parsedJob: unknown;

      try {
        parsedJob = JSON.parse(rawJob);
      } catch {
        console.error(
          "Invalid JSON received from embedding queue"
        );
        continue;
      }

      if (!isValidEmbeddingJob(parsedJob)) {
        // Never log the job itself: it can carry full document text.
        const documentId = (parsedJob as { documentId?: unknown } | null)?.documentId;
        console.error(
          `Invalid embedding job received (documentId: ${typeof documentId === "string" ? documentId : "unknown"})`
        );
        continue;
      }

      currentJob = processEmbeddingJob(
        parsedJob,
        deps,
        jobTimeoutMs === undefined ? {} : { jobTimeoutMs }
      );
      try {
        await currentJob;
      } finally {
        currentJob = null;
      }
    } catch (error) {
      if (stopRequested) {
        // Expected during shutdown: the Redis client was closed under a
        // pending BLPOP.
        break;
      }

      console.error(
        "Embedding worker error:",
        describeErrorForLog(error)
      );

      /*
       * Keep the worker alive.
       * A single failed job must not terminate
       * the entire background worker process.
       */
      await new Promise((resolve) =>
        setTimeout(resolve, errorBackoffMs)
      );
    }
  }

  console.log("Embedding worker stopped");
};