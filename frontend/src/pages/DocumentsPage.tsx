import React, { useState, useMemo } from "react";
import { useWorkspaceStore } from "../store/workspace.store";
import { useWorkspaceDocuments, useUploadDocument, useDeleteDocument, useReindexDocument } from "../hooks/useDocuments";
import { DocumentToolbar } from "../components/documents/DocumentToolbar";
import type { FilterOption } from "../components/documents/DocumentToolbar";
import { DocumentGrid } from "../components/documents/DocumentGrid";
import { DocumentSkeleton } from "../components/documents/DocumentSkeleton";
import { DocumentEmptyState } from "../components/documents/DocumentEmptyState";
import { DocumentErrorState } from "../components/documents/DocumentErrorState";
import { UploadDocumentModal } from "../components/documents/UploadDocumentModal";
import { PdfViewerModal } from "../components/documents/PdfViewerModal";
import type { DocumentItem } from "../types/document.types";
import { Plus, FileText, Sparkles, AlertCircle, X } from "lucide-react";
import { Button } from "../components/ui/button";

export const DocumentsPage: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id;

  const { data: documents = [], isLoading, isError, error, refetch } = useWorkspaceDocuments(workspaceId);
  const uploadMutation = useUploadDocument(workspaceId);
  const deleteMutation = useDeleteDocument(workspaceId);
  const reindexMutation = useReindexDocument(workspaceId);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedPdf, setSelectedPdf] = useState<DocumentItem | null>(null);

  /*
   * Delete / re-index feedback (P1-A22): a document with a request in flight
   * is busy (its buttons are disabled, so a double click sends one request),
   * and a failure is shown with the server's reason instead of being dropped.
   */
  const [busyDocumentIds, setBusyDocumentIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const runDocumentAction = async (
    doc: DocumentItem,
    mutation: typeof deleteMutation | typeof reindexMutation,
    verb: "delete" | "re-index"
  ) => {
    if (busyDocumentIds.includes(doc._id)) return;
    setActionError(null);
    setBusyDocumentIds((prev) => [...prev, doc._id]);
    // mutateAsync per call: per-call `mutate` callbacks only fire for the most
    // recent call, which would leave an earlier document stuck as busy.
    try {
      await mutation.mutateAsync(doc._id);
    } catch (err) {
      const serverMessage = (err as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      setActionError(
        `Could not ${verb} "${doc.originalName}": ${
          serverMessage || (err as Error)?.message || "Please try again."
        }`
      );
    } finally {
      setBusyDocumentIds((prev) => prev.filter((id) => id !== doc._id));
    }
  };

  // Client-side local search & filter algorithm
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // 1. Search Query Filter (Case-insensitive matching on originalName)
      const matchesSearch = doc.originalName
        .toLowerCase()
        .includes(searchQuery.toLowerCase().trim());

      // 2. Category / Status Filter
      if (activeFilter === "all") return matchesSearch;
      if (activeFilter === "pdf" || activeFilter === "docx") {
        return matchesSearch && doc.fileType === activeFilter;
      }
      return matchesSearch && doc.embeddingStatus === activeFilter;
    });
  }, [documents, searchQuery, activeFilter]);

  const handleUploadSubmit = async (file: File) => {
    await uploadMutation.mutateAsync(file);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
      {/* 1. Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent-bg text-accent-primary text-[10px] font-bold border border-accent-primary/20 select-none">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Workspace Knowledge Base</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">
            Documents
          </h1>
          <p className="text-[13px] text-text-secondary">
            Research papers, reports, notes and project files.
          </p>
        </div>

        {/* Header Action Button */}
        <Button
          onClick={() => setIsUploadModalOpen(true)}
          className="bg-accent-primary hover:bg-accent-hover text-white text-[13px] font-semibold h-10 px-4 rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Upload document</span>
        </Button>
      </div>

      {/* 2. Main Content Body */}
      {isLoading ? (
        <DocumentSkeleton count={8} />
      ) : isError ? (
        <DocumentErrorState
          message={error?.message || "Could not fetch documents for this workspace."}
          onRetry={refetch}
        />
      ) : documents.length === 0 ? (
        <DocumentEmptyState onUploadClick={() => setIsUploadModalOpen(true)} />
      ) : (
        <div className="space-y-5">
          {/* Toolbar Search & Filter Controls */}
          <DocumentToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            totalCount={documents.length}
            filteredCount={filteredDocuments.length}
          />

          {actionError && (
            <div
              role="alert"
              className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-center gap-2"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Document Grid or No Results Message */}
          {filteredDocuments.length > 0 ? (
            <DocumentGrid
              documents={filteredDocuments}
              onSelectDocument={(doc) => setSelectedPdf(doc)}
              onDeleteDocument={(doc) => void runDocumentAction(doc, deleteMutation, "delete")}
              onReindexDocument={(doc) => void runDocumentAction(doc, reindexMutation, "re-index")}
              busyDocumentIds={busyDocumentIds}
            />
          ) : (
            <div className="p-8 bg-bg-surface border border-border-default rounded-xl text-center space-y-3 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-bg-elevated text-text-muted flex items-center justify-center mx-auto">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-text-primary">No matching documents found</h3>
              <p className="text-[12px] text-text-secondary">
                Try adjusting your search query or filter selection.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setActiveFilter("all");
                }}
                className="text-[12px] text-accent-primary hover:underline font-semibold cursor-pointer pt-1"
              >
                Reset search & filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. Upload Modal Dialog */}
      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUpload={handleUploadSubmit}
        isUploading={uploadMutation.isPending}
      />

      {/* 4. In-App PDF Viewer Modal */}
      {selectedPdf && (
        <PdfViewerModal
          document={selectedPdf}
          onClose={() => setSelectedPdf(null)}
        />
      )}
    </div>
  );
};
