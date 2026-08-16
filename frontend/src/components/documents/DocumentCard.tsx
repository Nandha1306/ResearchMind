import React from "react";
import type { DocumentItem } from "../../types/document.types";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { formatFileSize, formatDocumentDate } from "../../utils/fileUtils";
import { FileText, FileType, ExternalLink, Calendar, HardDrive } from "lucide-react";

interface DocumentCardProps {
  document: DocumentItem;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({ document }) => {
  const isPdf = document.fileType === "pdf";
  const fileUrl = document.cloudinaryUrl || "#";

  return (
    <a
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-[#111111] border border-[#2A2A2A] rounded-xl p-4 flex flex-col justify-between hover:bg-[#141414] hover:border-[#3A3A3A] transition-all duration-200 group cursor-pointer select-none space-y-4 shadow-sm block text-left text-inherit no-underline"
      title={document.cloudinaryUrl ? `Open ${document.originalName} in new tab` : "No document URL"}
    >
      {/* Top Row: Icon + Status Badge */}
      <div className="flex items-start justify-between gap-3">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isPdf
              ? "bg-red-500/10 text-red-400 border border-red-500/20"
              : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
          }`}
        >
          {isPdf ? (
            <FileText className="w-5 h-5" />
          ) : (
            <FileType className="w-5 h-5" />
          )}
        </div>

        <DocumentStatusBadge status={document.embeddingStatus} />
      </div>

      {/* File Details */}
      <div className="space-y-1">
        <h3
          className="text-[13px] font-bold text-[#EDEDEE] group-hover:text-[#7C6AF7] transition-colors truncate"
          title={document.originalName}
        >
          {document.originalName}
        </h3>
        <p className="text-[11px] text-[#8B8B8F] uppercase tracking-wider font-semibold">
          {document.fileType.toUpperCase()} Document
        </p>
      </div>

      {/* Metadata Bottom Row */}
      <div className="pt-3 border-t border-[#1E1E1E] flex items-center justify-between text-[11px] text-[#8B8B8F]">
        <div className="flex items-center gap-1.5" title="File Size">
          <HardDrive className="w-3.5 h-3.5 text-[#4A4A50]" />
          <span>{formatFileSize(document.fileSize)}</span>
        </div>

        <div className="flex items-center gap-1.5" title="Upload Date">
          <Calendar className="w-3.5 h-3.5 text-[#4A4A50]" />
          <span>{formatDocumentDate(document.createdAt)}</span>
        </div>

        <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[#7C6AF7]">
          <ExternalLink className="w-3.5 h-3.5" />
        </div>
      </div>
    </a>
  );
};
