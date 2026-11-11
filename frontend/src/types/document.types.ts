export type DocumentFileType = "pdf" | "docx";

export type EmbeddingStatus = "pending" | "indexing" | "indexed" | "failed";

export interface DocumentItem {
  _id: string;
  workspaceId: string;
  uploadedBy: string;
  originalName: string;
  fileType: DocumentFileType;
  fileSize: number;
  /** Null when the file has no stored copy (server-owned field). */
  cloudinaryUrl: string | null;
  cloudinaryPublicId: string | null;
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
