import React from "react";
import type { TeamWorkloadMember } from "../../types/dashboard.types";

interface TeamWorkloadCardProps {
  members: TeamWorkloadMember[];
}

export const TeamWorkloadCard: React.FC<TeamWorkloadCardProps> = ({ members }) => {
  return (
    <div className="bg-bg-surface border border-border-default rounded-xl p-5 flex flex-col h-full min-h-[380px] justify-between transition-all duration-200">
      <div>
        <h3 className="text-base font-semibold text-text-primary">Team Workload</h3>
        <p className="text-[12px] text-text-muted mt-0.5">Task distribution and completion across researchers</p>
      </div>

      <div className="mt-5 space-y-4 flex-1 overflow-y-auto pr-1">
        {members.map((member) => {
          const completionPercentage = Math.round(
            (member.tasksCompleted / member.totalTasks) * 100
          ) || 0;

          // Helper to get initials
          const initials = member.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

          return (
            <div key={member.id} className="space-y-2 border-b border-border-subtle/50 pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt={member.name}
                      className="w-8 h-8 rounded-full object-cover border border-border-subtle"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-accent-bg text-accent-primary font-bold text-[12px] flex items-center justify-center border border-accent-primary/20">
                      {initials}
                    </div>
                  )}
                  <div>
                    <h4 className="text-[13px] font-semibold text-text-primary leading-tight">
                      {member.name}
                    </h4>
                    <span className="text-[11px] text-text-muted block mt-0.5">
                      {member.role}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[12px] font-bold text-text-primary">
                    {member.tasksCompleted}/{member.totalTasks}
                  </span>
                  <span className="text-[11px] text-text-muted block mt-0.5">
                    {completionPercentage}% Done
                  </span>
                </div>
              </div>

              {/* Progress bar container */}
              <div className="w-full h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-primary transition-all duration-300 rounded-full"
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="pt-3 border-t border-border-subtle mt-2">
        <span className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">
          TODO: Replace with API integration
        </span>
      </div>
    </div>
  );
};
