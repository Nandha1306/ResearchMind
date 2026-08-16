import { pineconeIndex } from "../config/pinecone";
import { EmbeddingResult } from "./embedding.service";

interface VectorMetadata {
  [key: string]: string | number | boolean;

  documentId: string;
  workspaceId: string;
  uploadedBy: string;
  fileType: string;
  chunkIndex: number;
  text: string;
}

/** Build the Pinecone vector ID for a document chunk. */
const createVectorId = (
  documentId: string,
  chunkIndex: number
): string => {
  return `${documentId}-chunk-${chunkIndex}`;
};

/** Store document chunk embeddings inside the workspace namespace. */
export const upsertDocumentEmbeddings = async ({
  documentId,
  workspaceId,
  uploadedBy,
  fileType,
  chunks,
  embeddings,
}: {
  documentId: string;
  workspaceId: string;
  uploadedBy: string;
  fileType: "pdf" | "docx";
  chunks: {
    index: number;
    text: string;
  }[];
  embeddings: EmbeddingResult[];
}) => {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Chunk and embedding count mismatch. Chunks: ${chunks.length}, Embeddings: ${embeddings.length}`
    );
  }

  const vectors = embeddings.map((result) => {
    const chunk = chunks[result.index];

    if (!chunk) {
      throw new Error(
        `Missing chunk for embedding index ${result.index}`
      );
    }

    const metadata: VectorMetadata = {
      documentId,
      workspaceId,
      uploadedBy,
      chunkIndex: result.index,
      text: chunk.text,
      fileType,
    };

    return {
      id: createVectorId(
        documentId,
        result.index
      ),
      values: result.embedding,
      metadata,
    };
  });

  await pineconeIndex
    .namespace(workspaceId)
    .upsert(vectors);

  return {
    documentId,
    workspaceId,
    vectorCount: vectors.length,
  };
};