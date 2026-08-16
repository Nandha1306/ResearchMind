import React, { useState, useEffect, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { DocumentItem } from "../../types/document.types";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
  AlertCircle,
  FileText,
} from "lucide-react";

// Configure PDF.js worker using matching pdfjs.version
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerModalProps {
  document: DocumentItem;
  onClose: () => void;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  document: doc,
  onClose,
}) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [hasError, setHasError] = useState<boolean>(false);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
    setHasError(false);
  };

  const onDocumentLoadError = (error: Error) => {
    console.error("PDF.js load error:", error);
    setHasError(true);
  };

  const handlePrevPage = useCallback(() => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  }, []);

  const handleNextPage = useCallback(() => {
    if (numPages) {
      setPageNumber((prev) => Math.min(prev + 1, numPages));
    }
  }, [numPages]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 2.5));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

  // Keyboard navigation & Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrevPage();
      } else if (e.key === "ArrowRight") {
        handleNextPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, handlePrevPage, handleNextPage]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#050505]/90 backdrop-blur-md text-[#EDEDEE] animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`PDF Viewer - ${doc.originalName}`}
    >
      {/* Top Header Bar */}
      <div className="h-14 px-4 sm:px-6 bg-[#111111] border-b border-[#2A2A2A] flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-3 min-w-0 pr-4">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#EDEDEE] truncate" title={doc.originalName}>
              {doc.originalName}
            </h2>
            <span className="text-[10px] font-semibold text-[#8B8B8F] uppercase tracking-wider">
              PDF DOCUMENT
            </span>
          </div>
        </div>

        {/* Header Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            aria-label="Close PDF viewer"
            className="w-8 h-8 rounded-lg bg-[#1E1E1E] text-[#8B8B8F] hover:text-white hover:bg-[#2A2A2A] transition-colors flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Viewer Area */}
      <div className="flex-1 overflow-auto p-4 sm:p-8 flex items-center justify-center relative bg-[#0A0A0A]">
        {hasError ? (
          <div className="bg-[#111111] border border-red-500/20 rounded-xl p-8 max-w-md text-center space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Unable to load PDF</h3>
              <p className="text-xs text-[#8B8B8F] mt-1">
                Something went wrong while loading this document.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        ) : (
          <Document
            file={doc.cloudinaryUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex flex-col items-center gap-3 text-[#8B8B8F] py-12">
                <Loader2 className="w-7 h-7 animate-spin text-[#7C6AF7]" />
                <span className="text-xs font-medium">Loading document...</span>
              </div>
            }
            className="flex flex-col items-center justify-center"
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              className="shadow-2xl rounded-lg overflow-hidden border border-[#2A2A2A]"
            />
          </Document>
        )}
      </div>

      {/* Bottom Controls / Toolbar Bar */}
      {!hasError && (
        <div className="h-14 px-4 bg-[#111111] border-t border-[#2A2A2A] flex items-center justify-between shrink-0 text-xs text-[#EDEDEE]">
          {/* Zoom Controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleZoomOut}
              disabled={scale <= 0.5}
              aria-label="Zoom out"
              className="w-8 h-8 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4 text-[#8B8B8F]" />
            </button>

            <span className="w-14 text-center font-mono font-semibold text-[11px] text-[#8B8B8F]">
              {Math.round(scale * 100)}%
            </span>

            <button
              onClick={handleZoomIn}
              disabled={scale >= 2.5}
              aria-label="Zoom in"
              className="w-8 h-8 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4 text-[#8B8B8F]" />
            </button>
          </div>

          {/* Page Navigation Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={pageNumber <= 1}
              aria-label="Previous page"
              className="w-8 h-8 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer"
              title="Previous page (Left Arrow)"
            >
              <ChevronLeft className="w-4 h-4 text-[#8B8B8F]" />
            </button>

            <span className="font-mono text-[11px] text-[#EDEDEE] px-2 font-semibold">
              Page {pageNumber} / {numPages || "..."}
            </span>

            <button
              onClick={handleNextPage}
              disabled={!numPages || pageNumber >= numPages}
              aria-label="Next page"
              className="w-8 h-8 rounded-lg bg-[#1E1E1E] hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer"
              title="Next page (Right Arrow)"
            >
              <ChevronRight className="w-4 h-4 text-[#8B8B8F]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
