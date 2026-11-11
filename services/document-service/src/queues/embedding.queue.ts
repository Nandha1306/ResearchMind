import redis from "../config/redis";

export const EMBEDDING_QUEUE = "researchmind:embedding:jobs";

export interface EmbeddingJob {
  documentId: string;
  workspaceId: string;
  uploadedBy: string;
  extractedText: string;
  fileType: "pdf" | "docx";
}

/** Add a document to the embedding processing queue. */
export const addEmbeddingJob = async (
  job: EmbeddingJob
) => {
  await redis.rpush(
    EMBEDDING_QUEUE,
    JSON.stringify(job)
  );
};

/** Number of jobs currently waiting in the embedding queue. */
export const getEmbeddingQueueLength = async (): Promise<number> => {
  return redis.llen(EMBEDDING_QUEUE);
};
