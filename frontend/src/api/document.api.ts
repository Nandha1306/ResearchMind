import axiosInstance from "./axios";
import type { DocumentItem, DocumentApiResponse } from "../types/document.types";
import { fetchAllPages, type GetFn, type PagedList } from "./paging";

const listGet: GetFn = (url, config) => axiosInstance.get(url, config);

export const documentApi = {
  /**
   * Fetch the documents of a workspace, newest first, following the server's
   * page cursor (ISS-043). `truncated` is true when the page ceiling was hit.
   */
  getWorkspaceDocuments: async (workspaceId: string): Promise<PagedList<DocumentItem>> =>
    fetchAllPages<DocumentItem>(listGet, `/documents/workspace/${workspaceId}`),

  /** Upload a PDF or DOCX file to a workspace. */
  uploadDocument: async (workspaceId: string, file: File): Promise<DocumentItem> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("workspaceId", workspaceId);

    // Pass multipart/form-data header config so Axios overrides default application/json header
    const response = await axiosInstance.post<DocumentApiResponse<DocumentItem>>(
      "/documents/upload",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );
    return response.data.data;
  },

  /**
   * Fetch a document's file (members only). Goes through the authenticated
   * client, so an expired access token is refreshed and the request retried;
   * the token is never placed in a URL.
   */
  getDocumentFile: async (documentId: string): Promise<Blob> => {
    const response = await axiosInstance.get<Blob>(`/documents/${documentId}/file`, {
      responseType: "blob",
    });
    return response.data;
  },

  /** Delete a document by ID. */
  deleteDocument: async (documentId: string): Promise<void> => {
    await axiosInstance.delete(`/documents/${documentId}`);
  },

  /** Re-index a failed document. */
  reindexDocument: async (documentId: string): Promise<DocumentItem> => {
    const response = await axiosInstance.post<DocumentApiResponse<DocumentItem>>(
      `/documents/${documentId}/reindex`
    );
    return response.data.data;
  },
};
