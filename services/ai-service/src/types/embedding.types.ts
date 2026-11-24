export type EmbeddingFileType = "pdf" | "docx";

/**
 * A queue entry is a POINTER only (SEC-006/ARC-007). The worker claims the
 * document and fetches its text (plus uploader and file type) from
 * document-service. Entries written by older producers may still carry
 * `extractedText`, `uploadedBy` and `fileType`: those fields are ignored.
 */
export interface EmbeddingJob {
  documentId: string;
  workspaceId: string;
}
