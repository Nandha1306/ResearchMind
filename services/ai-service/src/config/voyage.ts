import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";

const apiKey = process.env.VOYAGE_API_KEY;

if (!apiKey) {
  throw new Error("VOYAGE_API_KEY is not configured");
}

export const VOYAGE_MODEL = process.env.VOYAGE_MODEL || "voyage-4";

export const VOYAGE_EMBEDDING_DIMENSION = Number(
  process.env.VOYAGE_EMBEDDING_DIMENSION || 1024
);

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