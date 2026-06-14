import React from "react";
import { useAuthStore } from "../store/auth.store";
import { useWorkspaceStore } from "../store/workspace.store";
import { StatCard } from "../components/dashboard/StatCard";
import { InsightCard } from "../components/dashboard/InsightCard";
import { ResearchActivityCard } from "../components/dashboard/ResearchActivityCard";
import { TeamWorkloadCard } from "../components/dashboard/TeamWorkloadCard";
import { PriorityTasksCard } from "../components/dashboard/PriorityTasksCard";
import {
  Activity,
  Database,
  CheckSquare,
  Clock,
  Upload,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "../components/ui/button";

export const OverviewPage: React.FC = () => {
  const { user } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();

  // Polished greeting based on local client hour
  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning";
    if (hr < 17) return "Good afternoon";
    return "Good evening";
  };

  const handleUploadSource = () => {
    alert("Upload Source action clicked! Future implementation will open a PDF/TXT drag-and-drop file upload dialog.");
  };

  const handleNewTask = () => {
    alert("Create New Task action clicked! Future integration will open a modal to assign and schedule workspace tasks.");
  };

  // Mock Activity Data (Line Chart)
  // TODO: Replace with API integration
  const mockActivityData = [
    { day: "Mon", sourcesReviewed: 2, notesCreated: 5 },
    { day: "Tue", sourcesReviewed: 5, notesCreated: 8 },
    { day: "Wed", sourcesReviewed: 3, notesCreated: 6 },
    { day: "Thu", sourcesReviewed: 9, notesCreated: 14 },
    { day: "Fri", sourcesReviewed: 6, notesCreated: 10 },
    { day: "Sat", sourcesReviewed: 2, notesCreated: 4 },
    { day: "Sun", sourcesReviewed: 7, notesCreated: 11 },
  ];

  // Mock Teammate Workload
  // TODO: Replace with API integration
  const mockTeamMembers = [
    { id: "1", name: user?.name || "Researcher", role: "Lead Developer", tasksCompleted: 8, totalTasks: 11 },
    { id: "2", name: "Dr. Sarah Jenkins", role: "Research Advisor", tasksCompleted: 5, totalTasks: 6 },
    { id: "3", name: "David Chen", role: "Data Scientist", tasksCompleted: 11, totalTasks: 16 },
    { id: "4", name: "Elena Rostova", role: "Literature Analyst", tasksCompleted: 3, totalTasks: 8 },
  ];

  // Mock Priority Tasks
  // TODO: Replace with API integration
  const mockTasks = [
    {
      id: "t1",
      title: "Validate solar irradiance grid thermal coefficients",
      priority: "high" as const,
      category: "Hardware",
      dueDate: "June 16, 2026",
      status: "in_progress" as const,
    },
    {
      id: "t2",
      title: "Review distributed battery temperature sensitivity paper",
      priority: "high" as const,
      category: "Literature",
      dueDate: "June 15, 2026",
      status: "todo" as const,
    },
    {
      id: "t3",
      title: "Draft advisor update slide-deck on microgrid nodes",
      priority: "medium" as const,
      category: "Reporting",
      dueDate: "June 18, 2026",
      status: "todo" as const,
    },
    {
      id: "t4",
      title: "Clean weather sensor telemetry logs",
      priority: "low" as const,
      category: "Data Clean",
      dueDate: "June 20, 2026",
      status: "completed" as const,
    },
    {
      id: "t5",
      title: "Consolidate bibliography from references list",
      priority: "medium" as const,
      category: "Writing",
      dueDate: "June 22, 2026",
      status: "backlog" as const,
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      
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
            onClick={handleUploadSource}
            className="bg-bg-surface border border-border-default hover:bg-bg-elevated text-text-primary text-[12px] font-semibold h-9 px-4 rounded-lg flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4 text-text-secondary" />
            <span>Upload Source</span>
          </Button>

          <Button
            onClick={handleNewTask}
            className="bg-accent-primary hover:bg-accent-hover text-white text-[12px] font-semibold h-9 px-4 rounded-lg flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Task</span>
          </Button>
        </div>
      </div>

      {/* 2. Key Metric Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="Project Progress"
          value="68%"
          subtext="+4.2% activity since yesterday"
        />
        <StatCard
          icon={<Database className="w-4 h-4" />}
          label="Sources Indexed"
          value="18 Documents"
          subtext="4 sources currently analyzing"
        />
        <StatCard
          icon={<CheckSquare className="w-4 h-4" />}
          label="Open Tasks"
          value="12 Actions"
          subtext="3 action items due today"
        />
        <StatCard
          icon={<Clock className="w-4 h-4" />}
          label="Research Hours"
          value="142 hrs"
          subtext="28 hours logged this week"
        />
      </div>

      {/* 3. Primary highlighted AI Insight Card */}
      <div className="w-full">
        <InsightCard
          title="Microgrid secondary battery nodes show high thermal sensitivity spikes"
          description="Cross-referencing solar irradiance peaks and battery telemetry over the last 48 hours reveals that sector 3 temperature sensors exceeded normal operating thresholds by 12%. Upgrading node heat dissipation is recommended to prevent telemetry drops."
          timestamp="Generated 2 hours ago"
          impactMetric="8.6/10"
          onCtaClick={() => alert("Explore with AI insight: loading comparative battery charts in researchers chatbot panel...")}
        />
      </div>

      {/* 4. Bottom Grid sections: Activity Line Chart & Team Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ResearchActivityCard data={mockActivityData} />
        </div>
        <div className="lg:col-span-1">
          <TeamWorkloadCard members={mockTeamMembers} />
        </div>
      </div>

      {/* 5. Priority Tasks & Workspace Details metadata grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PriorityTasksCard tasks={mockTasks} />
        </div>
        
        {/* Workspace Quick Metadata details card */}
        <div className="lg:col-span-1 bg-bg-surface border border-border-default rounded-xl p-5 flex flex-col justify-between transition-all duration-200">
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-text-primary">Workspace Profile</h3>
              <p className="text-[12px] text-text-muted mt-0.5">Invite coordinates and workspace config</p>
            </div>

            <div className="space-y-3.5 text-[12px]">
              <div>
                <span className="block font-semibold text-text-muted">ACTIVE ID</span>
                <span className="block font-mono text-text-primary mt-0.5 select-all">{currentWorkspace?._id || "N/A"}</span>
              </div>
              <div className="pt-2.5 border-t border-border-subtle/50">
                <span className="block font-semibold text-text-muted">INVITE CODE</span>
                <span className="block font-mono text-accent-primary font-bold mt-0.5 select-all">{currentWorkspace?.inviteCode || "N/A"}</span>
              </div>
              <div className="pt-2.5 border-t border-border-subtle/50">
                <span className="block font-semibold text-text-muted">CREATED DATE</span>
                <span className="block text-text-primary mt-0.5">
                  {currentWorkspace?.createdAt ? new Date(currentWorkspace.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  }) : "June 12, 2026"}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-border-subtle mt-4">
            <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">
              Workspace verified
            </span>
          </div>
        </div>
      </div>

    </div>
  );
};
