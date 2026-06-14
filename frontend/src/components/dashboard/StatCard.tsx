import React from "react";
import type { StatCardProps } from "../../types/dashboard.types";

export const StatCard: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  subtext,
}) => {
  return (
    <div className="bg-bg-surface border border-border-default rounded-xl p-5 flex flex-col justify-between transition-all duration-200 hover:border-accent-primary/40">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-secondary">{label}</span>
        <div className="p-2 rounded-lg bg-accent-bg text-accent-primary flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-2xl font-semibold text-text-primary tracking-tight">{value}</h3>
        <p className="text-[12px] text-text-muted mt-1">{subtext}</p>
      </div>
    </div>
  );
};
