import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth.store";
import { useWorkspaceStore } from "../store/workspace.store";
import { useWorkspaceDocuments } from "../hooks/useDocuments";
import { fetchWorkspaceSessions } from "../api/ai.api";
import type { AISessionHistoryItem } from "../utils/sse";
import { StatCard } from "../components/dashboard/StatCard";
import { InsightCard } from "../components/dashboard/InsightCard";
import { UploadDocumentModal } from "../components/documents/UploadDocumentModal";
import { useUploadDocument } from "../hooks/useDocuments";
import {
  Database,
  Users,
  Brain,
  Upload,
  Sparkles,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import { Button } from "../components/ui/button";

export const OverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id;

  // Real backend documents data
  const { data: documents = [] } = useWorkspaceDocuments(workspaceId);
  const uploadMutation = useUploadDocument(workspaceId);

  // Real MongoDB AI session history
  const [sessions, setSessions] = useState<AISessionHistoryItem[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    fetchWorkspaceSessions(workspaceId)
      .then((items) => setSessions(items))
      .catch((err) => console.warn("Could not fetch sessions for overview:", err));
  }, [workspaceId]);

  // Polished greeting based on local client hour
  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning";
    if (hr < 17) return "Good afternoon";
    return "Good evening";
  };

  const analyzingCount = documents.filter(
    (d) => d.embeddingStatus === "pending" || d.embeddingStatus === "indexing"
  ).length;

  const latestSession = sessions.length > 0 ? sessions[0] : null;

  const handleUploadSubmit = async (file: File) => {
    await uploadMutation.mutateAsync(file);
    setIsUploadModalOpen(false);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
      {/* 1. Header greeting & quick action buttons */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent-bg text-accent-primary text-[10px] font-bold border border-accent-primary/20">
            <Sparkles className="w-3.5 h-3.5 text-accent-primary" />
            <span>AI Research Workspace Active</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">
            {getGreeting()}, {user?.name || "Researcher"}
          </h1>
          <p className="text-[13px] text-text-secondary">
            {currentWorkspace?.description || "Build and review research workflows for your current workspace projects."}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            onClick={() => setIsUploadModalOpen(true)}
            className="bg-bg-surface border border-border-default hover:bg-bg-elevated text-text-primary text-[12px] font-semibold h-9 px-4 rounded-lg flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4 text-text-secondary" />
            <span>Upload Document</span>
          </Button>

          <Button
            onClick={() => navigate("/dashboard/ai-researcher")}
            className="bg-accent-primary hover:bg-accent-hover text-white text-[12px] font-semibold h-9 px-4 rounded-lg flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
          >
            <Brain className="w-4 h-4" />
            <span>Ask AI</span>
          </Button>
        </div>
      </div>

      {/* 2. Real Key Metric Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          icon={<Database className="w-4 h-4 text-accent-primary" />}
          label="Sources Indexed"
          value={`${documents.length} Document${documents.length === 1 ? "" : "s"}`}
          subtext={
            analyzingCount > 0
              ? `${analyzingCount} sources processing`
              : "All sources indexed & searchable"
          }
        />
        <StatCard
          icon={<Brain className="w-4 h-4 text-[#38BDF8]" />}
          label="AI Q&A Sessions"
          value={`${sessions.length} Session${sessions.length === 1 ? "" : "s"}`}
          subtext="Logged in MongoDB database"
        />
        <StatCard
          icon={<Users className="w-4 h-4 text-success" />}
          label="Workspace Members"
          value={`${currentWorkspace?.members?.length || 1} User${(currentWorkspace?.members?.length || 1) === 1 ? "" : "s"}`}
          subtext="Active project team"
        />
      </div>

      {/* 3. Primary AI Session Insight Card (Rendered only when real session data exists) */}
      {latestSession ? (
        <div className="w-full">
          <InsightCard
            title={latestSession.query}
            description={latestSession.answer}
            timestamp={new Date(latestSession.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
            impactMetric={`${latestSession.sources?.length || 0} Citations`}
            ctaText="Ask AI Researcher"
            onCtaClick={() => navigate("/dashboard/ai-researcher")}
          />
        </div>
      ) : (
        <div className="p-6 bg-bg-surface border border-border-default rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-left">
            <h3 className="text-sm font-bold text-text-primary flex items-center justify-center sm:justify-start gap-2">
              <Sparkles className="w-4 h-4 text-accent-primary" />
              <span>Start Your First AI Research Session</span>
            </h3>
            <p className="text-[12px] text-text-secondary">
              Ask natural language questions about your workspace documents to generate grounded answers with source citations.
            </p>
          </div>
          <Button
            onClick={() => navigate("/dashboard/ai-researcher")}
            className="bg-accent-primary hover:bg-accent-hover text-white text-[12px] font-semibold h-9 px-4 rounded-lg flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <span>Open AI Researcher</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* 4. Real Workspace Profile & Quick Access */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workspace Metadata Details */}
        <div className="lg:col-span-2 bg-bg-surface border border-border-default rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-text-primary">
              Workspace Information — {currentWorkspace?.name || "Active Workspace"}
            </h3>
            <p className="text-[12px] text-text-muted mt-0.5">
              Verified details from workspace backend service.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[12px]">
            <div className="p-3 bg-bg-elevated border border-border-subtle rounded-lg space-y-1">
              <span className="block font-semibold text-text-muted text-[10px] uppercase tracking-wider">
                WORKSPACE ID
              </span>
              <span className="block font-mono text-text-primary font-bold select-all truncate">
                {currentWorkspace?._id || "N/A"}
              </span>
            </div>

            {currentWorkspace?.inviteCode && (
              <div className="p-3 bg-bg-elevated border border-border-subtle rounded-lg space-y-1">
                <span className="block font-semibold text-text-muted text-[10px] uppercase tracking-wider">
                  INVITE CODE
                </span>
                <span className="block font-mono text-accent-primary font-bold select-all">
                  {currentWorkspace.inviteCode}
                </span>
              </div>
            )}

            <div className="p-3 bg-bg-elevated border border-border-subtle rounded-lg space-y-1">
              <span className="block font-semibold text-text-muted text-[10px] uppercase tracking-wider">
                CREATED AT
              </span>
              <span className="block text-text-primary font-medium">
                {currentWorkspace?.createdAt
                  ? new Date(currentWorkspace.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "N/A"}
              </span>
            </div>

            <div className="p-3 bg-bg-elevated border border-border-subtle rounded-lg space-y-1">
              <span className="block font-semibold text-text-muted text-[10px] uppercase tracking-wider">
                TEAM MEMBERS
              </span>
              <span className="block text-text-primary font-medium">
                {currentWorkspace?.members?.length || 1} Member(s)
              </span>
            </div>
          </div>
        </div>

        {/* Workspace Quick Actions */}
        <div className="lg:col-span-1 bg-bg-surface border border-border-default rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-base font-semibold text-text-primary">Quick Navigation</h3>
            <p className="text-[12px] text-text-muted mt-0.5">Jump directly to active workspace modules</p>
          </div>

          <div className="space-y-2.5">
            <button
              onClick={() => navigate("/dashboard/documents")}
              className="w-full p-3 rounded-lg bg-bg-elevated hover:bg-bg-elevated/70 border border-border-subtle transition-colors flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-accent-primary" />
                <div>
                  <span className="block text-[12px] font-bold text-text-primary">Documents Library</span>
                  <span className="block text-[10px] text-text-muted">{documents.length} files uploaded</span>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
            </button>

            <button
              onClick={() => navigate("/dashboard/ai-researcher")}
              className="w-full p-3 rounded-lg bg-bg-elevated hover:bg-bg-elevated/70 border border-border-subtle transition-colors flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Brain className="w-4 h-4 text-[#38BDF8]" />
                <div>
                  <span className="block text-[12px] font-bold text-text-primary">AI Researcher Q&A</span>
                  <span className="block text-[10px] text-text-muted">{sessions.length} sessions logged</span>
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
            </button>
          </div>

          <div className="pt-3 border-t border-border-subtle">
            <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">
              ResearchMind Monorepo Active
            </span>
          </div>
        </div>
      </div>

      {/* Upload Document Modal */}
      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUpload={handleUploadSubmit}
        isUploading={uploadMutation.isPending}
      />
    </div>
  );
};
