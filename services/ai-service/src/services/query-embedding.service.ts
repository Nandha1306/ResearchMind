import { voyageQueryEmbeddings, VOYAGE_EMBEDDING_DIMENSION } from "../config/voyage";

/** Generate a semantic embedding for a user's search query with rate limit retry handling. */
export const generateQueryEmbedding = async (
  query: string
): Promise<number[]> => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("Search query cannot be empty");
  }

  let attempt = 0;
  const maxAttempts = 3;
  let lastError: any = null;

  while (attempt < maxAttempts) {
    try {
      const embedding = await voyageQueryEmbeddings.embedQuery(normalizedQuery);

      // Same validated value used for document embeddings and the index check.
      const expectedDimension = VOYAGE_EMBEDDING_DIMENSION;

      if (embedding.length !== expectedDimension) {
        throw new Error(
          `Invalid query embedding dimension: expected ${expectedDimension}, received ${embedding.length}`
        );
      }

      return embedding;
    } catch (err: any) {
      lastError = err;
      const is429 =
        err?.status === 429 ||
        (typeof err?.message === "string" && err.message.includes("429"));

      if (is429 && attempt < maxAttempts - 1) {
        attempt++;
        const waitMs = attempt * 15000;
        console.warn(`Voyage AI 429 rate limit hit. Retrying query embedding in ${waitMs / 1000}s (attempt ${attempt}/${maxAttempts})...`);
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        throw err;
      }
    }
  }

  throw lastError;
};
