import { VOYAGE_EMBEDDING_DIMENSION, VOYAGE_MODEL, VOYAGE_MODEL_IS_DEFAULT } from "./voyage";
import { XAI_MODEL } from "./grok";

/**
 * Log the AI models actually in use at startup (names only -- never keys or
 * URLs carrying credentials), and warn when the embedding model comes from
 * the built-in default instead of explicit configuration.
 */
export const logEffectiveModelConfiguration = () => {
  console.log(
    `[ai-service] Models: llm="${XAI_MODEL}" embeddings="${VOYAGE_MODEL}" (dimension ${VOYAGE_EMBEDDING_DIMENSION})`
  );

  if (VOYAGE_MODEL_IS_DEFAULT) {
    console.warn(
      `[ai-service] VOYAGE_MODEL is not set; using the default "${VOYAGE_MODEL}". ` +
        "Set it explicitly: changing the embedding model requires re-indexing all documents."
    );
  }
};
