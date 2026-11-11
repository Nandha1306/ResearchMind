import React from "react";

interface DocumentSkeletonProps {
  count?: number;
}

export const DocumentSkeleton: React.FC<DocumentSkeletonProps> = ({ count = 6 }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="bg-bg-surface border border-border-default rounded-xl p-4 space-y-3.5 animate-pulse"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-9 h-9 rounded-lg bg-bg-elevated shrink-0" />
            <div className="w-16 h-5 rounded-full bg-bg-elevated" />
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="h-4 bg-bg-elevated rounded w-3/4" />
            <div className="h-3 bg-bg-elevated rounded w-1/2" />
          </div>

          <div className="pt-3 border-t border-border-subtle flex items-center justify-between">
            <div className="h-3 bg-bg-elevated rounded w-16" />
            <div className="h-3 bg-bg-elevated rounded w-20" />
          </div>
        </div>
      ))}
    </div>
  );
};
