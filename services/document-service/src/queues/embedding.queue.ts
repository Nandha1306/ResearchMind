import redis from "../config/redis";

export const EMBEDDING_QUEUE = "researchmind:embedding:jobs";

/**
 * An embedding job is a POINTER only (SEC-006/ARC-007): the document id and
 * its workspace. The worker claims the document and then fetches the text
 * from document-service's authenticated internal endpoint
 * (GET /internal/documents/:id/embedding-source), so no document text is ever
 * written to Redis, and a job injected into Redis cannot supply text.
 */
export interface EmbeddingJob {
  documentId: string;
  workspaceId: string;
}

/** Add a document to the embedding processing queue. */
export const addEmbeddingJob = async (
  job: EmbeddingJob
) => {
  // Only the two pointer fields, whatever else the caller's object carries.
  const payload: EmbeddingJob = { documentId: job.documentId, workspaceId: job.workspaceId };
  await redis.rpush(
    EMBEDDING_QUEUE,
    JSON.stringify(payload)
  );
};

/** Number of jobs currently waiting in the embedding queue. */
export const getEmbeddingQueueLength = async (): Promise<number> => {
  return redis.llen(EMBEDDING_QUEUE);
};
