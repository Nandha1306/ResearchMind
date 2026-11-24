import { readBoundedIntEnv } from "../../../../packages/shared/config/bounded-env";

/**
 * Time limits for every external call ai-service makes (ISS-037, ARC-013).
 *
 * Read on each use (cheap) so a value can be changed in tests without
 * reloading modules. Invalid values fall back to the defaults with a one-time
 * warning (packages/shared/config/bounded-env.ts).
 *
 *   VOYAGE_DOCUMENT_TIMEOUT_MS  30000   one document-embedding batch
 *   VOYAGE_QUERY_TIMEOUT_MS     15000   one query embedding
 *   PINECONE_TIMEOUT_MS         20000   one upsert / delete / query call
 *   DOCUMENT_SOURCE_TIMEOUT_MS  30000   fetching a document's text from document-service
 *   EMBEDDING_JOB_TIMEOUT_MS    600000  whole embedding job (watchdog); must stay
 *                                       below document-service's 15 min claim lease
 *   LLM_REQUEST_TIMEOUT_MS      60000   one LLM request
 *   LLM_STREAM_IDLE_TIMEOUT_MS  30000   longest gap between streamed tokens
 *   SSE_HEARTBEAT_MS            15000   keep-alive comment frames on AI answer streams
 */
export const timeouts = {
  voyageDocumentMs: () => readBoundedIntEnv("VOYAGE_DOCUMENT_TIMEOUT_MS", 30_000, 1_000, 300_000),
  voyageQueryMs: () => readBoundedIntEnv("VOYAGE_QUERY_TIMEOUT_MS", 15_000, 1_000, 120_000),
  pineconeMs: () => readBoundedIntEnv("PINECONE_TIMEOUT_MS", 20_000, 1_000, 120_000),
  documentSourceMs: () => readBoundedIntEnv("DOCUMENT_SOURCE_TIMEOUT_MS", 30_000, 1_000, 120_000),
  embeddingJobMs: () => readBoundedIntEnv("EMBEDDING_JOB_TIMEOUT_MS", 600_000, 10_000, 840_000),
  llmRequestMs: () => readBoundedIntEnv("LLM_REQUEST_TIMEOUT_MS", 60_000, 1_000, 600_000),
  llmStreamIdleMs: () => readBoundedIntEnv("LLM_STREAM_IDLE_TIMEOUT_MS", 30_000, 1_000, 600_000),
  sseHeartbeatMs: () => readBoundedIntEnv("SSE_HEARTBEAT_MS", 15_000, 1_000, 60_000),
};

/** A provider call did not finish within its time limit. */
export class ProviderTimeoutError extends Error {
  constructor(public readonly operation: string, public readonly timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs} ms`);
    this.name = "ProviderTimeoutError";
  }
}

/**
 * Settle with `promise`, or reject with ProviderTimeoutError after `ms`. The
 * timer is always cleared. The underlying call cannot always be cancelled;
 * its late result is ignored.
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, operation: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(operation, ms)), ms);
  });
  // A late rejection of the abandoned call must not become unhandled.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
