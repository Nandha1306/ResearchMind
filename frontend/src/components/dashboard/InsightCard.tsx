import React from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import type { InsightCardProps } from "../../types/dashboard.types";
import { Button } from "../ui/button";

export const InsightCard: React.FC<InsightCardProps> = ({
  title,
  description,
  timestamp,
  impactMetric,
  ctaText = "Explore with AI",
  onCtaClick,
}) => {
  return (
    <div className="relative overflow-hidden bg-bg-surface border border-border-default hover:border-accent-primary/30 rounded-xl p-6 transition-all duration-200">
      {/* Decorative top border highlight */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent-primary" />
      
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
        {/* Left main content */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2 text-accent-primary">
            <Sparkles className="w-4 h-4 fill-accent-primary" />
            <span className="text-[11px] font-bold uppercase tracking-widest">ResearchMind Insight</span>
            <span className="text-text-muted text-[11px] font-normal">• {timestamp}</span>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg md:text-xl font-bold text-text-primary leading-tight">
              {title}
            </h2>
            <p className="text-[13px] text-text-secondary leading-relaxed max-w-2xl">
              {description}
            </p>
          </div>

          <div className="pt-2">
            <Button
              onClick={onCtaClick}
              className="bg-accent-primary hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-2 h-9 rounded-lg gap-2 cursor-pointer flex items-center shadow-sm transition-all duration-150"
            >
              <span>{ctaText}</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Right Metric Area */}
        <div className="flex flex-col items-start md:items-end justify-center min-w-[120px] p-4 bg-bg-elevated border border-border-subtle rounded-xl text-left md:text-right self-stretch md:self-auto">
          <span className="text-[11px] uppercase tracking-wider text-text-muted font-bold block">
            Potential Impact
          </span>
          <span className="text-3xl font-extrabold text-accent-primary tracking-tight mt-1">
            {impactMetric}
          </span>
          <span className="text-[11px] text-text-secondary mt-0.5">High Priority</span>
        </div>
      </div>
    </div>
  );
};
