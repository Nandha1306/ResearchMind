import React from "react";
import type { EmbeddingStatus } from "../../types/document.types";
import { Clock, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface DocumentStatusBadgeProps {
  status: EmbeddingStatus;
}

export const DocumentStatusBadge: React.FC<DocumentStatusBadgeProps> = ({ status }) => {
  const getBadgeConfig = () => {
    switch (status) {
      case "pending":
        return {
          label: "Pending",
          bgColor: "bg-amber-500/10",
          textColor: "text-amber-400",
          borderColor: "border-amber-500/20",
          icon: <Clock className="w-3 h-3 text-amber-400" />,
        };
      case "indexing":
        return {
          label: "Indexing",
          bgColor: "bg-[#7C6AF7]/12",
          textColor: "text-[#7C6AF7]",
          borderColor: "border-[#7C6AF7]/30",
          icon: <Loader2 className="w-3 h-3 text-[#7C6AF7] animate-spin" />,
        };
      case "indexed":
        return {
          label: "Indexed",
          bgColor: "bg-emerald-500/10",
          textColor: "text-emerald-400",
          borderColor: "border-emerald-500/20",
          icon: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
        };
      case "failed":
        return {
          label: "Failed",
          bgColor: "bg-red-500/10",
          textColor: "text-red-400",
          borderColor: "border-red-500/20",
          icon: <AlertCircle className="w-3 h-3 text-red-400" />,
        };
      default:
        return {
          label: "Pending",
          bgColor: "bg-amber-500/10",
          textColor: "text-amber-400",
          borderColor: "border-amber-500/20",
          icon: <Clock className="w-3 h-3 text-amber-400" />,
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${config.bgColor} ${config.textColor} ${config.borderColor} select-none`}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
};
