import redisWorker from "../config/redis-worker";
import { EmbeddingJob } from "../types/embedding.types";

import { chunkText } from "../services/chunking.service";
import { generateEmbeddings } from "../services/embedding.service";

import { deleteDocumentEmbeddings, upsertDocumentEmbeddings } from "../services/vector-service";
import { updateDocumentEmbeddingStatus } from "../services/document-status.service";

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

/** Process a single document embedding job. */
const processEmbeddingJob = async (
  job: EmbeddingJob
) => {
  const {
    documentId,
    workspaceId,
    uploadedBy,
    fileType,
    extractedText,
  } = job;

  try {
    console.log(
      `Starting embedding processing for document ${documentId}`
    );

    await updateDocumentEmbeddingStatus(
      documentId,
      "indexing"
    );

    const chunks = await chunkText(
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
      await generateEmbeddings(
        chunks.map((chunk) => chunk.text)
      );

    console.log(
      `Generated ${embeddings.length} embeddings`
    );

    await deleteDocumentEmbeddings(
      workspaceId,
      documentId
    );

    const result =
      await upsertDocumentEmbeddings({
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

    await updateDocumentEmbeddingStatus(
      documentId,
      "indexed"
    );

    console.log(
      `Document ${documentId} indexing completed`
    );
  } catch (error) {
    console.error(
      `Embedding processing failed for document ${documentId}:`,
      error
    );

    try {
      await updateDocumentEmbeddingStatus(
        documentId,
        "failed"
      );
    } catch (statusError) {
      console.error(
        `Failed to update document ${documentId} status to failed:`,
        statusError
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
let currentJob: Promise<void> | null = null;
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
        console.error(
          "Invalid embedding job received:",
          parsedJob
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