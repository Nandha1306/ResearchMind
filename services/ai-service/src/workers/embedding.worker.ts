import redisWorker from "../config/redis-worker";
import { EmbeddingJob } from "../types/embedding.types";

import { chunkText } from "../services/chunking.service";
import { generateEmbeddings } from "../services/embedding.service";
import { upsertDocumentEmbeddings } from "../services/vector-service";

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

/** Process a single embedding job from the Redis queue. */
const processEmbeddingJob = async (
  job: EmbeddingJob
) => {
  console.log("Embedding job received:", {
    documentId: job.documentId,
    workspaceId: job.workspaceId,
    fileType: job.fileType,
    textLength: job.extractedText.length,
  });

  const chunks = await chunkText(
    job.extractedText
  );

  console.log(
    `Document ${job.documentId} split into ${chunks.length} chunks`
  );

  if (chunks.length === 0) {
    throw new Error(
      `Document ${job.documentId} contains no usable text`
    );
  }

  const embeddings =
    await generateEmbeddings(
      chunks.map((chunk) => chunk.text)
    );

  console.log(
    `Generated ${embeddings.length} embeddings for document ${job.documentId}`
  );

  const result =
    await upsertDocumentEmbeddings({
      documentId: job.documentId,
      workspaceId: job.workspaceId,
      uploadedBy: job.uploadedBy,
      fileType: job.fileType,
      chunks,
      embeddings,
    });

  console.log(
    `Stored ${result.vectorCount} vectors in Pinecone namespace ${result.workspaceId}`
  );
};

/** Start the long-running Redis embedding worker. */
export const startEmbeddingWorker = async () => {
  console.log(
    `Embedding worker listening on ${EMBEDDING_QUEUE}`
  );

  while (true) {
    try {
      const result = await redisWorker.blpop(
        EMBEDDING_QUEUE,
        0
      );

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

      await processEmbeddingJob(parsedJob);
    } catch (error) {
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
};