import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { documentApi } from "../api/document.api";
import type { DocumentItem } from "../types/document.types";
import { documentPollInterval } from "../utils/document-status";
import type { PagedList } from "../api/paging";

/**
 * React Query hook to fetch documents for the active workspace. `data` is the
 * loaded list; `truncated` is true when the workspace has more documents than
 * the page ceiling allows (ISS-043) -- pages then show a notice.
 */
export function useWorkspaceDocuments(workspaceId: string | undefined) {
  const query = useQuery<PagedList<DocumentItem>, Error>({
    queryKey: ["documents", workspaceId],
    queryFn: () => {
      if (!workspaceId) return Promise.resolve({ items: [], truncated: false });
      return documentApi.getWorkspaceDocuments(workspaceId);
    },
    enabled: Boolean(workspaceId),
    staleTime: 1000 * 60 * 2, // 2 minutes cache
    // Keep statuses live while documents are being processed (P1-A22); stops
    // once every document is indexed or failed. Paused in background tabs.
    refetchInterval: (query) => documentPollInterval(query.state.data?.items),
  });
  return { ...query, data: query.data?.items, truncated: query.data?.truncated ?? false };
}

/** React Query mutation hook to upload a document to the active workspace. */
export function useUploadDocument(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<DocumentItem, Error, File>({
    mutationFn: (file: File) => {
      if (!workspaceId) throw new Error("Workspace ID is required for upload.");
      return documentApi.uploadDocument(workspaceId, file);
    },
    onSuccess: () => {
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      }
    },
  });
}

/** React Query mutation hook to delete a document. */
export function useDeleteDocument(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (documentId: string) => {
      return documentApi.deleteDocument(documentId);
    },
    onSuccess: () => {
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      }
    },
  });
}

/** React Query mutation hook to re-index a document. */
export function useReindexDocument(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<DocumentItem, Error, string>({
    mutationFn: (documentId: string) => {
      return documentApi.reindexDocument(documentId);
    },
    onSuccess: () => {
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      }
    },
  });
}
