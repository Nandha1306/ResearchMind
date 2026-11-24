export interface CreateDocumentDto {
  workspaceId: string;
  uploadedBy: string;
  originalName: string;
  fileType: "pdf" | "docx";
  fileSize: number;
  cloudinaryUrl?: string | null;
  cloudinaryPublicId?: string | null;
  cloudinaryResourceType?: "image" | "raw" | null;
  cloudinaryDeliveryType?: "upload" | "authenticated" | "private" | null;
  cloudinaryFormat?: string | null;
  extractedText?: string;
  embeddingStatus?: "pending" | "indexing" | "indexed" | "failed";
}