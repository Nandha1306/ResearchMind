import React from "react";
import { Sparkles, Plus, Trash2, Mail, UserCheck } from "lucide-react";
import { useAuthStore } from "../../store/auth.store";
import type { LocalOnboardingData, LocalTeammate } from "../../types/workspace.types";
import { Button } from "../ui/button";

interface InviteTeamStepProps {
  data: LocalOnboardingData;
  updateData: (updates: Partial<LocalOnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export const InviteTeamStep: React.FC<InviteTeamStepProps> = ({
  data,
  updateData,
  onNext,
  onBack,
}) => {
  const { user } = useAuthStore();
  const teammates = data.teammates || [];

  const handleAddTeammate = () => {
    const newTeammate: LocalTeammate = { email: "", role: "Member" };
    updateData({ teammates: [...teammates, newTeammate] });
  };

  const handleRemoveTeammate = (index: number) => {
    const updated = teammates.filter((_, idx) => idx !== index);
    updateData({ teammates: updated });
  };

  const handleFieldChange = (index: number, field: keyof LocalTeammate, value: string) => {
    const updated = teammates.map((item, idx) => {
      if (idx === index) {
        return { ...item, [field]: value };
      }
      return item;
    });
    updateData({ teammates: updated });
  };

  const handleSkip = () => {
    updateData({ teammates: [] });
    onNext();
  };

  const handleContinue = () => {
    // Basic email validation check before continuing
    const allValid = teammates.every(
      (item) => !item.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)
    );

    if (allValid) {
      // Filter out empty emails before storing
      const nonEmpties = teammates.filter((item) => item.email.trim() !== "");
      updateData({ teammates: nonEmpties });
      onNext();
    }
  };

  return (
    <div className="w-full max-w-[500px] space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 bg-[rgba(124,106,247,0.08)] dark:bg-[rgba(124,106,247,0.12)] border border-primary text-primary text-[11px] rounded px-2 py-0.5 w-fit mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Step 3 of 4</span>
        </div>
        <h2 className="text-[22px] font-semibold text-foreground leading-tight mb-1">
          Invite your team
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Add teammates now or skip and invite them later from workspace settings.
        </p>
      </div>

      {/* Team members list */}
      <div className="space-y-3">
        {/* Read-Only Lead (Current User) */}
        <div className="flex items-center gap-3 p-3 bg-secondary/40 border border-border rounded-lg">
          <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary shrink-0">
            <UserCheck className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold text-foreground truncate">
              {user?.name || "You"} (Lead)
            </span>
            <span className="block text-[11px] text-muted-foreground truncate">
              {user?.email || "owner@university.edu"}
            </span>
          </div>
          <span className="text-[11px] bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5 font-medium">
            Lead
          </span>
        </div>

        {/* Dynamic teammates list */}
        {teammates.map((teammate, index) => (
          <div key={index} className="flex gap-2 items-center">
            {/* Email input field */}
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground/60">
                <Mail className="w-4 h-4" />
              </span>
              <input
                type="email"
                placeholder="teammate@university.edu"
                value={teammate.email}
                onChange={(e) => handleFieldChange(index, "email", e.target.value)}
                className="w-full h-10 pl-10 pr-3 bg-card border border-border rounded-md text-[13px] text-foreground placeholder-muted-foreground/50 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all"
              />
            </div>

            {/* Role selection dropdown */}
            <select
              value={teammate.role}
              onChange={(e) =>
                handleFieldChange(
                  index,
                  "role",
                  e.target.value as "Member" | "Advisor" | "Viewer"
                )
              }
              className="h-10 px-3 bg-card border border-border rounded-md text-[13px] text-foreground focus:border-primary outline-none shrink-0 cursor-pointer min-w-[100px]"
            >
              <option value="Member">Member</option>
              <option value="Advisor">Advisor</option>
              <option value="Viewer">Viewer</option>
            </select>

            {/* Remove Row Button */}
            <button
              type="button"
              onClick={() => handleRemoveTeammate(index)}
              className="w-10 h-10 flex items-center justify-center border border-border hover:border-destructive text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-md transition-all shrink-0 cursor-pointer"
              title="Remove invitee"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {/* Add Teammate button */}
        <button
          type="button"
          onClick={handleAddTeammate}
          className="w-full h-10 border border-dashed border-border hover:border-primary hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all duration-150 rounded-md flex items-center justify-center gap-2 text-[13px] font-medium cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add another member</span>
        </button>
      </div>

      <span className="block text-[11px] text-muted-foreground text-center">
        Members will receive an email invitation to join.
      </span>

      {/* Stepper Footer buttons */}
      <div className="flex justify-between pt-4 border-t border-border gap-3">
        <Button
          type="button"
          onClick={onBack}
          className="h-10 px-5 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md font-medium text-[14px] transition-colors"
        >
          &larr; Back
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={handleSkip}
            className="h-10 px-5 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md font-medium text-[14px] transition-colors"
          >
            Skip for now
          </Button>
          <Button
            type="button"
            onClick={handleContinue}
            className="h-10 px-6 bg-primary text-white hover:bg-primary/90 font-medium text-[14px] rounded-md transition-colors"
          >
            Continue &arr;
          </Button>
        </div>
      </div>
    </div>
  );
};
