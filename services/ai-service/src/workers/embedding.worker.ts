import redisWorker from "../config/redis-worker";
import { EmbeddingJob } from "../types/embedding.types";

import { chunkText } from "../services/chunking.service";
import { generateEmbeddings } from "../services/embedding.service";

import { deleteDocumentEmbeddings, upsertDocumentEmbeddings } from "../services/vector-service";
import {
  claimDocumentForEmbedding,
  isClaimSupersededError,
  isDocumentGoneError,
  isTransientDocumentServiceError,
  updateDocumentEmbeddingStatus,
} from "../services/document-status.service";

const EMBEDDING_QUEUE = "researchmind:embedding:jobs";

/** Validate the structure of an embedding job received from Redis. */
const isValidEmbeddingJob = (
  value: unknown
): value is EmbeddingJob => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Record<string, unknown>;

  return (
    typeof job.documentId === "string" &&
    typeof job.workspaceId === "string" &&
    typeof job.uploadedBy === "string" &&
    typeof job.extractedText === "string" &&
    (job.fileType === "pdf" || job.fileType === "docx")
  );
};

/** Collaborators of processEmbeddingJob; injectable so it can be unit-tested. */
export interface EmbeddingJobDeps {
  claim: typeof claimDocumentForEmbedding;
  updateStatus: typeof updateDocumentEmbeddingStatus;
  chunk: typeof chunkText;
  embed: typeof generateEmbeddings;
  deleteVectors: typeof deleteDocumentEmbeddings;
  upsertVectors: typeof upsertDocumentEmbeddings;
}

const defaultDeps: EmbeddingJobDeps = {
  claim: claimDocumentForEmbedding,
  updateStatus: updateDocumentEmbeddingStatus,
  chunk: chunkText,
  embed: generateEmbeddings,
  deleteVectors: deleteDocumentEmbeddings,
  upsertVectors: upsertDocumentEmbeddings,
};

/** Failure reason stored on the document: message only, bounded, no stack. */
const describeFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300) || "Indexing failed";
};

/**
 * The document was deleted while (or after) this job wrote its vectors:
 * remove them again so deleted content cannot remain retrievable.
 */
const removeVectorsOfDeletedDocument = async (
  deps: EmbeddingJobDeps,
  workspaceId: string,
  documentId: string
) => {
  try {
    await deps.deleteVectors(workspaceId, documentId);
    console.log(
      `Document ${documentId} was deleted during indexing; its vectors were removed`
    );
  } catch (cleanupError) {
    // Loud: this is the one path where deleted content could stay searchable.
    console.error(
      `Document ${documentId} was deleted during indexing but its vectors could NOT be removed (workspace ${workspaceId}):`,
      describeFailure(cleanupError)
    );
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
 * 2. Chunk, embed, replace the document's vectors (deterministic ids, so a
 *    retry overwrites rather than duplicates).
 * 3. Mark indexed. If document-service reports the document gone (404/410),
 *    it was deleted meanwhile: the vectors just written are removed.
 * On failure the document is marked failed with a reason; the recovery sweep
 * in document-service re-queues it while retries remain.
 */
export const processEmbeddingJob = async (
  job: EmbeddingJob,
  deps: EmbeddingJobDeps = defaultDeps,
  { statusRetryDelayMs = 1000 }: { statusRetryDelayMs?: number } = {}
): Promise<EmbeddingJobOutcome> => {
  const {
    documentId,
    workspaceId,
    uploadedBy,
    fileType,
    extractedText,
  } = job;

  const claim = await deps.claim(documentId);
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

    const chunks = await deps.chunk(
      extractedText
    );

    if (chunks.length === 0) {
      throw new Error(
        "Document contains no usable text"
      );
    }

    console.log(
      `Document ${documentId} split into ${chunks.length} chunks`
    );

    const embeddings =
      await deps.embed(
        chunks.map((chunk) => chunk.text)
      );

    console.log(
      `Generated ${embeddings.length} embeddings`
    );

    await deps.deleteVectors(
      workspaceId,
      documentId
    );

    vectorsWritten = true;
    const result =
      await deps.upsertVectors({
        documentId,
        workspaceId,
        uploadedBy,
        fileType,
        chunks,
        embeddings,
      });

    console.log(
      `Stored ${result.vectorCount} vectors in Pinecone`
    );

    await reportFinalStatus(deps, documentId, "indexed", undefined, claimToken, statusRetryDelayMs);

    console.log(
      `Document ${documentId} indexing completed`
    );
    return "indexed";
  } catch (error) {
    if (isDocumentGoneError(error)) {
      await removeVectorsOfDeletedDocument(deps, workspaceId, documentId);
      return "deleted-during-processing";
    }
    if (isClaimSupersededError(error)) {
      // Our claim expired and another worker took over; it rewrites the same
      // deterministic vector ids and reports the result. Nothing to undo.
      console.warn(`Embedding claim for document ${documentId} was superseded; result discarded`);
      return "superseded";
    }

    console.error(
      `Embedding processing failed for document ${documentId}:`,
      describeFailure(error)
    );

    try {
      await reportFinalStatus(
        deps, documentId, "failed", describeFailure(error), claimToken, statusRetryDelayMs
      );
    } catch (statusError) {
      if (isDocumentGoneError(statusError)) {
        if (vectorsWritten) {
          await removeVectorsOfDeletedDocument(deps, workspaceId, documentId);
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
export const startEmbeddingWorker = (): Promise<void> => {
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
  workerLoop = runWorkerLoop().finally(() => {
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

const runWorkerLoop = async () => {
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

      currentJob = processEmbeddingJob(parsedJob);
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
        error
      );

      /*
       * Keep the worker alive.
       * A single failed job must not terminate
       * the entire background worker process.
       */
      await new Promise((resolve) =>
        setTimeout(resolve, 1000)
      );
    }
  }

  console.log("Embedding worker stopped");
};