import axiosInstance, { API_URL } from "./axios";
import { useAuthStore } from "../store/auth.store";
import type { AISessionHistoryItem } from "../utils/sse";
import type { MeetingSummary, SummarizeMeetingRequest } from "../types/task.types";

export interface AIQueryRequest {
  workspaceId: string;
  query: string;
  topK?: number;
}

export interface VectorSearchResult {
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  text: string;
  score: number;
  fileType: "pdf" | "docx";
}

/** Initiate an authenticated SSE stream query to the API Gateway. */
export const streamAiQuery = async (
  request: AIQueryRequest,
  signal?: AbortSignal
): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const token = useAuthStore.getState().accessToken;

  if (!token) {
    throw new Error("Authentication required. Please sign in to query workspace documents.");
  }

  const response = await fetch(`${API_URL}/ai/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: Failed to initialize AI query stream`;
    try {
      const errorJson = await response.json();
      if (errorJson.message) errorMessage = errorJson.message;
    } catch {}

    if (response.status === 401) {
      errorMessage = "Your session has expired. Please sign in again.";
    } else if (response.status === 403) {
      errorMessage = "Access denied. You do not have access to this workspace.";
    } else if (response.status === 429) {
      errorMessage = "Too many requests. Please wait a moment before asking another question.";
    }

    throw new Error(errorMessage);
  }

  if (!response.body) {
    throw new Error("ReadableStream not supported by browser/gateway response.");
  }

  return response.body.getReader();
};

/** Retrieve recent MongoDB AI Q&A sessions for the active workspace. */
export const fetchWorkspaceSessions = async (
  workspaceId: string
): Promise<AISessionHistoryItem[]> => {
  const response = await axiosInstance.get(`/ai/sessions/workspace/${workspaceId}`);
  return response.data.data || [];
};

/** Perform pure vector search (Retrieval Debug Endpoint). */
export const searchWorkspaceVectors = async (
  request: AIQueryRequest
): Promise<VectorSearchResult[]> => {
  const response = await axiosInstance.post("/ai/search", request);
  return response.data.data || [];
};

/** Summarize raw meeting notes into structured summary and action items using Grok LLM. */
export const summarizeMeeting = async (
  request: SummarizeMeetingRequest
): Promise<MeetingSummary> => {
  const response = await axiosInstance.post("/ai/summarize-meeting", request);
  return response.data.data;
};
