import React from "react";
import { Sparkles, Edit2, Check, ArrowLeft, Send, Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspace.store";
import { useAuthStore } from "../../store/auth.store";
import type { LocalOnboardingData } from "../../types/workspace.types";
import { Button } from "../ui/button";

interface ReviewWorkspaceStepProps {
  data: LocalOnboardingData;
  onBack: () => void;
  onGoToStep: (stepIndex: number) => void;
  onSubmit: () => void;
}

export const ReviewWorkspaceStep: React.FC<ReviewWorkspaceStepProps> = ({
  data,
  onBack,
  onGoToStep,
  onSubmit,
}) => {
  const { user } = useAuthStore();
  const { isLoading, error } = useWorkspaceStore();

  const aiFeatures = [
    "RAG-powered semantic search across documents",
    "AI agent for task creation and automation",
    "Literature review generation from uploaded papers",
    "Meeting notes summarizer and task extractor",
  ];

  return (
    <div className="w-full max-w-[500px] space-y-6 text-left">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 bg-[rgba(124,106,247,0.08)] dark:bg-[rgba(124,106,247,0.12)] border border-primary text-primary text-[11px] rounded px-2 py-0.5 w-fit mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Step 4 of 4</span>
        </div>
        <h2 className="text-[22px] font-semibold text-foreground leading-tight mb-1">
          Review &amp; create
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Confirm your workspace details before launching.
        </p>
      </div>

      {/* API Submission error display */}
      {error && (
        <div className="w-full p-3 bg-destructive/10 border border-destructive text-destructive text-[12px] rounded-lg flex items-start gap-2">
          <span>{error}</span>
        </div>
      )}

      {/* Card 1: Workspace Overview */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 relative">
        <div className="flex justify-between items-center pb-2 border-b border-border">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </span>
          <button
            onClick={() => onGoToStep(0)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-accent-foreground cursor-pointer"
          >
            <Edit2 className="w-3 h-3" />
            <span>Edit</span>
          </button>
        </div>
        <div className="grid grid-cols-3 gap-y-3 text-[13px] pt-1">
          <span className="text-muted-foreground font-medium col-span-1">Name</span>
          <span className="text-foreground col-span-2 font-medium">{data.name}</span>

          <span className="text-muted-foreground font-medium col-span-1">URL</span>
          <span className="text-primary truncate col-span-2 select-all font-medium">
            researchmind.dev/{data.urlSlug}
          </span>

          <span className="text-muted-foreground font-medium col-span-1">Domain</span>
          <span className="text-foreground col-span-2 font-medium">{data.selectedDomain}</span>
        </div>
      </div>

      {/* Card 2: Team Members Card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-border">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Team ({1 + (data.teammates?.length || 0)} members)
          </span>
          <button
            onClick={() => onGoToStep(2)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-accent-foreground cursor-pointer"
          >
            <Edit2 className="w-3 h-3" />
            <span>Edit</span>
          </button>
        </div>
        <div className="space-y-3 pt-1">
          {/* Owner */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-bold text-primary flex items-center justify-center shrink-0">
              YO
            </div>
            <div className="text-[13px] truncate">
              <span className="text-foreground font-medium">{user?.name || "You"}</span>
              <span className="text-muted-foreground ml-1">(Lead)</span>
            </div>
          </div>
          {/* Invites */}
          {data.teammates?.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-secondary text-[10px] font-bold text-muted-foreground flex items-center justify-center shrink-0 uppercase">
                {item.email.slice(0, 2)}
              </div>
              <div className="text-[13px] truncate">
                <span className="text-foreground font-medium">{item.email}</span>
                <span className="text-muted-foreground ml-1.5">• {item.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Card 3: AI Features enabled after creation */}
      <div className="bg-card/50 border border-border/80 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-1.5 text-primary text-[12px] font-semibold">
          <Sparkles className="w-4 h-4" />
          <span>AI features enabled after creation</span>
        </div>
        <ul className="space-y-2">
          {aiFeatures.map((feat, index) => (
            <li key={index} className="flex items-start gap-2 text-[12px] text-muted-foreground">
              <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
              <span>{feat}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Stepper Footer buttons */}
      <div className="flex justify-between pt-4 border-t border-border gap-3">
        <Button
          type="button"
          onClick={onBack}
          disabled={isLoading}
          className="h-10 px-5 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md font-medium text-[14px] transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isLoading}
          className="h-10 px-6 bg-primary text-white hover:bg-primary/90 font-medium text-[14px] rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Launching...</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Create Workspace</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
