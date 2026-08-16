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
    <div className="p-8 my-6 bg-[#111111] border border-[#2A2A2A] rounded-xl text-center space-y-4 max-w-lg mx-auto">
      <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
        <AlertTriangle className="w-6 h-6" />
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-bold text-[#EDEDEE]">Unable to load documents</h3>
        <p className="text-[13px] text-[#8B8B8F] leading-relaxed">{message}</p>
      </div>

      <Button
        onClick={onRetry}
        className="bg-[#7C6AF7] hover:bg-[#9B8DF9] text-white text-[12px] font-semibold h-9 px-4 rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
      >
        <RefreshCw className="w-4 h-4" />
        <span>Try again</span>
      </Button>
    </div>
  );
};
