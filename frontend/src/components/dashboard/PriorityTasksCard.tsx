import React from "react";
import type { PriorityTask } from "../../types/dashboard.types";
import { Calendar } from "lucide-react";

interface PriorityTasksCardProps {
  tasks: PriorityTask[];
}

export const PriorityTasksCard: React.FC<PriorityTasksCardProps> = ({ tasks }) => {
  // Helper for priority dot color
  const getPriorityColor = (priority: PriorityTask["priority"]) => {
    switch (priority) {
      case "high":
        return "bg-error";
      case "medium":
        return "bg-warning";
      case "low":
        return "bg-success";
      default:
        return "bg-text-muted";
    }
  };

  // Helper for status styling
  const getStatusStyle = (status: PriorityTask["status"]) => {
    switch (status) {
      case "backlog":
        return "bg-bg-elevated text-text-secondary border-border-default";
      case "todo":
        return "bg-accent-bg text-accent-primary border-accent-primary/20";
      case "in_progress":
        return "bg-warning/12 text-warning border-warning/20";
      case "completed":
        return "bg-success/12 text-success border-success/20";
      default:
        return "bg-bg-surface text-text-muted border-border-subtle";
    }
  };

  const getStatusLabel = (status: PriorityTask["status"]) => {
    switch (status) {
      case "in_progress":
        return "In Progress";
      case "completed":
        return "Completed";
      case "todo":
        return "To Do";
      case "backlog":
        return "Backlog";
      default:
        return status;
    }
  };

  return (
    <div className="bg-bg-surface border border-border-default rounded-xl p-5 flex flex-col h-full min-h-[380px] justify-between transition-all duration-200">
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">Priority Tasks</h3>
          <p className="text-[12px] text-text-muted mt-0.5">Critical items requiring immediate attention</p>
        </div>

        {/* Task rows */}
        <div className="space-y-3 overflow-y-auto max-h-[260px] pr-1">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-lg hover:border-accent-primary/20 transition-colors duration-150"
            >
              <div className="flex items-start gap-2.5">
                {/* Priority Dot */}
                <span 
                  className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getPriorityColor(task.priority)}`} 
                  title={`${task.priority} priority`}
                />
                <div className="space-y-1">
                  <span className="text-[13px] font-semibold text-text-primary block leading-tight">
                    {task.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Category tag */}
                    <span className="bg-bg-surface border border-border-default text-text-secondary text-[10px] font-medium px-1.5 py-0.5 rounded">
                      {task.category}
                    </span>
                    {/* Due date */}
                    <span className="text-text-muted text-[10px] flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {task.dueDate}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <span className={`inline-flex items-center justify-center self-start sm:self-auto text-[11px] font-bold px-2 py-0.5 rounded-full border ${getStatusStyle(task.status)}`}>
                {getStatusLabel(task.status)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-3 border-t border-border-subtle mt-4">
        <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">
          TODO: Replace with API integration
        </span>
      </div>
    </div>
  );
};
