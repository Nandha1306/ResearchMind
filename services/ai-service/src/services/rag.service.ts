import { semanticSearch } from "./query.service";
import { buildRagContext } from "./context.service";
import { RAG_SYSTEM_PROMPT, buildRagUserPrompt } from "../prompts/rag.prompt";
import { streamGrokResponse } from "./grok.service";
import { saveAiSession } from "./ai-session.service";
import { auditAnswerCitations } from "./citation-validator.service";
import { XAI_MODEL } from "../config/grok";
import {
  LLM_UNAVAILABLE_MESSAGE,
  isLlmUnavailableError,
} from "../errors/llm.error";

export type RagEventType = "start" | "token" | "sources" | "done" | "error";

export interface RagSseEvent {
  event: RagEventType;
  data: any;
}

const RETRIEVAL_UNAVAILABLE_MESSAGE =
  "Could not search this workspace's documents right now. Please try again.";

/** Execute full end-to-end RAG stream pipeline over workspace documents. */
export const runRagStreamQuery = async ({
  workspaceId,
  userId,
  query,
  topK = 5,
  emitEvent,
}: {
  workspaceId: string;
  userId: string;
  query: string;
  topK?: number;
  emitEvent: (event: RagEventType, data: any) => void;
}): Promise<void> => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    emitEvent("error", { message: "Query text cannot be empty", partial: false });
    return;
  }

  // 1. Emit start event
  emitEvent("start", { query: normalizedQuery });

  // 2. Vector search via Voyage & Pinecone
  let chunks;
  try {
    chunks = await semanticSearch({
      workspaceId,
      query: normalizedQuery,
      topK,
    });
  } catch (err) {
    // Retrieval failure must not fall through to generation: answering without
    // context would produce an ungrounded answer presented as a grounded one.
    console.error("[ai-service] Retrieval failed:", err);
    emitEvent("error", {
      message: RETRIEVAL_UNAVAILABLE_MESSAGE,
      partial: false,
    });
    return;
  }

  // 3. Build RAG context
  const ragContext = buildRagContext(chunks);

  // 4. Emit sources event.
  //    Every field here comes from Pinecone match metadata — nothing is
  //    synthesised. When retrieval returns nothing this is an empty array, and
  //    the prompt instructs the model to say the workspace lacks the answer.
  const sourcesPayload = chunks.map((c) => ({
    documentId: c.documentId,
    chunkIndex: c.chunkIndex,
    score: c.score,
    fileType: c.fileType,
  }));

  emitEvent("sources", { sources: sourcesPayload });

  // 5. Construct Prompts
  const userPrompt = buildRagUserPrompt(normalizedQuery, ragContext.text);

  // 6. Stream tokens from the LLM
  let fullAnswer = "";
  try {
    fullAnswer = await streamGrokResponse(
      RAG_SYSTEM_PROMPT,
      userPrompt,
      (token) => {
        emitEvent("token", { text: token });
      }
    );
  } catch (err: any) {
    // No answer is persisted and no `done` is emitted, so the client can never
    // read a failed generation as a completed one. `partial` tells it whether
    // the tokens it already rendered are an incomplete real answer.
    const partialAnswer = isLlmUnavailableError(err) ? err.partialAnswer : "";

    emitEvent("error", {
      message: isLlmUnavailableError(err) ? err.message : LLM_UNAVAILABLE_MESSAGE,
      partial: partialAnswer.length > 0,
    });
    return;
  }

  // 7. Audit citation markers against what was actually retrieved.
  const citationAudit = auditAnswerCitations(fullAnswer, sourcesPayload.length);

  if (citationAudit.unverified.length > 0) {
    console.warn(
      `[ai-service] Answer cited ${citationAudit.unverified.length} source marker(s) ` +
        `with no retrieved chunk (retrieved=${sourcesPayload.length}, ` +
        `unverified=[${citationAudit.unverified.join(", ")}])`
    );
  }

  // 8. Persist AI Session to MongoDB (only ever reached on a real answer)
  const sessionId = await saveAiSession({
    workspaceId,
    userId,
    query: normalizedQuery,
    answer: fullAnswer,
    sources: sourcesPayload,
    aiModel: XAI_MODEL,
  });

  // 9. Emit done event
  emitEvent("done", {
    sessionId,
    unverifiedCitations: citationAudit.unverified,
  });
};
