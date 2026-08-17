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