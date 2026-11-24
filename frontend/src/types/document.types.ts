export type DocumentFileType = "pdf" | "docx";

export type EmbeddingStatus = "pending" | "indexing" | "indexed" | "failed";

export interface DocumentItem {
  _id: string;
  workspaceId: string;
  uploadedBy: string;
  originalName: string;
  fileType: DocumentFileType;
  fileSize: number;
  /**
   * Whether the document has a stored file. Files are private (SEC-005): the
   * API never returns a storage URL; fetch the bytes with
   * documentApi.getDocumentFile (GET /api/documents/:id/file).
   */
  hasFile?: boolean;
  extractedText: string;
  embeddingStatus: EmbeddingStatus;
  /** Why processing failed (set by the server when status is "failed"). */
  embeddingError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}
