import { useState, useCallback, useRef, useEffect } from "react";
import { streamAiQuery, fetchWorkspaceSessions } from "../api/ai.api";
import { SSEStreamParser } from "../utils/sse";
import type { AISource, AISessionHistoryItem } from "../utils/sse";

export interface UseAiQueryOptions {
  workspaceId: string | undefined;
}

export const useAiQuery = ({ workspaceId }: UseAiQueryOptions) => {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<AISource[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<AISessionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Clear query state when active workspace changes
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setQuery("");
    setAnswer("");
    setSources([]);
    setSessionId(null);
    setIsStreaming(false);
    setError(null);
  }, [workspaceId]);

  // Load session history from MongoDB
  const loadHistory = useCallback(async () => {
    if (!workspaceId) {
      setHistory([]);
      return;
    }

    setHistoryLoading(true);
    try {
      const items = await fetchWorkspaceSessions(workspaceId);
      setHistory(items);
    } catch (err) {
      console.warn("Could not load AI session history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Cancel an ongoing SSE stream request
  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  // Submit a new RAG search query
  const submitQuery = useCallback(
    async (queryText: string) => {
      const trimmed = queryText.trim();
      if (!trimmed) {
        setError("Please enter a valid question.");
        return;
      }

      if (trimmed.length > 1000) {
        setError("Question is too long (maximum 1000 characters).");
        return;
      }

      if (!workspaceId) {
        setError("Please select an active workspace.");
        return;
      }

      // Abort any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Reset state for new query
      setQuery(trimmed);
      setAnswer("");
      setSources([]);
      setSessionId(null);
      setError(null);
      setIsStreaming(true);

      const parser = new SSEStreamParser();

      try {
        const reader = await streamAiQuery(
          { workspaceId, query: trimmed },
          controller.signal
        );

        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunkText = decoder.decode(value, { stream: true });
          const events = parser.push(chunkText);

          for (const ev of events) {
            if (ev.type === "token") {
              setAnswer((prev) => prev + ev.text);
            } else if (ev.type === "sources") {
              setSources(ev.sources || []);
            } else if (ev.type === "done") {
              setSessionId(ev.sessionId);
              setIsStreaming(false);
            } else if (ev.type === "error") {
              setError(ev.message);
              setIsStreaming(false);
            }
          }
        }

        // Flush remaining buffer
        const finalEvents = parser.flush();
        for (const ev of finalEvents) {
          if (ev.type === "token") {
            setAnswer((prev) => prev + ev.text);
          } else if (ev.type === "sources") {
            setSources(ev.sources || []);
          } else if (ev.type === "done") {
            setSessionId(ev.sessionId);
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        }

        setIsStreaming(false);
        abortControllerRef.current = null;

        // Refresh MongoDB history after successful session completion
        loadHistory();
      } catch (err: any) {
        if (err.name === "AbortError") {
          console.log("Query stream aborted by user");
        } else {
          console.error("AI Stream Error:", err);
          setError(err.message || "ResearchMind couldn't complete the answer. Please try again.");
        }
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [workspaceId, loadHistory]
  );

  // Restore a session from history
  const loadHistoryItem = useCallback((item: AISessionHistoryItem) => {
    cancelStream();
    setQuery(item.query);
    setAnswer(item.answer);
    setSources(item.sources || []);
    setSessionId(item._id);
    setError(null);
    setIsStreaming(false);
  }, [cancelStream]);

  const clearCurrent = useCallback(() => {
    cancelStream();
    setQuery("");
    setAnswer("");
    setSources([]);
    setSessionId(null);
    setError(null);
  }, [cancelStream]);

  return {
    query,
    answer,
    sources,
    sessionId,
    isStreaming,
    error,
    history,
    historyLoading,
    submitQuery,
    cancelStream,
    loadHistory,
    loadHistoryItem,
    clearCurrent,
  };
};
