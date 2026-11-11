import { useState, useCallback, useRef, useEffect } from "react";
import { streamAiQuery, fetchWorkspaceSessions } from "../api/ai.api";
import type { AISource, AISessionHistoryItem } from "../utils/sse";
import {
  readAiStream,
  INCOMPLETE_STREAM_MESSAGE,
  STOPPED_STREAM_MESSAGE,
} from "../utils/ai-stream";

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
  /** True when generation failed after some tokens had already been rendered. */
  const [answerIsPartial, setAnswerIsPartial] = useState(false);
  /** `[Source N]` markers the answer used that were never actually retrieved. */
  const [unverifiedCitations, setUnverifiedCitations] = useState<number[]>([]);

  const [history, setHistory] = useState<AISessionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Clear query state when the active workspace CHANGES. Not on (re)mount:
  // React StrictMode re-runs mount effects in development, and a reset then
  // would abort a question submitted by the page on mount (initialQuery).
  const lastWorkspaceIdRef = useRef(workspaceId);
  useEffect(() => {
    if (lastWorkspaceIdRef.current === workspaceId) return;
    lastWorkspaceIdRef.current = workspaceId;
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
    setAnswerIsPartial(false);
    setUnverifiedCitations([]);
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
      console.warn("Could not load AI session history:", (err as Error)?.message);
    } finally {
      setHistoryLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /** Whether answer text has been received for the current request. */
  const receivedTextRef = useRef(false);

  // Cancel an ongoing SSE stream request
  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      // A stopped answer is not a complete one: never leave it looking like
      // a finished grounded response.
      if (receivedTextRef.current) {
        setError(STOPPED_STREAM_MESSAGE);
        setAnswerIsPartial(true);
      }
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
      // Only the latest request may touch state: a superseded or cancelled
      // request must not clear the newer request's controller or loading
      // state, or append its tokens to the newer answer.
      const isCurrent = () =>
        abortControllerRef.current === controller && !controller.signal.aborted;

      // Reset state for new query
      receivedTextRef.current = false;
      setQuery(trimmed);
      setAnswer("");
      setSources([]);
      setSessionId(null);
      setError(null);
      setAnswerIsPartial(false);
      setUnverifiedCitations([]);
      setIsStreaming(true);

      try {
        const reader = await streamAiQuery(
          { workspaceId, query: trimmed },
          controller.signal
        );

        const outcome = await readAiStream(
          reader,
          {
            onToken: (text) => {
              receivedTextRef.current = true;
              setAnswer((prev) => prev + text);
            },
            onSources: (items) => setSources(items),
          },
          isCurrent
        );

        if (!outcome || !isCurrent()) return;

        if (outcome.kind === "done") {
          setSessionId(outcome.sessionId);
          setUnverifiedCitations(outcome.unverifiedCitations);
          // Refresh MongoDB history after successful session completion
          loadHistory();
        } else if (outcome.kind === "error") {
          // Terminal failure: no sessionId is set, so the UI can never
          // present this as a completed answer.
          setError(outcome.message);
          setAnswerIsPartial(outcome.partial);
        } else {
          // The stream closed without a terminal event: incomplete, whatever
          // text arrived.
          setError(INCOMPLETE_STREAM_MESSAGE);
          setAnswerIsPartial(outcome.receivedText);
        }
      } catch (err: any) {
        // Cancelled or replaced by a newer request: that path owns the state.
        if (!isCurrent()) return;
        console.error("AI stream error:", err?.message);
        setError(err?.message || "ResearchMind couldn't complete the answer. Please try again.");
        setAnswerIsPartial(receivedTextRef.current);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          setIsStreaming(false);
        }
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
    setAnswerIsPartial(false);
    setUnverifiedCitations([]);
    setIsStreaming(false);
  }, [cancelStream]);

  const clearCurrent = useCallback(() => {
    cancelStream();
    setQuery("");
    setAnswer("");
    setSources([]);
    setSessionId(null);
    setError(null);
    setAnswerIsPartial(false);
    setUnverifiedCitations([]);
  }, [cancelStream]);

  return {
    query,
    answer,
    sources,
    sessionId,
    isStreaming,
    error,
    answerIsPartial,
    unverifiedCitations,
    history,
    historyLoading,
    submitQuery,
    cancelStream,
    loadHistory,
    loadHistoryItem,
    clearCurrent,
  };
};
