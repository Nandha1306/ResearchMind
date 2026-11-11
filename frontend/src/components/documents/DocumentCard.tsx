import React from "react";
import type { DocumentItem } from "../../types/document.types";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { formatFileSize, formatDocumentDate, getSafeExternalUrl } from "../../utils/fileUtils";
import { FileText, FileType, ExternalLink, Calendar, HardDrive, Trash2, RefreshCw } from "lucide-react";

interface DocumentCardProps {
  document: DocumentItem;
  onSelect?: (document: DocumentItem) => void;
  onDelete?: (document: DocumentItem) => void;
  onReindex?: (document: DocumentItem) => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onSelect,
  onDelete,
  onReindex,
}) => {
  const isPdf = document.fileType === "pdf";

  // The card used to be an `<a href={cloudinaryUrl}>` (PDF: same tab, DOCX: new
  // tab). It became a `<div>` so it can contain the Delete/Retry buttons, which
  // dropped the non-PDF navigation and keyboard access. This restores both.
  const openDocument = () => {
    if (isPdf && onSelect) {
      onSelect(document);
      return;
    }
    const url = getSafeExternalUrl(document.cloudinaryUrl);
    if (!url) return; // same as the old `href="#"` fallback
    if (isPdf) {
      window.location.assign(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleClick = () => {
    openDocument();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ignore keys pressed on the nested Delete/Retry buttons.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      openDocument();
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDelete && window.confirm(`Are you sure you want to delete "${document.originalName}"?`)) {
      onDelete(document);
    }
  };

  const handleReindex = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onReindex) {
      onReindex(document);
    }
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="bg-bg-surface border border-border-default rounded-xl p-4 flex flex-col justify-between hover:bg-bg-elevated/40 hover:border-border-default transition-all duration-200 group cursor-pointer select-none space-y-4 shadow-sm text-left text-inherit"
      title={
        isPdf
          ? `View ${document.originalName} in-app`
          : `Open ${document.originalName} in new tab`
      }
    >
      {/* Top Row: Icon + Status Badge + Actions */}
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

        <div className="flex items-center gap-2">
          {(document.embeddingStatus === "failed" || document.embeddingStatus === "pending") && onReindex && (
            <button
              type="button"
              onClick={handleReindex}
              className="px-2 py-1 text-[10px] font-semibold rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 flex items-center gap-1 transition-colors cursor-pointer"
              title="Retry embedding indexing"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}

          <DocumentStatusBadge status={document.embeddingStatus} />

          {onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="p-1 rounded-lg text-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              title="Delete document"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* File Details */}
      <div className="space-y-1">
        <h3
          className="text-[13px] font-bold text-text-primary group-hover:text-accent-primary transition-colors truncate"
          title={document.originalName}
        >
          {document.originalName}
        </h3>
        <p className="text-[11px] text-text-secondary uppercase tracking-wider font-semibold">
          {document.fileType.toUpperCase()} Document
        </p>
      </div>

      {/* Metadata Bottom Row */}
      <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-secondary">
        <div className="flex items-center gap-1.5" title="File Size">
          <HardDrive className="w-3.5 h-3.5 text-text-muted" />
          <span>{formatFileSize(document.fileSize)}</span>
        </div>

        <div className="flex items-center gap-1.5" title="Upload Date">
          <Calendar className="w-3.5 h-3.5 text-text-muted" />
          <span>{formatDocumentDate(document.createdAt)}</span>
        </div>

        <div className="opacity-0 group-hover:opacity-100 transition-opacity text-accent-primary">
          <ExternalLink className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  );
};
