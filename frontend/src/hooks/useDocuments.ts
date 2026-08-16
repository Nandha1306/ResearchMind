import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { documentApi } from "../api/document.api";
import type { DocumentItem } from "../types/document.types";

/** React Query hook to fetch documents for the active workspace. */
export function useWorkspaceDocuments(workspaceId: string | undefined) {
  return useQuery<DocumentItem[], Error>({
    queryKey: ["documents", workspaceId],
    queryFn: () => {
      if (!workspaceId) return Promise.resolve([]);
      return documentApi.getWorkspaceDocuments(workspaceId);
    },
    enabled: Boolean(workspaceId),
    staleTime: 1000 * 60 * 2, // 2 minutes cache
  });
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
