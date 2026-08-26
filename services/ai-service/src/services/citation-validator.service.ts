/**
 * Citation integrity checks for generated answers.
 *
 * The retrieval layer is the ONLY source of citations: every entry in the
 * `sources` SSE payload is built from Pinecone match metadata, so a source
 * object can never be invented. What the model *can* do is write a
 * `[Source N]` marker in its prose that points at a source that was never
 * retrieved — including when nothing was retrieved at all.
 *
 * These helpers detect that. They deliberately do not rewrite the answer:
 * silently editing model output would hide the problem rather than surface it.
 */

/** Matches the `[Source 3]` marker format defined in rag.prompt.ts. */
const SOURCE_MARKER = /\[\s*Source\s+(\d+)\s*\]/gi;

export interface CitationAudit {
  /** Distinct source numbers the answer referenced, in ascending order. */
  cited: number[];
  /**
   * Referenced numbers with no corresponding retrieved chunk.
   *
   * With zero retrieved sources, every marker lands here — which is exactly the
   * "no retrieved source, no claim of source" rule.
   */
  unverified: number[];
}

/**
 * Compare the `[Source N]` markers in an answer against the number of chunks
 * that were actually retrieved and passed to the model.
 *
 * `retrievedCount` is the length of the sources array emitted to the client;
 * markers are 1-indexed to match buildRagContext().
 */
export const auditAnswerCitations = (
  answer: string,
  retrievedCount: number
): CitationAudit => {
  if (!answer) {
    return { cited: [], unverified: [] };
  }

  const cited = new Set<number>();

  for (const match of answer.matchAll(SOURCE_MARKER)) {
    const index = Number(match[1]);
    if (Number.isInteger(index)) {
      cited.add(index);
    }
  }

  const citedSorted = [...cited].sort((a, b) => a - b);

  const unverified = citedSorted.filter(
    (index) => index < 1 || index > retrievedCount
  );

  return { cited: citedSorted, unverified };
};
