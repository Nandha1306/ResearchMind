import React, { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useWorkspaceStore } from "../../store/workspace.store";
import { useAuthStore } from "../../store/auth.store";
import { useWorkspaceDocuments } from "../../hooks/useDocuments";
import {
  Sparkles,
  SearchCode,
  FileCheck,
  Send,
  ArrowRight,
  BookOpen,
  FileText,
  CheckCircle2,
  Users,
  Layers,
} from "lucide-react";

interface RightContextPanelProps {
  isVisible: boolean;
  onClose?: () => void;
}

export const RightContextPanel: React.FC<RightContextPanelProps> = ({ isVisible }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const workspaceId = currentWorkspace?._id;
  const { data: documents = [] } = useWorkspaceDocuments(workspaceId);

  const [chatMessage, setChatMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Dynamic context metrics
  const indexedCount = useMemo(() => {
    return documents.filter((d) => d.embeddingStatus === "indexed").length;
  }, [documents]);

  const pdfCount = useMemo(() => {
    return documents.filter((d) => d.fileType === "pdf").length;
  }, [documents]);

  const docxCount = useMemo(() => {
    return documents.filter((d) => d.fileType === "docx").length;
  }, [documents]);

  const activeRole = useMemo(() => {
    if (!currentWorkspace || !user) return "Member";
    return currentWorkspace.ownerId === user.id ? "Owner" : "Member";
  }, [currentWorkspace, user]);

  // Dynamic page context label
  const pageContextLabel = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith("/dashboard/documents")) return "Document Base";
    if (path.startsWith("/dashboard/ai-researcher")) return "Vector Search";
    if (path.startsWith("/dashboard/tasks")) return "Task Board";
    if (path.startsWith("/dashboard/sources")) return "Knowledge Sources";
    if (path.startsWith("/dashboard/analytics")) return "Workspace Insights";
    if (path.startsWith("/dashboard/literature-review")) return "Literature Review";
    if (path.startsWith("/dashboard/meeting-notes")) return "Meeting AI";
    if (path.startsWith("/dashboard/report-drafter")) return "Report Engine";
    return "Active Project";
  }, [location.pathname]);

  // Dynamic auto-grow height for chat textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [chatMessage]);

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    navigate("/dashboard/ai-researcher", { state: { initialQuery: chatMessage.trim() } });
    setChatMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat(e);
    }
  };

  if (!isVisible) return null;

  return (
    <aside className="w-80 shrink-0 bg-bg-surface flex flex-col h-full select-none z-15 overflow-hidden">
      
      {/* 1. STATIC TOP HEADER: Workspace Context (Fixed, Never Scrolls Away) */}
      <div className="p-4 pb-3 border-b border-border-subtle bg-bg-surface shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-accent-primary" />
            <span>Workspace Context</span>
          </h3>
          <span className="bg-accent-bg border border-accent-primary/20 text-accent-primary text-[10px] font-bold px-2.5 py-0.5 rounded-full truncate max-w-[120px]">
            {pageContextLabel}
          </span>
        </div>

        <div className="p-3 bg-bg-elevated border border-border-subtle rounded-xl space-y-2.5 shadow-xs">
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted">
              PROJECT NAME
            </span>
            <span className="block text-[14px] font-extrabold text-text-primary mt-0.5 truncate">
              {currentWorkspace?.name || "No active project"}
            </span>
          </div>

          {/* Grid Metrics */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-subtle">
            <div>
              <span className="block text-[10px] font-semibold text-text-muted flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-success" />
                INDEXED
              </span>
              <span className="block text-[13px] font-bold text-text-primary mt-0.5">
                {indexedCount} / {documents.length} Sources
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-semibold text-text-muted flex items-center gap-1">
                <Users className="w-3 h-3 text-accent-primary" />
                MEMBERS
              </span>
              <span className="block text-[13px] font-bold text-text-primary mt-0.5">
                {currentWorkspace?.members?.length || 1} ({activeRole})
              </span>
            </div>
          </div>

          {/* Dynamic File Format Chips */}
          <div className="pt-2 border-t border-border-subtle flex items-center gap-2 text-[10px] text-text-secondary">
            <span className="px-2 py-0.5 rounded bg-bg-surface border border-border-subtle font-semibold flex items-center gap-1">
              <FileText className="w-3 h-3 text-red-400" />
              {pdfCount} PDF
            </span>
            <span className="px-2 py-0.5 rounded bg-bg-surface border border-border-subtle font-semibold flex items-center gap-1">
              <FileText className="w-3 h-3 text-blue-400" />
              {docxCount} DOCX
            </span>
          </div>
        </div>
      </div>

      {/* 2. MIDDLE SECTION: Quick Actions + RAG System Status (Fills all remaining height) */}
      <div className="p-4 flex-1 min-h-0 overflow-y-auto space-y-4 no-scrollbar">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2.5">
            Quick Actions
          </h3>
          <div className="space-y-2">
            <button
              onClick={() => navigate("/dashboard/ai-researcher")}
              className="w-full h-9 flex items-center justify-between px-3 text-[12px] font-medium text-text-primary bg-bg-elevated border border-border-subtle hover:border-accent-primary/40 rounded-lg text-left transition-all cursor-pointer shadow-xs"
            >
              <span className="flex items-center gap-2">
                <SearchCode className="w-4 h-4 text-accent-primary" />
                <span>AI Researcher Q&A</span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
            </button>

            <button
              onClick={() => navigate("/dashboard/documents")}
              className="w-full h-9 flex items-center justify-between px-3 text-[12px] font-medium text-text-primary bg-bg-elevated border border-border-subtle hover:border-accent-primary/40 rounded-lg text-left transition-all cursor-pointer shadow-xs"
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span>Browse Documents</span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
            </button>

            <button
              onClick={() => navigate("/dashboard/documents")}
              className="w-full h-9 flex items-center justify-between px-3 text-[12px] font-medium text-text-primary bg-bg-elevated border border-border-subtle hover:border-accent-primary/40 rounded-lg text-left transition-all cursor-pointer shadow-xs"
            >
              <span className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-success" />
                <span>Upload New Document</span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
            </button>
          </div>
        </div>

        {/* Vector Engine Health Status */}
        <div className="p-3 bg-bg-elevated/60 border border-border-subtle rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              RAG Engine Status
            </span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Operational
            </span>
          </div>
          <p className="text-[11px] text-text-secondary leading-normal">
            Pinecone vector database & Voyage AI embedding worker connected.
          </p>
        </div>
      </div>

      {/* 3. STATIC BOTTOM FOOTER: Ask ResearchMind Chat Box (Anchored to bottom edge) */}
      <div className="p-3.5 border-t border-border-default bg-bg-surface shrink-0 mt-auto shadow-lg">
        <form onSubmit={handleSendChat} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent-primary" />
              <span>Ask ResearchMind</span>
            </span>
            <span className="text-[9px] text-text-muted font-mono">
              Press Enter ↵
            </span>
          </div>

          <div className="relative flex items-center bg-bg-elevated border border-border-subtle focus-within:border-accent-primary/70 rounded-xl transition-all shadow-xs overflow-hidden">
            <textarea
              ref={textareaRef}
              rows={1}
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your project..."
              className="w-full py-2.5 pl-3 pr-10 text-[12px] text-text-primary bg-transparent placeholder:text-text-muted outline-none resize-none max-h-28 no-scrollbar leading-snug font-sans"
            />
            <button
              type="submit"
              disabled={!chatMessage.trim()}
              className="absolute right-2 bottom-2 p-1.5 rounded-lg text-accent-primary hover:text-white hover:bg-accent-primary disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-accent-primary transition-all cursor-pointer"
              title="Submit prompt"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
};
