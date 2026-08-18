export interface SemanticSearchRequest {
  workspaceId: string;
  query: string;
  topK?: number;
}

export interface RetrievedChunk {
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  text: string;
  score: number;
  fileType: "pdf" | "docx";
}
