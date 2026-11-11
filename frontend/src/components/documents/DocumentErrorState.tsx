import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";

interface DocumentErrorStateProps {
  message?: string;
  onRetry: () => void;
}

export const DocumentErrorState: React.FC<DocumentErrorStateProps> = ({
  message = "Something went wrong while fetching your workspace documents.",
  onRetry,
}) => {
  return (
    <div className="p-8 my-6 bg-bg-surface border border-border-default rounded-xl text-center space-y-4 max-w-lg mx-auto shadow-sm">
      <div className="w-12 h-12 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center mx-auto">
        <AlertTriangle className="w-6 h-6" />
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-bold text-text-primary">Unable to load documents</h3>
        <p className="text-[13px] text-text-secondary leading-relaxed">{message}</p>
      </div>

      <Button
        onClick={onRetry}
        className="bg-accent-primary hover:bg-accent-hover text-white text-[12px] font-semibold h-9 px-4 rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
      >
        <RefreshCw className="w-4 h-4" />
        <span>Try again</span>
      </Button>
    </div>
  );
};
