const documentServiceUrl =
  process.env.DOCUMENT_SERVICE_URL ||
  "http://localhost:5003";

export type EmbeddingStatus =
  | "pending"
  | "indexing"
  | "indexed"
  | "failed";

/** Update a document's embedding status through document-service REST API. */
export const updateDocumentEmbeddingStatus = async (
  documentId: string,
  status: EmbeddingStatus
) => {
  const response = await fetch(
    `${documentServiceUrl}/api/documents/${documentId}/embedding-status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status,
      }),
    }
  );

  if (!response.ok) {
    const responseText = await response.text();

    throw new Error(
      `Failed to update document embedding status: ${response.status} ${responseText}`
    );
  }

  return response.json();
};
