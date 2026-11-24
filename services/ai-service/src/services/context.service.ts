import crypto from "crypto";
import { RetrievedChunk } from "../types/query.types";

export interface RagContext {
  text: string;
  sources: RetrievedChunk[];
}

/** Longest document title placed in the prompt (titles are user-controlled). */
export const MAX_SOURCE_TITLE_LENGTH = 200;

/**
 * Neutralise text that comes from documents (chunk text and file names) so
 * it cannot pose as prompt structure (SEC-011):
 *  - `<` and `>` become look-alike characters, so no `<source ...>` or
 *    `</source-...>` tag can be opened or closed from inside a document;
 *  - `[Source` (any case) becomes `[source-text`, so a document cannot forge
 *    a citation header;
 *  - the per-request nonce is removed if it ever appears.
 */
export const neutraliseUntrusted = (value: string, nonce: string): string =>
  value
    .split(nonce)
    .join("")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/\[\s*source/gi, "[source-text");

const titleFor = (chunk: RetrievedChunk, nonce: string) => {
  const title = neutraliseUntrusted(chunk.title?.trim() || "Untitled document", nonce).replace(/["\r\n]/g, " ");
  return title.length > MAX_SOURCE_TITLE_LENGTH ? `${title.slice(0, MAX_SOURCE_TITLE_LENGTH)}…` : title;
};

/**
 * Format retrieved chunks into an LLM-ready context (SEC-011, ISS-029).
 *
 * Each chunk is wrapped in a `<source>` element that carries a random,
 * per-request nonce in its tags; document text and titles are neutralised
 * (see above), so text inside a document cannot close its own block, open a
 * new one or forge a `[Source N]` header. The system prompt tells the model
 * that everything inside these blocks is untrusted data. Sources are
 * labelled by document title, not database id.
 */
export const buildRagContext = (
  chunks: RetrievedChunk[],
  nonce: string = crypto.randomBytes(8).toString("hex")
): RagContext => {
  if (!chunks || chunks.length === 0) {
    return {
      text: "No relevant document chunks found in this workspace.",
      sources: [],
    };
  }

  const text = chunks
    .map((chunk, index) =>
      [
        `<source-${nonce} id="${index + 1}" title="${titleFor(chunk, nonce)}" type="${chunk.fileType}" relevance="${chunk.score.toFixed(4)}">`,
        neutraliseUntrusted(chunk.text, nonce),
        `</source-${nonce}>`,
      ].join("\n")
    )
    .join("\n\n");

  return {
    text,
    sources: chunks,
  };
};
