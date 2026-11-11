import React, { useState, useMemo } from "react";
import { useWorkspaceStore } from "../store/workspace.store";
import { useWorkspaceDocuments } from "../hooks/useDocuments";
import { useAiQuery } from "../hooks/useAiQuery";
import { PdfViewerModal } from "../components/documents/PdfViewerModal";
import type { DocumentItem } from "../types/document.types";
import { getSafeExternalUrl } from "../utils/fileUtils";
import type { AISource } from "../utils/sse";
import {
  Sparkles,
  Send,
  Square,
  RotateCcw,
  FileText,
  FileCode,
  Clock,
  Brain,
  AlertCircle,
  Loader2,
  ExternalLink,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import { Button } from "../components/ui/button";

export const SemanticSearchPage: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id;

  // Fetch workspace documents for documentId -> filename/URL resolution
  const { data: documents = [] } = useWorkspaceDocuments(workspaceId);

  // Map documentId to DocumentItem metadata for instant lookup
  const docMap = useMemo(() => {
    const map = new Map<string, DocumentItem>();
    for (const doc of documents) {
      map.set(doc._id, doc);
    }
    return map;
  }, [documents]);

  // AI Q&A Streaming Hook
  const {
    query: activeQuery,
    answer,
    sources,
    sessionId,
    isStreaming,
    error,
    answerIsPartial,
    unverifiedCitations,
    history,
    historyLoading,
    submitQuery,
    cancelStream,
    loadHistoryItem,
    clearCurrent,
  } = useAiQuery({ workspaceId });

  // Local Form Input & Filters State
  const [inputQuery, setInputQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "pdf" | "docx">("all");
  const [selectedPdf, setSelectedPdf] = useState<DocumentItem | null>(null);

  // Filter sources based on selected fileType filter
  const filteredSources = useMemo(() => {
    if (activeFilter === "all") return sources;
    return sources.filter((s) => s.fileType === activeFilter);
  }, [sources, activeFilter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStreaming) return;
    const trimmed = inputQuery.trim();
    if (!trimmed || trimmed.length > 1000) return;
    submitQuery(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleOpenSourceDoc = (source: AISource) => {
    const doc = docMap.get(source.documentId);
    if (doc) {
      if (doc.fileType === "pdf") {
        setSelectedPdf(doc);
      } else {
        // Open only http(s) URLs, without giving the new tab a handle to this
        // window (a stored URL is not trusted to be safe).
        const url = getSafeExternalUrl(doc.cloudinaryUrl);
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* 1. Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border-default pb-5">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent-bg text-accent-primary text-[10px] font-bold border border-accent-primary/20 select-none">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Semantic Vector Search & RAG</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">
            AI Researcher Q&A
          </h1>
          <p className="text-[13px] text-text-secondary">
            Ask grounded questions about documents in <strong className="text-text-primary">{currentWorkspace?.name || "active workspace"}</strong>.
          </p>
        </div>

        {/* Clear Current Query Button */}
        {(activeQuery || answer || error) && (
          <Button
            onClick={clearCurrent}
            variant="outline"
            className="bg-bg-elevated hover:bg-bg-elevated/80 border-border-default text-text-secondary hover:text-text-primary text-[12px] h-9 px-3 rounded-lg flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Search</span>
          </Button>
        )}
      </div>

      {/* 2. Main Search Area & Sidebar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
        
        {/* Left Column: Search Input & Results (8 cols) */}
        <div className="lg:col-span-8 space-y-6 flex flex-col">
          
          {/* Query Form Box */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative bg-bg-surface border border-border-default focus-within:border-accent-primary rounded-xl p-3 shadow-sm transition-all">
              <textarea
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about your workspace documents (e.g. 'Which exercise demonstrates encapsulation?')..."
                rows={3}
                disabled={isStreaming}
                maxLength={1000}
                className="w-full bg-transparent text-text-primary text-[13.5px] placeholder:text-text-muted outline-none resize-none no-scrollbar font-sans"
              />
              
              <div className="flex items-center justify-between pt-2 border-t border-border-subtle mt-1">
                <span className="text-[11px] text-text-muted">
                  {inputQuery.length}/1000 chars • Press <kbd className="px-1 py-0.5 rounded bg-bg-elevated text-text-secondary border border-border-subtle text-[10px]">Enter</kbd> to submit
                </span>

                <div className="flex items-center gap-2">
                  {isStreaming ? (
                    <Button
                      type="button"
                      onClick={cancelStream}
                      className="bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 text-[12px] h-8 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer font-semibold"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop generating</span>
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={!inputQuery.trim() || inputQuery.trim().length > 1000}
                      className="bg-accent-primary hover:bg-accent-hover disabled:bg-bg-elevated disabled:text-text-muted text-white text-[12px] h-8 px-4 rounded-lg flex items-center gap-1.5 font-semibold cursor-pointer transition-all shadow-sm"
                    >
                      <span>Ask AI</span>
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </form>

          {/* Filter Bar */}
          <div className="flex items-center justify-between bg-bg-surface border border-border-default px-3.5 py-2 rounded-lg shadow-sm">
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <span className="font-semibold text-text-primary">Source Filter:</span>
              <div className="flex items-center gap-1 bg-bg-elevated p-0.5 rounded-md border border-border-subtle">
                <button
                  type="button"
                  onClick={() => setActiveFilter("all")}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeFilter === "all" ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  All Sources ({sources.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter("pdf")}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeFilter === "pdf" ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter("docx")}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeFilter === "docx" ? "bg-accent-primary text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  DOCX
                </button>
              </div>
            </div>

            {sessionId && (
              <span className="text-[11px] font-mono text-accent-primary bg-accent-bg px-2 py-0.5 rounded border border-accent-primary/20">
                Session: {sessionId.slice(-8)}
              </span>
            )}
          </div>

          {/* Error Alert Box */}
          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-3 text-destructive animate-in fade-in duration-200">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="space-y-1 text-[13px]">
                <h4 className="font-bold">Generation Error</h4>
                <p className="text-destructive/90 leading-relaxed">{error}</p>
                <button
                  onClick={() => activeQuery && submitQuery(activeQuery)}
                  className="mt-2 text-[12px] font-bold underline hover:opacity-80 cursor-pointer"
                >
                  Try request again
                </button>
              </div>
            </div>
          )}

          {/* 3. AI Answer Result Card */}
          {(isStreaming || answer) && (
            <div className="bg-bg-surface border border-border-default rounded-xl p-5 space-y-4 shadow-sm animate-in fade-in duration-200">
              {/* Query Badge */}
              <div className="flex items-center gap-2 border-b border-border-subtle pb-3">
                <Brain className="w-4 h-4 text-accent-primary" />
                <h3 className="text-sm font-semibold text-text-primary truncate">
                  "{activeQuery}"
                </h3>
              </div>

              {/* Streaming Content Display */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  <span className={error ? "text-destructive" : undefined}>
                    {error
                      ? answerIsPartial
                        ? "Incomplete response — generation failed"
                        : "Response unavailable"
                      : "AI Grounded Response"}
                  </span>
                  {isStreaming && (
                    <span className="flex items-center gap-1.5 text-accent-primary">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Streaming response...
                    </span>
                  )}
                </div>

                <div className="text-[13.5px] text-text-primary leading-relaxed whitespace-pre-wrap font-sans min-h-[60px]">
                  {answer}
                  {isStreaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-accent-primary animate-pulse rounded-sm align-middle" />
                  )}
                  {!answer && isStreaming && (
                    <span className="text-text-muted italic">Initializing RAG context and querying LLM...</span>
                  )}
                </div>
              </div>

              {/* Citation integrity warning */}
              {unverifiedCitations.length > 0 && (
                <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 flex items-start gap-2.5 text-[12px]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
                  <p className="text-warning leading-relaxed">
                    This answer referenced{" "}
                    {unverifiedCitations.map((n) => `[Source ${n}]`).join(", ")}, which
                    {unverifiedCitations.length === 1 ? " was" : " were"} not part of the
                    retrieved context. Treat{" "}
                    {unverifiedCitations.length === 1 ? "that citation" : "those citations"} as
                    unverified.
                  </p>
                </div>
              )}

              {/* Source Citations Section */}
              {sources.length > 0 && (
                <div className="border-t border-border-subtle pt-4 space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-accent-primary" />
                    <span>Retrieved Sources & Citations ({filteredSources.length})</span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredSources.map((source, idx) => {
                      const doc = docMap.get(source.documentId);
                      const fileName = doc?.originalName || `Document ${source.documentId.slice(-6)}`;
                      const scorePercent = (source.score * 100).toFixed(1);

                      return (
                        <div
                          key={`${source.documentId}-${source.chunkIndex}-${idx}`}
                          onClick={() => handleOpenSourceDoc(source)}
                          className="p-3 rounded-lg bg-bg-elevated hover:bg-bg-elevated/80 border border-border-subtle hover:border-accent-primary/40 transition-all cursor-pointer group flex flex-col justify-between space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {source.fileType === "pdf" ? (
                                <FileText className="w-4 h-4 text-accent-primary shrink-0" />
                              ) : (
                                <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
                              )}
                              <span className="text-[12px] font-semibold text-text-primary group-hover:text-accent-primary transition-colors truncate">
                                {fileName}
                              </span>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 text-text-muted group-hover:text-text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-text-secondary border-t border-border-subtle pt-2">
                            <span>Chunk {source.chunkIndex}</span>
                            <span className="font-mono text-accent-primary">Score: {scorePercent}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Search History Sidebar (4 cols) */}
        <div className="lg:col-span-4 bg-bg-surface border border-border-default rounded-xl p-4 space-y-4 shadow-sm sticky top-20">
          <div className="flex items-center justify-between border-b border-border-subtle pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent-primary" />
              <h3 className="text-sm font-bold text-text-primary">
                Workspace Q&A History
              </h3>
            </div>
            <span className="text-[10px] text-text-muted bg-bg-elevated px-2 py-0.5 rounded border border-border-subtle font-semibold">
              MongoDB
            </span>
          </div>

          {historyLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin text-accent-primary" />
              <span className="text-[11px]">Loading history...</span>
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-[12px] text-text-secondary">No previous Q&A sessions in this workspace.</p>
              <p className="text-[11px] text-text-muted">Ask a question above to start logging sessions.</p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[calc(100vh-16rem)] overflow-y-auto no-scrollbar pr-1">
              {history.map((item) => (
                <div
                  key={item._id}
                  onClick={() => loadHistoryItem(item)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer group text-left ${
                    sessionId === item._id
                      ? "bg-accent-bg border-accent-primary text-text-primary shadow-xs"
                      : "bg-bg-elevated hover:bg-bg-elevated/80 border-border-subtle text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[12px] font-semibold truncate text-text-primary group-hover:text-accent-primary transition-colors">
                      {item.query}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  </div>
                  <p className="text-[11px] text-text-secondary line-clamp-2 leading-snug">
                    {item.answer}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-text-muted mt-2 pt-1.5 border-t border-border-subtle">
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    <span>{item.sources?.length || 0} citations</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PDF Viewer Modal */}
      {selectedPdf && (
        <PdfViewerModal
          document={selectedPdf}
          onClose={() => setSelectedPdf(null)}
        />
      )}
    </div>
  );
};
