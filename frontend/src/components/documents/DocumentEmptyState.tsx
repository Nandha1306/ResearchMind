import React from "react";
import { FileText, Plus } from "lucide-react";
import { Button } from "../ui/button";

interface DocumentEmptyStateProps {
  onUploadClick: () => void;
}

export const DocumentEmptyState: React.FC<DocumentEmptyStateProps> = ({ onUploadClick }) => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-5 animate-in fade-in duration-300">
      {/* Icon Container */}
      <div className="w-16 h-16 rounded-2xl bg-[#111111] border border-[#2A2A2A] flex items-center justify-center text-[#8B8B8F] shadow-lg">
        <FileText className="w-8 h-8 text-[#7C6AF7]" />
      </div>

      {/* Pill Badge */}
      <div className="px-3 py-1 rounded-full bg-[#1A1A1A] border border-[#2A2A2A] text-[11px] font-semibold text-[#8B8B8F] uppercase tracking-wider">
        Documents
      </div>

      {/* Heading & Description */}
      <div className="max-w-md space-y-2">
        <h2 className="text-xl sm:text-2xl font-extrabold text-[#EDEDEE] tracking-tight">
          Documents workspace
        </h2>
        <p className="text-[13px] text-[#8B8B8F] leading-relaxed">
          This focused workspace is ready for your project data. Use the command menu or ResearchMind assistant to move quickly.
        </p>
      </div>

      {/* Upload Action Button */}
      <Button
        onClick={onUploadClick}
        className="bg-[#7C6AF7] hover:bg-[#9B8DF9] text-white text-[13px] font-semibold h-10 px-5 rounded-lg flex items-center gap-2 transition-all cursor-pointer shadow-md"
      >
        <Plus className="w-4 h-4" />
        <span>Upload document</span>
      </Button>
    </div>
  );
};
