import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sun, Moon, LogOut } from "lucide-react";
import { useWorkspaceStore } from "../store/workspace.store";
import { useAuthStore } from "../store/auth.store";
import { WorkspaceStepper } from "../components/workspace/WorkspaceStepper";
import { WorkspaceDetailsStep } from "../components/workspace/WorkspaceDetailsStep";
import { ProjectDomainStep } from "../components/workspace/ProjectDomainStep";
import { InviteTeamStep } from "../components/workspace/InviteTeamStep";
import { ReviewWorkspaceStep } from "../components/workspace/ReviewWorkspaceStep";
import type { LocalOnboardingData } from "../types/workspace.types";

export const CreateWorkspacePage: React.FC = () => {
  const navigate = useNavigate();
  const { createWorkspace, fetchWorkspaces } = useWorkspaceStore();
  const { logout } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(0);

  // Theme support
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const [onboardingData, setOnboardingData] = useState<LocalOnboardingData>({
    name: "",
    description: "",
    urlSlug: "",
    selectedDomain: "",
    teammates: [],
  });

  const updateOnboardingData = (updates: Partial<LocalOnboardingData>) => {
    setOnboardingData((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    setCurrentStep((prev) => Math.min(prev + 1, 3));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleGoToStep = (stepIndex: number) => {
    setCurrentStep(stepIndex);
  };

  const handleSubmit = async () => {
    try {
      // Create actual workspace calling backend POST /workspaces
      const workspace = await createWorkspace({
        name: onboardingData.name,
        description: onboardingData.description || "Project Workspace",
      });

      if (workspace) {
        // Fetch fresh workspaces list and redirect
        await fetchWorkspaces();
        navigate("/dashboard");
      }
    } catch (err) {
      console.error("Failed to create workspace during onboarding:", err);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-background text-foreground transition-colors duration-200">
      {/* Left Stepper Sidebar panel */}
      <WorkspaceStepper currentStep={currentStep} />

      {/* Main Content Workspace Step */}
      <div className="flex-1 flex flex-col relative">
        {/* Top Control Bar containing LogOut & Light/Dark toggler */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-background shrink-0">
          <span className="text-[12px] text-muted-foreground font-medium hidden sm:inline">
            Research Workspace Onboarding
          </span>
          <div className="flex items-center gap-3 ml-auto">
            {/* Theme switcher */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-all duration-150 flex items-center justify-center cursor-pointer"
              aria-label="Toggle Theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Logout button */}
            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="px-3 h-8 rounded border border-border hover:border-destructive hover:bg-destructive/5 text-muted-foreground hover:text-destructive text-[12px] font-medium transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Step container content render view */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
          <div className="w-full flex justify-center py-6">
            {currentStep === 0 && (
              <WorkspaceDetailsStep
                data={onboardingData}
                updateData={updateOnboardingData}
                onNext={handleNext}
              />
            )}
            {currentStep === 1 && (
              <ProjectDomainStep
                data={onboardingData}
                updateData={updateOnboardingData}
                onNext={handleNext}
                onBack={handleBack}
              />
            )}
            {currentStep === 2 && (
              <InviteTeamStep
                data={onboardingData}
                updateData={updateOnboardingData}
                onNext={handleNext}
                onBack={handleBack}
              />
            )}
            {currentStep === 3 && (
              <ReviewWorkspaceStep
                data={onboardingData}
                onBack={handleBack}
                onGoToStep={handleGoToStep}
                onSubmit={handleSubmit}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
