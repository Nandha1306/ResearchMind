import axiosInstance from "./axios";
import type { DocumentItem, DocumentApiResponse } from "../types/document.types";

export const documentApi = {
  /** Fetch all documents belonging to a workspace. */
  getWorkspaceDocuments: async (workspaceId: string): Promise<DocumentItem[]> => {
    const response = await axiosInstance.get<DocumentApiResponse<DocumentItem[]>>(
      `/documents/workspace/${workspaceId}`
    );
    return response.data.data;
  },

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
};
