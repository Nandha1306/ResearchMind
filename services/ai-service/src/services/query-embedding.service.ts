import { voyageQueryEmbeddings } from "../config/voyage";

/** Generate a semantic embedding for a user's search query. */
export const generateQueryEmbedding = async (
  query: string
): Promise<number[]> => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("Search query cannot be empty");
  }

  const embedding = await voyageQueryEmbeddings.embedQuery(normalizedQuery);

  const expectedDimension = Number(
    process.env.VOYAGE_EMBEDDING_DIMENSION || 1024
  );

  if (embedding.length !== expectedDimension) {
    throw new Error(
      `Invalid query embedding dimension: expected ${expectedDimension}, received ${embedding.length}`
    );
  }

  return embedding;
};
