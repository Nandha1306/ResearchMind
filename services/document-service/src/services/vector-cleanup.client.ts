/**
 * Client for ai-service's internal vector-cleanup endpoint.
 *
 * document-service owns documents but not the vector store, so removing a
 * document's chunks from Pinecone is delegated to ai-service over the
 * internal (non-gateway) surface, authenticated with the shared
 * INTERNAL_SERVICE_TOKEN header (never logged, never in the URL).
 *
 * The workspaceId/documentId passed here must come from the stored document
 * record, never from the client: they select the Pinecone namespace and the
 * metadata filter.
 */
const VECTOR_CLEANUP_TIMEOUT_MS = 15_000;

export const deleteDocumentVectors = async (
  workspaceId: string,
  documentId: string
): Promise<void> => {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new Error("INTERNAL_SERVICE_TOKEN is not configured; cannot remove document vectors");
  }

  const aiServiceUrl = process.env.AI_SERVICE_URL || "http://127.0.0.1:5006";
  const url =
    `${aiServiceUrl}/internal/vectors/workspaces/${encodeURIComponent(workspaceId)}` +
    `/documents/${encodeURIComponent(documentId)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: { "X-Internal-Token": internalToken },
    signal: AbortSignal.timeout(VECTOR_CLEANUP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Vector cleanup failed with status ${response.status}`);
  }
};
