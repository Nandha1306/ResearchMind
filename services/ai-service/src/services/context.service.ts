import { RetrievedChunk } from "../types/query.types";

export interface RagContext {
  text: string;
  sources: RetrievedChunk[];
}

/** Format retrieved vector chunks into an LLM-ready context block with source numbers. */
export const buildRagContext = (chunks: RetrievedChunk[]): RagContext => {
  if (!chunks || chunks.length === 0) {
    return {
      text: "No relevant document chunks found in this workspace.",
      sources: [],
    };
  }

  const text = chunks
    .map((chunk, index) => {
      return [
        `[Source ${index + 1}]`,
        `Document ID: ${chunk.documentId}`,
        `Chunk Index: ${chunk.chunkIndex}`,
        `File Type: ${chunk.fileType}`,
        `Relevance Score: ${chunk.score.toFixed(4)}`,
        "",
        chunk.text,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return {
    text,
    sources: chunks,
  };
};
