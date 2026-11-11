const documentServiceUrl =
  process.env.DOCUMENT_SERVICE_URL ||
  "http://localhost:5003";

export type EmbeddingStatus =
  | "pending"
  | "indexing"
  | "indexed"
  | "failed";

/**
 * Update a document's embedding status through document-service.
 *
 * This is a service-to-service call: the embedding worker runs on a queue and
 * has no end user, so there is no JWT to forward. It authenticates against the
 * /internal surface with the shared INTERNAL_SERVICE_TOKEN, sent as a header --
 * never in the URL or a query string, and never logged.
 */
export const updateDocumentEmbeddingStatus = async (
  documentId: string,
  status: EmbeddingStatus
) => {
  const internalToken =
    process.env.INTERNAL_SERVICE_TOKEN;

  if (!internalToken) {
    throw new Error(
      "INTERNAL_SERVICE_TOKEN is not configured; cannot update document embedding status"
    );
  }

  const response = await fetch(
    `${documentServiceUrl}/internal/documents/${documentId}/embedding-status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalToken,
      },
      body: JSON.stringify({
        status,
      }),
    }
  );

  if (!response.ok) {
    /*
     * The status line is enough to diagnose an internal-auth failure. The
     * response body is deliberately not interpolated for 401/403 so a
     * misconfigured secret cannot end up echoed into logs.
     */
    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(
        `Failed to update document embedding status: ${response.status} internal authentication rejected`
      );
    }

    const responseText = await response.text();

    throw new Error(
      `Failed to update document embedding status: ${response.status} ${responseText}`
    );
  }

  return response.json();
};
