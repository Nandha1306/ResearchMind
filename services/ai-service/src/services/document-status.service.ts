const documentServiceUrl =
  process.env.DOCUMENT_SERVICE_URL ||
  "http://localhost:5003";

export type EmbeddingStatus =
  | "pending"
  | "indexing"
  | "indexed"
  | "failed";

/** Request timeout for calls to document-service's internal surface. */
const INTERNAL_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Error from document-service's internal API, carrying the HTTP status so the
 * worker can tell "document deleted" (404/410) from an outage.
 */
export class DocumentServiceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DocumentServiceError";
  }
}

/** True when document-service reports the document is gone or being deleted. */
export const isDocumentGoneError = (error: unknown): boolean =>
  error instanceof DocumentServiceError && (error.status === 404 || error.status === 410);

/** True when another worker has taken over this document's claim. */
export const isClaimSupersededError = (error: unknown): boolean =>
  error instanceof DocumentServiceError && error.status === 409;

/** Worth retrying: network failures and 5xx, not 4xx decisions. */
export const isTransientDocumentServiceError = (error: unknown): boolean =>
  !(error instanceof DocumentServiceError) || error.status >= 500;

/**
 * This is a service-to-service call: the embedding worker runs on a queue and
 * has no end user, so there is no JWT to forward. It authenticates against the
 * /internal surface with the shared INTERNAL_SERVICE_TOKEN, sent as a header --
 * never in the URL or a query string, and never logged.
 */
const internalRequest = async (
  method: "PATCH" | "POST",
  path: string,
  body?: unknown
): Promise<Response> => {
  const internalToken =
    process.env.INTERNAL_SERVICE_TOKEN;

  if (!internalToken) {
    throw new Error(
      "INTERNAL_SERVICE_TOKEN is not configured; cannot reach document-service"
    );
  }

  return fetch(`${documentServiceUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": internalToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(INTERNAL_REQUEST_TIMEOUT_MS),
  });
};

const toError = async (response: Response, action: string): Promise<DocumentServiceError> => {
  /*
   * The status line is enough to diagnose an internal-auth failure. The
   * response body is deliberately not interpolated for 401/403 so a
   * misconfigured secret cannot end up echoed into logs.
   */
  if (response.status === 401 || response.status === 403) {
    return new DocumentServiceError(
      `Failed to ${action}: ${response.status} internal authentication rejected`,
      response.status
    );
  }
  const responseText = await response.text().catch(() => "");
  return new DocumentServiceError(
    `Failed to ${action}: ${response.status} ${responseText.slice(0, 300)}`,
    response.status
  );
};

/**
 * Update a document's embedding status through document-service.
 * `claimToken` is the fencing token from the claim: the update only applies
 * while that claim is still current (409 otherwise).
 */
export const updateDocumentEmbeddingStatus = async (
  documentId: string,
  status: EmbeddingStatus,
  error?: string,
  claimToken?: number
) => {
  const response = await internalRequest(
    "PATCH",
    `/internal/documents/${encodeURIComponent(documentId)}/embedding-status`,
    {
      status,
      ...(error ? { error } : {}),
      ...(claimToken !== undefined ? { claimToken } : {}),
    }
  );

  if (!response.ok) {
    throw await toError(response, "update document embedding status");
  }

  return response.json();
};

export type ClaimOutcome =
  | { claimed: true; claimToken: number; workspaceId: string }
  | { claimed: false; reason: string };

/**
 * Atomically claim a document before processing it. Only a successful claim
 * may be processed: duplicate deliveries, documents already being processed
 * by another worker, deleted documents and documents past their retry limit
 * are reported as not claimed (and must be skipped, not failed).
 */
export const claimDocumentForEmbedding = async (
  documentId: string
): Promise<ClaimOutcome> => {
  const response = await internalRequest(
    "POST",
    `/internal/documents/${encodeURIComponent(documentId)}/embedding/claim`
  );

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as {
      data?: { claimToken?: unknown; workspaceId?: unknown };
    } | null;
    const claimToken = body?.data?.claimToken;
    const claimedWorkspace = body?.data?.workspaceId;
    // Never process without a fencing token and the document's workspace:
    // unfenced status updates and an unchecked namespace are exactly what the
    // claim exists to prevent. The claim then expires and the sweep retries.
    if (!Number.isInteger(claimToken) || typeof claimedWorkspace !== "string" || !claimedWorkspace) {
      throw new DocumentServiceError(
        "Failed to claim document for embedding: response had no claim token or workspace",
        502
      );
    }
    return { claimed: true, claimToken: claimToken as number, workspaceId: claimedWorkspace };
  }

  if (response.status === 404 || response.status === 409 || response.status === 410) {
    const body = (await response.clone().json().catch(() => null)) as { reason?: string } | null;
    // Only a decision from the claim endpoint carries a `reason`. A bare 404
    // means the endpoint itself is missing (e.g. an older document-service):
    // that is a deployment error, not "document deleted" -- never skip jobs
    // silently because of it.
    if (body?.reason) {
      return { claimed: false, reason: body.reason };
    }
  }

  throw await toError(response, "claim document for embedding");
};
