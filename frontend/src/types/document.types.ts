export type DocumentFileType = "pdf" | "docx";

export type EmbeddingStatus = "pending" | "indexing" | "indexed" | "failed";

export interface DocumentItem {
  _id: string;
  workspaceId: string;
  uploadedBy: string;
  originalName: string;
  fileType: DocumentFileType;
  fileSize: number;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  extractedText: string;
  embeddingStatus: EmbeddingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}
