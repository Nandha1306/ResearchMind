import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";

const apiKey = process.env.VOYAGE_API_KEY;

if (!apiKey) {
  throw new Error("VOYAGE_API_KEY is not configured");
}

/**
 * Embedding model used when VOYAGE_MODEL is not set.
 *
 * Pinned to the model the existing local configuration (services/ai-service/
 * .env and .env.example) uses. Queries must be embedded with the same model as
 * the stored vectors, so this must not drift: set VOYAGE_MODEL explicitly in
 * every environment, and re-index all documents whenever it changes. The model
 * is recorded on every stored vector (metadata `embeddingModel`).
 */
export const DEFAULT_VOYAGE_MODEL = "voyage-3";
export const DEFAULT_EMBEDDING_DIMENSION = 1024;

/**
 * Parse and validate embedding configuration. Pure (takes the env as input)
 * so it can be unit-tested. Throws a clear, actionable error on bad values;
 * the values themselves are not secret.
 */
export const resolveEmbeddingConfig = (
  env: Record<string, string | undefined>
): { model: string; dimension: number; modelIsDefault: boolean } => {
  const configuredModel = env.VOYAGE_MODEL?.trim();
  const model = configuredModel || DEFAULT_VOYAGE_MODEL;

  const rawDimension = env.VOYAGE_EMBEDDING_DIMENSION?.trim();
  const dimension = rawDimension ? Number(rawDimension) : DEFAULT_EMBEDDING_DIMENSION;
  if (!Number.isInteger(dimension) || dimension <= 0 || dimension > 8192) {
    throw new Error(
      `VOYAGE_EMBEDDING_DIMENSION must be a positive integer (got "${rawDimension}"). ` +
        "It must match the dimension of the Pinecone index."
    );
  }

  return { model, dimension, modelIsDefault: !configuredModel };
};

const embeddingConfig = resolveEmbeddingConfig(process.env);

export const VOYAGE_MODEL = embeddingConfig.model;
export const VOYAGE_EMBEDDING_DIMENSION = embeddingConfig.dimension;
export const VOYAGE_MODEL_IS_DEFAULT = embeddingConfig.modelIsDefault;

export const voyageEmbeddings = new VoyageEmbeddings({
  apiKey,
  modelName: VOYAGE_MODEL,
  inputType: "document",
  outputDimension: VOYAGE_EMBEDDING_DIMENSION,
  batchSize: 8,
});

export const voyageQueryEmbeddings = new VoyageEmbeddings({
  apiKey,
  modelName: VOYAGE_MODEL,
  inputType: "query",
  outputDimension: VOYAGE_EMBEDDING_DIMENSION,
});
