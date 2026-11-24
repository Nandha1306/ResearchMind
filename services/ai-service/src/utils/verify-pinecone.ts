import { pinecone, PINECONE_INDEX_NAME } from "../config/pinecone";
import { VOYAGE_EMBEDDING_DIMENSION } from "../config/voyage";

/** The parts of a Pinecone index description this check relies on. */
export interface IndexDescription {
  name?: string;
  dimension?: number;
  metric?: string;
}

/**
 * Compare the configured embedding dimension with the index. Pure, so it can
 * be unit-tested without network access.
 */
export const checkIndexCompatibility = (
  indexes: IndexDescription[] | undefined,
  indexName: string,
  expectedDimension: number
): { ok: true; index: IndexDescription } | { ok: false; reason: string } => {
  const index = indexes?.find((item) => item.name === indexName);

  if (!index) {
    return { ok: false, reason: `Pinecone index "${indexName}" was not found` };
  }

  if (index.dimension !== expectedDimension) {
    return {
      ok: false,
      reason:
        `Pinecone index "${indexName}" has dimension ${index.dimension}, but ` +
        `VOYAGE_EMBEDDING_DIMENSION is ${expectedDimension}. Embeddings would be rejected ` +
        "or compared against incompatible vectors.",
    };
  }

  return { ok: true, index };
};

/**
 * Startup check (ai-service and the standalone worker).
 *
 * - Index found with a different dimension, or not found: throws (the caller
 *   refuses to start) -- every embedding would be rejected or meaningless.
 * - Pinecone rejects the API key (401): throws too (RT-006).
 * - Pinecone unreachable: logs a warning and returns "unverified"; vector
 *   operations will report their own errors, and a transient network issue
 *   must not keep the service down.
 */
export const validateVectorIndexAtStartup = async (): Promise<"verified" | "unverified"> => {
  let indexes: IndexDescription[] | undefined;
  try {
    // Bounded: a hanging control-plane call must not block startup.
    indexes = (
      await Promise.race([
        pinecone.listIndexes(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timed out after 10 s")), 10_000).unref()
        ),
      ])
    ).indexes;
  } catch (error) {
    // RT-006: a rejected key (401) is not transient -- every vector operation
    // would fail. Refuse to start with a clear message (no key value). The
    // SDK maps 403 to PineconeBadRequestError, so only 401 is decisive here.
    if ((error as Error)?.name === "PineconeAuthorizationError") {
      throw new Error("Pinecone rejected PINECONE_API_KEY (invalid or revoked credentials); fix the key and restart");
    }
    console.warn(
      `[ai-service] Could not verify the Pinecone index at startup; continuing: ${(error as Error)?.message}`
    );
    return "unverified";
  }

  const result = checkIndexCompatibility(indexes, PINECONE_INDEX_NAME, VOYAGE_EMBEDDING_DIMENSION);
  if (!result.ok) {
    throw new Error(result.reason);
  }

  console.log(
    `[ai-service] Pinecone index "${PINECONE_INDEX_NAME}" verified (dimension ${result.index.dimension})`
  );
  return "verified";
};
