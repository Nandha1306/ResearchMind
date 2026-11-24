import { pineconeIndex } from "../config/pinecone";
import { timeouts, withTimeout } from "../config/timeouts";
import { VOYAGE_MODEL } from "../config/voyage";
import { readBoundedFloatEnv } from "../../../../packages/shared/config/bounded-env";
import { fetchLiveDocumentIds } from "./document-status.service";
import { RetrievedChunk } from "../types/query.types";

/**
 * Minimum relevance score for a retrieved chunk (ISS-028). Matches below it
 * are dropped; if none remain, the answer uses the existing "no relevant
 * context" path. Default 0.2 (cosine similarity, voyage-3): it removes only
 * clearly unrelated chunks. It is NOT calibrated against an evaluation set;
 * tune MIN_RELEVANCE_SCORE (0..1) per deployment. 0 disables the cut-off.
 */
export const DEFAULT_MIN_RELEVANCE_SCORE = 0.2;
export const minRelevanceScore = () =>
  readBoundedFloatEnv("MIN_RELEVANCE_SCORE", DEFAULT_MIN_RELEVANCE_SCORE, 0, 1);

type Match = { score?: number; metadata?: Record<string, unknown> | null };

/**
 * Keep only matches that can be used (pure; exported for tests):
 *  - with a numeric score and metadata;
 *  - at or above `minScore` (ISS-028);
 *  - whose stored `embeddingModel` equals the configured model (ISS-027):
 *    vectors from another model are not comparable. Vectors WITHOUT the label
 *    (indexed before the label existed, 2026-11-11, with the then-pinned
 *    voyage-3) are kept; re-index them to label them.
 */
export const selectUsableMatches = <T extends Match>(
  matches: T[],
  { model, minScore }: { model: string; minScore: number }
): T[] => {
  let wrongModel = 0;
  const kept = matches.filter((match) => {
    if (typeof match.score !== "number" || !match.metadata) return false;
    const label = match.metadata.embeddingModel;
    if (typeof label === "string" && label !== "" && label !== model) {
      wrongModel++;
      return false;
    }
    return match.score >= minScore;
  });
  if (wrongModel > 0) {
    console.warn(`[ai-service] Ignored ${wrongModel} match(es) embedded with another model than ${model}; re-index those documents`);
  }
  return kept;
};

/** Search a workspace namespace for semantically relevant document chunks. */
export const searchWorkspace = async (
  workspaceId: string,
  queryVector: number[],
  topK: number
): Promise<RetrievedChunk[]> => {
  const result = await withTimeout(
    pineconeIndex.namespace(workspaceId).query({
      vector: queryVector,
      topK,
      includeMetadata: true,
    }),
    timeouts.pineconeMs(),
    "Pinecone query"
  );

  console.log(`Pinecone query matches count: ${result.matches?.length}`);

  const chunks = selectUsableMatches(result.matches ?? [], {
    model: VOYAGE_MODEL,
    minScore: minRelevanceScore(),
  }).map((match) => ({
    documentId: String(match.metadata!.documentId ?? ""),
    workspaceId: String(match.metadata!.workspaceId ?? workspaceId),
    chunkIndex: Number(match.metadata!.chunkIndex ?? 0),
    text: String(match.metadata!.text ?? ""),
    score: match.score as number,
    fileType: (String(match.metadata!.fileType ?? "pdf")) as "pdf" | "docx",
  }));

  /*
   * Drop matches whose document no longer exists, is (being) deleted, or
   * belongs to another workspace -- checked against document-service's
   * records in ONE batched call per request (SEC-012 retrieval side). A vector
   * can outlive its document (e.g. an upsert that timed out and landed after
   * the deletion removed the vectors); its text must never be returned,
   * placed in a prompt or cited. If the check cannot run, the error
   * propagates: retrieval fails closed. The same call returns each document's
   * title, used to label the source in the prompt (ISS-029).
   */
  const candidates = chunks.filter((chunk) => chunk.workspaceId === workspaceId && chunk.documentId);
  const live = await fetchLiveDocumentIds(workspaceId, [...new Set(candidates.map((c) => c.documentId))]);
  const kept: RetrievedChunk[] = candidates
    .filter((chunk) => live.has(chunk.documentId))
    .map((chunk) => {
      const title = live.get(chunk.documentId);
      return title ? { ...chunk, title } : chunk;
    });
  if (kept.length !== chunks.length) {
    console.warn(
      `[ai-service] Dropped ${chunks.length - kept.length} retrieval match(es) of deleted or foreign documents`
    );
  }
  return kept;
};
