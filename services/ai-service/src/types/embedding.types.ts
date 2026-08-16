export type EmbeddingFileType = "pdf" | "docx";

export interface EmbeddingJob {
  documentId: string;
  workspaceId: string;
  uploadedBy: string;
  extractedText: string;
  fileType: EmbeddingFileType;
}