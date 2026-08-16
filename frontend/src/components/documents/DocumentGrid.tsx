import React from "react";
import type { DocumentItem } from "../../types/document.types";
import { DocumentCard } from "./DocumentCard";

interface DocumentGridProps {
  documents: DocumentItem[];
}

export const DocumentGrid: React.FC<DocumentGridProps> = ({ documents }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {documents.map((doc) => (
        <DocumentCard key={doc._id} document={doc} />
      ))}
    </div>
  );
};
