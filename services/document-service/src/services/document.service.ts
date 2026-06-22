import { Document } from "../models/Document";
import { CreateDocumentDto } from "../types/document.types";

/** Save document metadata in MongoDB. */
export const createDocument = async (
  data: CreateDocumentDto
) => {
  return Document.create(data);
};

/** Return all documents for a workspace. */
export const getWorkspaceDocuments = async (
  workspaceId: string
) => {
  return Document.find({
    workspaceId,
  }).sort({
    createdAt: -1,
  });
};

/** Find a document by id. */
export const getDocumentById = async (
  documentId: string
) => {
  return Document.findById(documentId);
};