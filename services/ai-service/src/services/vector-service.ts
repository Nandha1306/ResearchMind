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

  const PINECONE_BATCH_SIZE = 100;

  for (
    let start = 0;
    start < vectors.length;
    start += PINECONE_BATCH_SIZE
  ) {
    const batch = vectors.slice(
        start,
        start + PINECONE_BATCH_SIZE
  );

  await pineconeIndex
    .namespace(workspaceId)
    .upsert(batch);

    console.log(
        `Upserted Pinecone vectors ${start}-${
        start + batch.length - 1
        }`
    );
  }

  return {
    documentId,
    workspaceId,
    vectorCount: vectors.length,
  };
};

/** Delete all existing vectors belonging to a document. */
export const deleteDocumentEmbeddings = async (
  workspaceId: string,
  documentId: string
) => {
  try {
    await pineconeIndex
      .namespace(workspaceId)
      .deleteMany({
        documentId: {
          $eq: documentId,
        },
      });
  } catch (error: any) {
    const is404 =
      error?.name === "PineconeNotFoundError" ||
      error?.status === 404 ||
      (typeof error?.message === "string" && error.message.includes("404"));

    if (is404) {
      console.log(
        `No existing vectors found in namespace "${workspaceId}" for document "${documentId}" (404 ignored)`
      );
      return;
    }

    throw error;
  }
};