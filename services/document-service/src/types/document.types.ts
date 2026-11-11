export interface CreateDocumentDto {
  workspaceId: string;
  uploadedBy: string;
  originalName: string;
  fileType: "pdf" | "docx";
  fileSize: number;
  cloudinaryUrl?: string | null;
  cloudinaryPublicId?: string | null;
  extractedText?: string;
  embeddingStatus?: "pending" | "indexing" | "indexed" | "failed";
}