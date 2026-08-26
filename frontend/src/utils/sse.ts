export interface AISource {
  documentId: string;
  chunkIndex: number;
  score: number;
  fileType: "pdf" | "docx";
}

export interface AISessionHistoryItem {
  _id: string;
  workspaceId: string;
  userId: string;
  query: string;
  answer: string;
  sources: AISource[];
  aiModel: string;
  createdAt: string;
}

export type AIStreamEvent =
  | { type: "start"; query: string }
  | { type: "token"; text: string }
  | { type: "sources"; sources: AISource[] }
  /**
   * Terminal success. `unverifiedCitations` lists any `[Source N]` markers the
   * model wrote that do not correspond to a retrieved chunk.
   */
  | { type: "done"; sessionId: string; unverifiedCitations: number[] }
  /**
   * Terminal failure. `partial` is true when tokens were already streamed
   * before the failure, meaning the rendered text is an incomplete real answer
   * rather than a complete one.
   */
  | { type: "error"; message: string; partial: boolean };

/** Parse raw SSE text chunks into structured AIStreamEvent objects using a buffer. */
export class SSEStreamParser {
  private buffer: string = "";

  /** Push raw text chunk and yield complete parsed SSE events. */
  public push(chunk: string): AIStreamEvent[] {
    this.buffer += chunk;
    const events: AIStreamEvent[] = [];

    // SSE event blocks are separated by double newlines (\n\n or \r\n\r\n)
    const blocks = this.buffer.split(/\r?\n\r?\n/);

    // Keep the last incomplete block in the buffer
    this.buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;

      let eventType = "";
      let dataStr = "";

      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.replace("event:", "").trim();
        } else if (line.startsWith("data:")) {
          dataStr += line.substring(5).trim();
        }
      }

      if (!eventType || !dataStr) continue;

      try {
        const parsed = JSON.parse(dataStr);
        if (eventType === "start") {
          events.push({ type: "start", query: parsed.query || "" });
        } else if (eventType === "token") {
          events.push({ type: "token", text: parsed.text || "" });
        } else if (eventType === "sources") {
          events.push({ type: "sources", sources: parsed.sources || [] });
        } else if (eventType === "done") {
          events.push({
            type: "done",
            sessionId: parsed.sessionId || "",
            unverifiedCitations: Array.isArray(parsed.unverifiedCitations)
              ? parsed.unverifiedCitations
              : [],
          });
        } else if (eventType === "error") {
          events.push({
            type: "error",
            message: parsed.message || "An error occurred during RAG stream",
            partial: parsed.partial === true,
          });
        }
      } catch (err) {
        console.warn("Failed to parse SSE event payload:", dataStr, err);
      }
    }

    return events;
  }

  /** Flush any remaining buffer text on stream end. */
  public flush(): AIStreamEvent[] {
    if (!this.buffer.trim()) return [];
    const remaining = this.buffer;
    this.buffer = "";
    return this.push(remaining + "\n\n");
  }
}
