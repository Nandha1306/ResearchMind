import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { CreateWorkspacePage } from "../pages/CreateWorkspacePage";
import { ProtectedRoute } from "./ProtectedRoute";
import { useWorkspaceStore } from "../store/workspace.store";
import { Loader2 } from "lucide-react";

// Guard: If unauthenticated, redirect to login.
// If authenticated and has workspaces, let them pass. If 0 workspaces, force redirect to /create-workspace.
const OnboardingGuard: React.FC = () => {
  const { workspaces, fetchWorkspaces, isLoading } = useWorkspaceStore();

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#7C6AF7]" />
        <span className="text-muted-foreground text-[13px]">Verifying workspaces...</span>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return <Navigate to="/create-workspace" replace />;
  }

  return <Outlet />;
};

// Guard: If authenticated and user already has workspaces, redirect to /dashboard.
// Otherwise, let them access /create-workspace to onboarding.
const CreateWorkspaceGuard: React.FC = () => {
  const { workspaces, fetchWorkspaces, isLoading } = useWorkspaceStore();

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#7C6AF7]" />
        <span className="text-muted-foreground text-[13px]">Checking workspace status...</span>
      </div>
    );
  }

  if (workspaces.length > 0) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

import { AppShell } from "../layouts/AppShell";
import { OverviewPage } from "../pages/OverviewPage";

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
              <Route path="/dashboard/tasks" element={<PlaceholderPage title="Tasks Workflow" />} />
              <Route path="/dashboard/documents" element={<PlaceholderPage title="Documents Directory" />} />
              <Route path="/dashboard/sources" element={<PlaceholderPage title="Data Sources" />} />
              <Route path="/dashboard/analytics" element={<PlaceholderPage title="Analytics Insight" />} />
              <Route path="/dashboard/ai-researcher" element={<PlaceholderPage title="AI Researcher Agent" />} />
              <Route path="/dashboard/literature-review" element={<PlaceholderPage title="Literature Review Summarizer" />} />
              <Route path="/dashboard/meeting-notes" element={<PlaceholderPage title="Meeting Notes Transcriber" />} />
              <Route path="/dashboard/report-drafter" element={<PlaceholderPage title="Report Drafter Copilot" />} />
              <Route path="/dashboard/settings" element={<PlaceholderPage title="Workspace Settings" />} />
            </Route>
          </Route>

          {/* Onboarding Guard: redirect user to dashboard if they already have workspace(s) */}
          <Route element={<CreateWorkspaceGuard />}>
            <Route path="/create-workspace" element={<CreateWorkspacePage />} />
          </Route>
        </Route>

        {/* Default Redirects */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
