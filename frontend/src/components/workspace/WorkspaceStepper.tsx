import React from "react";
import { Check } from "lucide-react";

interface StepItem {
  number: number;
  title: string;
  description: string;
}

interface WorkspaceStepperProps {
  currentStep: number;
}

export const WorkspaceStepper: React.FC<WorkspaceStepperProps> = ({ currentStep }) => {
  const steps: StepItem[] = [
    {
      number: 1,
      title: "Workspace details",
      description: "Name, URL and description",
    },
    {
      number: 2,
      title: "Project domain",
      description: "Choose your field of study",
    },
    {
      number: 3,
      title: "Invite team",
      description: "Add teammates and roles",
    },
    {
      number: 4,
      title: "Review & create",
      description: "Confirm and launch",
    },
  ];

  return (
    <div
      className="w-full lg:w-[280px] bg-[#0F0F0F] border-b lg:border-b-0 lg:border-r border-border p-6 lg:p-8 flex flex-col justify-between shrink-0 select-none transition-colors duration-200"
      style={{
        backgroundImage: "radial-gradient(var(--border-default) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* Top Branding Section */}
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center font-bold text-white text-[18px]">
            R
          </div>
          <span className="text-[17px] font-semibold text-foreground">ResearchMind</span>
        </div>

        {/* Desktop Sidebar setup steps navigation */}
        <div className="hidden lg:block space-y-6">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Setup Steps
          </span>
          <div className="space-y-5">
            {steps.map((step, idx) => {
              const isCompleted = currentStep > idx;
              const isActive = currentStep === idx;

              return (
                <div key={step.number} className="flex gap-3">
                  {/* Step State Badge */}
                  <div className="shrink-0 pt-0.5">
                    {isCompleted ? (
                      <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center text-white">
                        <Check className="w-3.5 h-3.5 stroke-[3px]" />
                      </div>
                    ) : (
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
                          isActive
                            ? "bg-primary text-white"
                            : "bg-secondary text-muted-foreground border border-border"
                        }`}
                      >
                        {step.number}
                      </div>
                    )}
                  </div>

                  {/* Step Description */}
                  <div className="space-y-0.5 text-left">
                    <span
                      className={`block text-[13px] font-semibold transition-colors ${
                        isActive || isCompleted ? "text-foreground" : "text-muted-foreground/60"
                      }`}
                    >
                      {step.title}
                    </span>
                    <span
                      className={`block text-[11px] transition-colors ${
                        isActive || isCompleted ? "text-muted-foreground" : "text-muted-foreground/40"
                      }`}
                    >
                      {step.description}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mobile progress layout & details check */}
      <div className="block lg:hidden w-full pt-4 lg:pt-0">
        <div className="flex justify-between items-center text-[12px] mb-2 font-medium">
          <span className="text-muted-foreground">Onboarding Progress</span>
          <span className="text-primary font-semibold">Step {currentStep + 1} of 4</span>
        </div>
        <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{ width: `${((currentStep + 1) / 4) * 100}%` }}
          />
        </div>
      </div>

      {/* Footer step label details */}
      <div className="hidden lg:block pt-6 border-t border-border/80">
        <span className="text-[11px] text-muted-foreground">Step {currentStep + 1} of 4</span>
        <div className="w-full bg-secondary h-1 rounded-full overflow-hidden mt-1.5">
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{ width: `${((currentStep + 1) / 4) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
};
