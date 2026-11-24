import { timeouts } from "../config/timeouts";

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
  method: "PATCH" | "POST" | "GET",
  path: string,
  body?: unknown,
  timeoutMs: number = INTERNAL_REQUEST_TIMEOUT_MS
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
    signal: AbortSignal.timeout(timeoutMs),
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

export interface EmbeddingSource {
  workspaceId: string;
  uploadedBy: string;
  fileType: "pdf" | "docx";
  extractedText: string;
}

/**
 * Fetch the text to embed (and the uploader / file type written into vector
 * metadata) for the CURRENT claim (SEC-006). Queue jobs are pointers only;
 * nothing a job carries is trusted. document-service answers 409 when the
 * claim is no longer current (-> superseded), 404/410 when the document is
 * gone, 403 when it belongs to another workspace than the job names.
 */
export const fetchEmbeddingSource = async (
  documentId: string,
  workspaceId: string,
  claimToken: number
): Promise<EmbeddingSource> => {
  const query = new URLSearchParams({ workspaceId, claimToken: String(claimToken) });
  const response = await internalRequest(
    "GET",
    `/internal/documents/${encodeURIComponent(documentId)}/embedding-source?${query}`,
    undefined,
    timeouts.documentSourceMs()
  );

  if (!response.ok) {
    throw await toError(response, "fetch the document text");
  }

  const data = ((await response.json().catch(() => null)) as { data?: Partial<EmbeddingSource> } | null)?.data;
  if (
    !data ||
    data.workspaceId !== workspaceId ||
    typeof data.uploadedBy !== "string" ||
    (data.fileType !== "pdf" && data.fileType !== "docx") ||
    typeof data.extractedText !== "string"
  ) {
    throw new DocumentServiceError("Failed to fetch the document text: unexpected response", 502);
  }
  return {
    workspaceId: data.workspaceId,
    uploadedBy: data.uploadedBy,
    fileType: data.fileType,
    extractedText: data.extractedText,
  };
};

/**
 * Most ids sent in one live-documents request: document-service refuses more
 * (MAX_LIVE_CHECK_IDS = 200 in its document.controller.ts). Do not raise it
 * here without raising it there.
 */
export const LIVE_CHECK_BATCH_SIZE = 200;

/**
 * Of `documentIds`, the ones that still exist, are not deleted and belong to
 * `workspaceId`. The de-duplicated ids are checked in requests of at most
 * LIVE_CHECK_BATCH_SIZE (W5-L1: a history page can cite up to 1,000
 * documents), one after another, each carrying `workspaceId`, and the answers
 * are merged. Retrieval drops every other match (SEC-012 retrieval side).
 * Throws when ANY request fails: callers fail closed rather than return
 * possibly deleted text or a partially checked page.
 */
export const fetchLiveDocumentIds = async (
  workspaceId: string,
  documentIds: string[]
): Promise<Map<string, string | undefined>> => {
  const unique = [...new Set(documentIds)];
  const merged = new Map<string, string | undefined>();
  for (let start = 0; start < unique.length; start += LIVE_CHECK_BATCH_SIZE) {
    const batch = await fetchLiveDocumentIdsBatch(workspaceId, unique.slice(start, start + LIVE_CHECK_BATCH_SIZE));
    for (const [id, title] of batch) merged.set(id, title);
  }
  return merged;
};

/** One live-documents request (at most LIVE_CHECK_BATCH_SIZE ids). */
const fetchLiveDocumentIdsBatch = async (
  workspaceId: string,
  documentIds: string[]
): Promise<Map<string, string | undefined>> => {
  if (documentIds.length === 0) return new Map();
  const response = await internalRequest("POST", "/internal/documents/live", { workspaceId, documentIds });
  if (!response.ok) {
    throw await toError(response, "check which documents are live");
  }
  const data = ((await response.json().catch(() => null)) as {
    data?: { liveDocumentIds?: unknown; liveDocuments?: unknown };
  } | null)?.data;
  const ids = data?.liveDocumentIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new DocumentServiceError("Failed to check which documents are live: unexpected response", 502);
  }
  // Titles (ISS-029) come from the additive `liveDocuments` field; an older
  // document-service without it still works (titles are then unknown).
  const titles = new Map<string, string>();
  if (Array.isArray(data?.liveDocuments)) {
    for (const entry of data!.liveDocuments as Array<{ id?: unknown; name?: unknown }>) {
      if (typeof entry?.id === "string" && typeof entry?.name === "string") titles.set(entry.id, entry.name);
    }
  }
  return new Map((ids as string[]).map((id) => [id, titles.get(id)]));
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
