import type { ReactNode } from "react";

export interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  subtext: string;
}

export interface InsightCardProps {
  title: string;
  description: string;
  timestamp: string;
  impactMetric: string;
  ctaText?: string;
  onCtaClick?: () => void;
}

export interface ResearchActivityDataPoint {
  day: string;
  sourcesReviewed: number;
  notesCreated: number;
}

export interface TeamWorkloadMember {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string;
  tasksCompleted: number;
  totalTasks: number;
}

export interface PriorityTask {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  category: string;
  dueDate: string;
  status: "backlog" | "todo" | "in_progress" | "completed";
}
