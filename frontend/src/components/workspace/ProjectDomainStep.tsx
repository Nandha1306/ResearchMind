import React from "react";
import { Sparkles, Cpu, Network, Code2, Binary, BarChart3, Bot, MoreHorizontal } from "lucide-react";
import type { LocalOnboardingData } from "../../types/workspace.types";
import { Button } from "../ui/button";

interface ProjectDomainStepProps {
  data: LocalOnboardingData;
  updateData: (updates: Partial<LocalOnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

interface DomainOption {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
}

export const ProjectDomainStep: React.FC<ProjectDomainStepProps> = ({
  data,
  updateData,
  onNext,
  onBack,
}) => {
  const domains: DomainOption[] = [
    {
      id: "Machine Learning / AI",
      title: "Machine Learning / AI",
      description: "Models, datasets, training",
      icon: Cpu,
    },
    {
      id: "IoT & Embedded",
      title: "IoT & Embedded",
      description: "Sensors, microcontrollers",
      icon: Network,
    },
    {
      id: "Web Development",
      title: "Web Development",
      description: "Frontend, backend, APIs",
      icon: Code2,
    },
    {
      id: "Embedded Systems",
      title: "Embedded Systems",
      description: "RTOS, firmware, hardware",
      icon: Binary,
    },
    {
      id: "Data Science",
      title: "Data Science",
      description: "Analysis, visualization",
      icon: BarChart3,
    },
    {
      id: "Robotics",
      title: "Robotics",
      description: "Control, kinematics, ROS",
      icon: Bot,
    },
    {
      id: "Other / Custom",
      title: "Other / Custom",
      description: "Specify your own domain",
      icon: MoreHorizontal,
    },
  ];

  const handleSelect = (domainId: string) => {
    updateData({ selectedDomain: domainId });
  };

  const handleContinue = () => {
    if (data.selectedDomain) {
      onNext();
    }
  };

  return (
    <div className="w-full max-w-[580px] space-y-6">
      {/* Step Badge & Header */}
      <div>
        <div className="flex items-center gap-1.5 bg-[rgba(124,106,247,0.08)] dark:bg-[rgba(124,106,247,0.12)] border border-primary text-primary text-[11px] rounded px-2 py-0.5 w-fit mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Step 2 of 4</span>
        </div>
        <h2 className="text-[22px] font-semibold text-foreground leading-tight mb-1">
          Select your domain
        </h2>
        <p className="text-[13px] text-muted-foreground">
          This helps the AI agent understand your project context and give more relevant answers.
        </p>
      </div>

      {/* Grid of Domain Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {domains.map((dom) => {
          const Icon = dom.icon;
          const isSelected = data.selectedDomain === dom.id;
          return (
            <div
              key={dom.id}
              onClick={() => handleSelect(dom.id)}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 bg-card cursor-pointer transition-all duration-200 hover:-translate-y-0.5 select-none ${
                isSelected
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div
                className={`p-2 rounded-lg transition-colors shrink-0 ${
                  isSelected
                    ? "bg-primary text-white"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="space-y-0.5 text-left">
                <span className="block text-[14px] font-semibold text-foreground">{dom.title}</span>
                <span className="block text-[11px] text-muted-foreground">{dom.description}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Domain Custom Input if "Other / Custom" Selected */}
      {data.selectedDomain === "Other / Custom" && (
        <div className="space-y-1.5 p-4 bg-secondary border border-border rounded-xl">
          <label htmlFor="custom-domain" className="block text-[12px] font-medium text-muted-foreground">
            Specify Domain Name
          </label>
          <input
            id="custom-domain"
            type="text"
            placeholder="e.g. Bio-Medical Computing"
            className="w-full h-10 px-3.5 bg-card border border-border rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all"
            onChange={(e) => updateData({ selectedDomain: e.target.value || "Other / Custom" })}
          />
        </div>
      )}

      {/* Stepper Footer buttons */}
      <div className="flex justify-between pt-4 border-t border-border">
        <Button
          type="button"
          onClick={onBack}
          className="h-10 px-5 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md font-medium text-[14px] transition-colors"
        >
          &larr; Back
        </Button>
        <Button
          type="button"
          disabled={!data.selectedDomain}
          onClick={handleContinue}
          className="h-10 px-6 bg-primary text-white hover:bg-primary/90 font-medium text-[14px] rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          Continue &arr;
        </Button>
      </div>
    </div>
  );
};
