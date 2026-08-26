import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { CreateWorkspacePage } from "../pages/CreateWorkspacePage";
import { ProtectedRoute } from "./ProtectedRoute";
import { useWorkspaceStore } from "../store/workspace.store";
import { Loader2, AlertCircle, RotateCcw } from "lucide-react";

// Full-screen state shown while the workspace list is being resolved for the
// first time in this session.
const WorkspaceResolvingScreen: React.FC = () => (
  <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-3">
    <Loader2 className="w-8 h-8 animate-spin text-[#7C6AF7]" />
    <span className="text-muted-foreground text-[13px]">Verifying workspaces...</span>
  </div>
);

// Full-screen state shown when the workspace list could not be loaded at all.
// This must NOT fall through to the onboarding redirect: a failed request is
// not the same thing as "this user has no workspaces".
const WorkspaceUnavailableScreen: React.FC<{
  message: string | null;
  onRetry: () => void;
}> = ({ message, onRetry }) => (
  <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-4 p-6 text-center">
    <div className="w-12 h-12 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center">
      <AlertCircle className="w-6 h-6 text-destructive" />
    </div>
    <div className="space-y-1.5 max-w-sm">
      <h2 className="text-base font-bold text-[#EDEDEE]">Couldn't load your workspaces</h2>
      <p className="text-[13px] text-muted-foreground leading-relaxed">
        {message || "We couldn't reach the workspace service. Check your connection and try again."}
      </p>
    </div>
    <button
      onClick={onRetry}
      className="h-9 px-4 rounded-lg bg-[#7C6AF7] hover:bg-[#6b58f6] text-white text-[13px] font-semibold flex items-center gap-2 cursor-pointer transition-colors"
    >
      <RotateCcw className="w-3.5 h-3.5" />
      <span>Try again</span>
    </button>
  </div>
);

/**
 * Guard for every workspace-scoped route.
 *
 * The zero-workspace decision may only be made AFTER the workspace list has
 * actually been resolved from the server. `workspaces.length === 0` on its own
 * is ambiguous: at first render it just means "not fetched yet".
 *
 * `hasFetchedWorkspaces` (not `isLoading`) is the gate on purpose. `isLoading`
 * is shared with createWorkspace/joinWorkspace, and CreateWorkspaceModal is
 * rendered inside this guard via Sidebar -> AppShell — blocking on `isLoading`
 * would tear the whole app down to a loading screen mid-submit.
 */
const OnboardingGuard: React.FC = () => {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const hasFetchedWorkspaces = useWorkspaceStore((state) => state.hasFetchedWorkspaces);
  const isFetchingWorkspaces = useWorkspaceStore((state) => state.isFetchingWorkspaces);
  const error = useWorkspaceStore((state) => state.error);
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // The list is "undecided" until the first fetch settles, and again whenever a
  // fetch is in flight with nothing to fall back on (e.g. a retry after an
  // error). Requiring `workspaces.length === 0` here keeps a background refetch
  // from tearing the mounted dashboard down to a loading screen.
  const isUndecided =
    !hasFetchedWorkspaces || (isFetchingWorkspaces && workspaces.length === 0);

  // 1. Not resolved yet — hold. Never redirect on an unresolved empty list.
  if (isUndecided) {
    return <WorkspaceResolvingScreen />;
  }

  // 2. Resolved, but the request failed and we have nothing to show. Offer a
  //    retry instead of misreading the failure as "no workspaces".
  if (error && workspaces.length === 0) {
    return <WorkspaceUnavailableScreen message={error} onRetry={fetchWorkspaces} />;
  }

  // 3. Resolved and genuinely empty — this user needs onboarding.
  if (workspaces.length === 0) {
    return <Navigate to="/create-workspace" replace />;
  }

  return <Outlet />;
};

import { AppShell } from "../layouts/AppShell";
import { OverviewPage } from "../pages/OverviewPage";
import { DocumentsPage } from "../pages/DocumentsPage";
import { SemanticSearchPage } from "../pages/SemanticSearchPage";
import { MeetingSummarizerPage } from "../pages/MeetingSummarizerPage";
import { KanbanPage } from "../pages/KanbanPage";

// Generic placeholder page to render for sub-routes under development
const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] text-center bg-bg-base text-text-primary">
      <div className="max-w-md space-y-4 p-8 bg-bg-surface border border-border-default rounded-xl shadow-lg">
        <div className="w-12 h-12 rounded-xl bg-accent-bg flex items-center justify-center text-accent-primary font-bold text-lg mx-auto">
          RM
        </div>
        <h2 className="text-xl font-bold text-text-primary mt-4">{title}</h2>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          The <strong>{title}</strong> module is currently in development. It will soon connect to the ResearchMind AI backend infrastructure to provide full research automation workflows.
        </p>
      </div>
    </div>
  );
};

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          {/* Dashboard Guard: verify user has at least 1 workspace */}
          <Route element={<OnboardingGuard />}>
            {/* App Layout Shell wrapping all authenticated dashboard pages */}
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<OverviewPage />} />
              <Route path="/dashboard/tasks" element={<KanbanPage />} />
              <Route path="/dashboard/documents" element={<DocumentsPage />} />
              <Route path="/dashboard/sources" element={<PlaceholderPage title="Data Sources" />} />
              <Route path="/dashboard/analytics" element={<PlaceholderPage title="Analytics Insight" />} />
              <Route path="/dashboard/ai-researcher" element={<SemanticSearchPage />} />
              <Route path="/app/workspace/:id/search" element={<SemanticSearchPage />} />
              <Route path="/dashboard/literature-review" element={<PlaceholderPage title="Literature Review Summarizer" />} />
              <Route path="/dashboard/meeting-notes" element={<MeetingSummarizerPage />} />
              <Route path="/dashboard/report-drafter" element={<PlaceholderPage title="Report Drafter Copilot" />} />
              <Route path="/dashboard/settings" element={<PlaceholderPage title="Workspace Settings" />} />
            </Route>
          </Route>

          {/* Onboarding & Creation Route: accessible to all authenticated users */}
          <Route path="/create-workspace" element={<CreateWorkspacePage />} />
        </Route>

        {/* Default Redirects */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
