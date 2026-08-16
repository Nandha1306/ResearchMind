import React, { useState, useMemo } from "react";
import { useWorkspaceStore } from "../store/workspace.store";
import { useWorkspaceDocuments, useUploadDocument } from "../hooks/useDocuments";
import { DocumentToolbar } from "../components/documents/DocumentToolbar";
import type { FilterOption } from "../components/documents/DocumentToolbar";
import { DocumentGrid } from "../components/documents/DocumentGrid";
import { DocumentSkeleton } from "../components/documents/DocumentSkeleton";
import { DocumentEmptyState } from "../components/documents/DocumentEmptyState";
import { DocumentErrorState } from "../components/documents/DocumentErrorState";
import { UploadDocumentModal } from "../components/documents/UploadDocumentModal";
import { Plus, FileText, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";

export const DocumentsPage: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id;

  const { data: documents = [], isLoading, isError, error, refetch } = useWorkspaceDocuments(workspaceId);
  const uploadMutation = useUploadDocument(workspaceId);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

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
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#7C6AF7]/12 text-[#7C6AF7] text-[10px] font-bold border border-[#7C6AF7]/20 select-none">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Workspace Knowledge Base</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#EDEDEE] tracking-tight">
            Documents
          </h1>
          <p className="text-[13px] text-[#8B8B8F]">
            Research papers, reports, notes and project files.
          </p>
        </div>

        {/* Header Action Button */}
        <Button
          onClick={() => setIsUploadModalOpen(true)}
          className="bg-[#7C6AF7] hover:bg-[#9B8DF9] text-white text-[13px] font-semibold h-10 px-4 rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-sm self-start sm:self-auto"
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

          {/* Document Grid or No Results Message */}
          {filteredDocuments.length > 0 ? (
            <DocumentGrid documents={filteredDocuments} />
          ) : (
            <div className="p-8 bg-[#111111] border border-[#2A2A2A] rounded-xl text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#1A1A1A] text-[#8B8B8F] flex items-center justify-center mx-auto">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-[#EDEDEE]">No matching documents found</h3>
              <p className="text-[12px] text-[#8B8B8F]">
                Try adjusting your search query or filter selection.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setActiveFilter("all");
                }}
                className="text-[12px] text-[#7C6AF7] hover:underline font-semibold cursor-pointer pt-1"
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
    </div>
  );
};
