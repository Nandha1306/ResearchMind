import type { DocumentItem } from "../types/document.types";

/**
 * Document processing status helpers (P1-A22). The backend status is the
 * source of truth; these only decide how often to re-read it and which
 * actions to offer. Framework-free so they can be unit-tested.
 */

/** Poll this often while a document is actively being processed. */
export const ACTIVE_POLL_INTERVAL_MS = 5_000;

/** ...and this often while the only unfinished documents look stuck. */
export const STALLED_POLL_INTERVAL_MS = 60_000;

/**
 * Matches the server: an `indexing` claim older than this is considered
 * abandoned (document-service STALE_INDEXING_MS) and may be re-indexed.
 */
export const STALE_PROCESSING_MS = 15 * 60 * 1000;

const isUnfinished = (doc: Pick<DocumentItem, "embeddingStatus">) =>
  doc.embeddingStatus === "pending" || doc.embeddingStatus === "indexing";

const ageOf = (timestamp: string | undefined, now: number) => {
  const time = Date.parse(timestamp ?? "");
  return Number.isNaN(time) ? Infinity : now - time;
};

/** A pending document touched this recently was just (re-)queued. */
const RECENTLY_QUEUED_MS = 2 * 60 * 1000;

/**
 * Unfinished, with no real progress for longer than the server's stale window.
 *  - indexing: the claim (updatedAt) is older than the stale window.
 *  - pending:  created more than the stale window ago and not just re-queued.
 *    (updatedAt alone is not enough: the server's recovery sweep touches
 *    waiting documents every few minutes, so it never looks old.)
 */
export const isProcessingStalled = (
  doc: Pick<DocumentItem, "embeddingStatus" | "updatedAt"> & { createdAt?: string },
  now: number = Date.now()
) => {
  if (doc.embeddingStatus === "indexing") {
    return ageOf(doc.updatedAt, now) > STALE_PROCESSING_MS;
  }
  if (doc.embeddingStatus === "pending") {
    return (
      ageOf(doc.createdAt ?? doc.updatedAt, now) > STALE_PROCESSING_MS &&
      ageOf(doc.updatedAt, now) > RECENTLY_QUEUED_MS
    );
  }
  return false;
};

/**
 * How often to re-fetch the document list: fast while something is being
 * processed, slowly while the only unfinished documents are stalled, and not
 * at all once every document has reached a final state.
 */
export const documentPollInterval = (
  docs: Array<Pick<DocumentItem, "embeddingStatus" | "updatedAt"> & { createdAt?: string }> | undefined,
  now: number = Date.now()
): number | false => {
  const unfinished = (docs ?? []).filter(isUnfinished);
  if (unfinished.length === 0) return false;
  return unfinished.some((doc) => !isProcessingStalled(doc, now))
    ? ACTIVE_POLL_INTERVAL_MS
    : STALLED_POLL_INTERVAL_MS;
};

/**
 * Re-indexing is offered for failed documents, and for documents whose
 * processing has stalled. Not for documents still being processed normally:
 * the server refuses a live claim (409) and re-queuing a waiting document only
 * duplicates its job.
 */
export const canRetryDocument = (
  doc: Pick<DocumentItem, "embeddingStatus" | "updatedAt"> & { createdAt?: string },
  now: number = Date.now()
) => doc.embeddingStatus === "failed" || isProcessingStalled(doc, now);

export interface IndexingSummary {
  total: number;
  indexed: number;
  processing: number;
  failed: number;
}

/** Counts behind the overview "Sources Indexed" metric (P1-A25). */
export const summarizeIndexing = (
  docs: Array<Pick<DocumentItem, "embeddingStatus">>
): IndexingSummary => ({
  total: docs.length,
  indexed: docs.filter((doc) => doc.embeddingStatus === "indexed").length,
  processing: docs.filter(isUnfinished).length,
  failed: docs.filter((doc) => doc.embeddingStatus === "failed").length,
});

/** The metric's subtext: only claims "all searchable" when that is true. */
export const describeIndexing = (summary: IndexingSummary): string => {
  if (summary.total === 0) return "No documents uploaded yet";
  const parts: string[] = [];
  if (summary.processing > 0) parts.push(`${summary.processing} processing`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  return parts.length > 0 ? parts.join(", ") : "All sources indexed & searchable";
};

/** Failure reasons written by ResearchMind itself, safe to show as-is. */
const USER_FACING_FAILURE_REASONS = [
  /^Document contains no usable text$/,
  /^Indexing failed after \d+ attempts$/,
  /^Could not queue the document for indexing$/,
  /^Indexing failed$/,
];

export const GENERIC_FAILURE_REASON = "Processing failed. You can retry indexing.";

/**
 * The failure reason shown on a document card. Only reasons ResearchMind
 * writes itself are shown verbatim; anything else (e.g. a raw provider or
 * network error, which can name internal hosts) is replaced by a generic text.
 */
export const failureReasonForDisplay = (embeddingError: string | null | undefined): string => {
  const reason = (embeddingError ?? "").trim();
  return USER_FACING_FAILURE_REASONS.some((pattern) => pattern.test(reason))
    ? reason
    : GENERIC_FAILURE_REASON;
};
