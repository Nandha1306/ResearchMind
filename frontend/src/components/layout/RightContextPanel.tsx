import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../../store/workspace.store";
import { useWorkspaceDocuments } from "../../hooks/useDocuments";
import {
  Sparkles,
  SearchCode,
  FileCheck,
  Send,
  ArrowRight,
  BookOpen,
} from "lucide-react";

interface RightContextPanelProps {
  isVisible: boolean;
  onClose?: () => void;
}

export const RightContextPanel: React.FC<RightContextPanelProps> = ({ isVisible }) => {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id;
  const { data: documents = [] } = useWorkspaceDocuments(workspaceId);

  const [chatMessage, setChatMessage] = useState("");

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    navigate("/dashboard/ai-researcher");
    setChatMessage("");
  };

  if (!isVisible) return null;

  return (
    <aside className="w-80 shrink-0 bg-bg-surface border-l border-border-default flex flex-col justify-between h-[calc(100vh-3.5rem)] overflow-y-auto z-15">
      {/* Upper Area */}
      <div className="p-4 space-y-6 flex-1 overflow-y-auto no-scrollbar">
        {/* Workspace Context Info */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Workspace Context
            </h3>
            <span className="bg-accent-bg border border-accent-primary/20 text-accent-primary text-[10px] font-bold px-2 py-0.5 rounded-full">
              Active Project
            </span>
          </div>

          <div className="p-3 bg-bg-elevated border border-border-subtle rounded-lg space-y-2">
            <div>
              <span className="block text-[11px] font-semibold text-text-muted">PROJECT NAME</span>
              <span className="block text-[13px] font-bold text-text-primary mt-0.5 truncate">
                {currentWorkspace?.name || "No active project"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-border-subtle/50 mt-2">
              <div>
                <span className="block text-[10px] font-semibold text-text-muted">INDEXED</span>
                <span className="block text-[14px] font-bold text-text-primary mt-0.5">
                  {documents.length} Sources
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold text-text-muted">MEMBERS</span>
                <span className="block text-[14px] font-bold text-text-primary mt-0.5">
                  {currentWorkspace?.members?.length || 1} Users
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Quick Actions
          </h3>
          <div className="space-y-2">
            <button
              onClick={() => navigate("/dashboard/ai-researcher")}
              className="w-full h-9 flex items-center justify-between px-3 text-[12px] font-medium text-text-primary bg-bg-elevated border border-border-subtle hover:border-accent-primary/40 rounded-lg text-left transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <SearchCode className="w-4 h-4 text-accent-primary" />
                AI Researcher Q&A
              </span>
              <ArrowRight className="w-3 h-3 text-text-muted" />
            </button>

            <button
              onClick={() => navigate("/dashboard/documents")}
              className="w-full h-9 flex items-center justify-between px-3 text-[12px] font-medium text-text-primary bg-bg-elevated border border-border-subtle hover:border-accent-primary/40 rounded-lg text-left transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#38BDF8]" />
                Browse Documents
              </span>
              <ArrowRight className="w-3 h-3 text-text-muted" />
            </button>

            <button
              onClick={() => navigate("/dashboard/documents")}
              className="w-full h-9 flex items-center justify-between px-3 text-[12px] font-medium text-text-primary bg-bg-elevated border border-border-subtle hover:border-accent-primary/40 rounded-lg text-left transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-success" />
                Upload New Document
              </span>
              <ArrowRight className="w-3 h-3 text-text-muted" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Area: Mini AI Chat Input */}
      <div className="p-4 border-t border-border-default bg-bg-surface shrink-0">
        <form onSubmit={handleSendChat} className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent-primary" />
              Ask ResearchMind
            </span>
          </div>

          <div className="relative flex items-center">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              placeholder="Ask about your project..."
              className="w-full h-10 pl-3 pr-10 text-[12px] text-text-primary bg-bg-elevated border border-border-subtle rounded-lg focus:border-accent-primary/60 outline-none transition-all"
            />
            <button
              type="submit"
              disabled={!chatMessage.trim()}
              className="absolute right-2 p-1.5 rounded-md text-accent-primary hover:text-accent-hover hover:bg-accent-bg disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
};
