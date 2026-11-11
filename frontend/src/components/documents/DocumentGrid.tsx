import React from "react";
import type { DocumentItem } from "../../types/document.types";
import { DocumentCard } from "./DocumentCard";

interface DocumentGridProps {
  documents: DocumentItem[];
  onSelectDocument?: (document: DocumentItem) => void;
  onDeleteDocument?: (document: DocumentItem) => void;
  onReindexDocument?: (document: DocumentItem) => void;
  /** Ids of documents with a delete/re-index request in progress. */
  busyDocumentIds?: string[];
}

export const DocumentGrid: React.FC<DocumentGridProps> = ({
  documents,
  onSelectDocument,
  onDeleteDocument,
  onReindexDocument,
  busyDocumentIds = [],
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {documents.map((doc) => (
        <DocumentCard
          key={doc._id}
          document={doc}
          onSelect={onSelectDocument}
          onDelete={onDeleteDocument}
          onReindex={onReindexDocument}
          isBusy={busyDocumentIds.includes(doc._id)}
        />
      ))}
    </div>
  );
};
