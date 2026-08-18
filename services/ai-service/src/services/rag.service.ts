import { semanticSearch } from "./query.service";
import { buildRagContext } from "./context.service";
import { RAG_SYSTEM_PROMPT, buildRagUserPrompt } from "../prompts/rag.prompt";
import { streamGrokResponse } from "./grok.service";
import { saveAiSession } from "./ai-session.service";
import { XAI_MODEL } from "../config/grok";

export type RagEventType = "start" | "token" | "sources" | "done" | "error";

export interface RagSseEvent {
  event: RagEventType;
  data: any;
}

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
    emitEvent("error", { message: "Query text cannot be empty" });
    return;
  }

  // 1. Emit start event
  emitEvent("start", { query: normalizedQuery });

  // 2. Vector search via Voyage & Pinecone
  const chunks = await semanticSearch({
    workspaceId,
    query: normalizedQuery,
    topK,
  });

  // 3. Build RAG context
  const ragContext = buildRagContext(chunks);

  // 4. Emit sources event
  const sourcesPayload = chunks.map((c) => ({
    documentId: c.documentId,
    chunkIndex: c.chunkIndex,
    score: c.score,
    fileType: c.fileType,
  }));

  emitEvent("sources", { sources: sourcesPayload });

  // 5. Construct Prompts
  const userPrompt = buildRagUserPrompt(normalizedQuery, ragContext.text);

  // 6. Stream tokens from Grok
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
    console.error("Grok streaming error:", err);
    emitEvent("error", { message: err.message || "LLM generation failed" });
    return;
  }

  // 7. Persist AI Session to MongoDB
  const sessionId = await saveAiSession({
    workspaceId,
    userId,
    query: normalizedQuery,
    answer: fullAnswer,
    sources: sourcesPayload,
    aiModel: XAI_MODEL,
  });

  // 8. Emit done event
  emitEvent("done", { sessionId });
};
