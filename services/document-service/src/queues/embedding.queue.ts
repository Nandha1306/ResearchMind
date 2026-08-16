import redis from "../config/redis";

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
    "researchmind:embedding:jobs",
    JSON.stringify(job)
  );
};