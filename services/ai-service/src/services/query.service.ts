import { generateQueryEmbedding } from "./query-embedding.service";
import { searchWorkspace } from "./retrieval.service";
import { RetrievedChunk } from "../types/query.types";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 10;

/** Execute semantic search for a workspace. */
export const semanticSearch = async ({
  workspaceId,
  query,
  topK = DEFAULT_TOP_K,
}: {
  workspaceId: string;
  query: string;
  topK?: number;
}): Promise<RetrievedChunk[]> => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("Search query cannot be empty");
  }

  const safeTopK = Math.min(Math.max(topK, 1), MAX_TOP_K);

  const queryVector = await generateQueryEmbedding(normalizedQuery);

  return searchWorkspace(workspaceId, queryVector, safeTopK);
};
