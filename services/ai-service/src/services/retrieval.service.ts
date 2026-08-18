import { pineconeIndex } from "../config/pinecone";
import { RetrievedChunk } from "../types/query.types";

/** Search a workspace namespace for semantically relevant document chunks. */
export const searchWorkspace = async (
  workspaceId: string,
  queryVector: number[],
  topK: number
): Promise<RetrievedChunk[]> => {
  const result = await pineconeIndex.namespace(workspaceId).query({
    vector: queryVector,
    topK,
    includeMetadata: true,
  });

  console.log(`Pinecone query matches count: ${result.matches?.length}`);

  return (result.matches ?? [])
    .filter(
      (match) =>
        typeof match.score === "number" && Boolean(match.metadata)
    )
    .map((match) => ({
      documentId: String(match.metadata!.documentId ?? ""),
      workspaceId: String(match.metadata!.workspaceId ?? workspaceId),
      chunkIndex: Number(match.metadata!.chunkIndex ?? 0),
      text: String(match.metadata!.text ?? ""),
      score: match.score as number,
      fileType: (String(match.metadata!.fileType ?? "pdf")) as "pdf" | "docx",
    }));
};
