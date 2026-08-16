import { voyageEmbeddings, VOYAGE_EMBEDDING_DIMENSION, VOYAGE_MODEL } from "../config/voyage";

const EMBEDDING_BATCH_SIZE = 20;

interface EmbeddingResult {
  index: number;
  embedding: number[];
}

/** Generate Voyage embeddings for a batch of document chunks. */
const embedBatch = async (
  texts: string[]
): Promise<number[][]> => {
  if (texts.length === 0) {
    return [];
  }

  return voyageEmbeddings.embedDocuments(texts);
};

/** Generate embeddings for all document chunks in controlled batches. */
export const generateEmbeddings = async (
  chunks: string[]
): Promise<EmbeddingResult[]> => {
  if (chunks.length === 0) {
    return [];
  }

  const results: EmbeddingResult[] = [];

  for (
    let start = 0;
    start < chunks.length;
    start += EMBEDDING_BATCH_SIZE
  ) {
    const batch = chunks.slice(
      start,
      start + EMBEDDING_BATCH_SIZE
    );

    console.log(
      `Generating embeddings for chunks ${start}-${
        start + batch.length - 1
      } using ${VOYAGE_MODEL}`
    );

    const embeddings =
      await embedBatch(batch);

    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch. Expected ${batch.length}, received ${embeddings.length}`
      );
    }

    embeddings.forEach(
      (embedding, batchIndex) => {
        if (
          embedding.length !==
          VOYAGE_EMBEDDING_DIMENSION
        ) {
          throw new Error(
            `Invalid embedding dimension for chunk ${
              start + batchIndex
            }. Expected ${VOYAGE_EMBEDDING_DIMENSION}, received ${embedding.length}`
          );
        }

        results.push({
          index: start + batchIndex,
          embedding,
        });
      }
    );
  }

  return results;
};