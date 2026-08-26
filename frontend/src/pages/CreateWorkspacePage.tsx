import React, { useState, useEffect, useId } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Sun, Moon, LogOut, Building2, UserPlus, KeyRound, Plus, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useWorkspaceStore } from "../store/workspace.store";
import { useAuthStore } from "../store/auth.store";
import { Button } from "../components/ui/button";

export const CreateWorkspacePage: React.FC = () => {
  const navigate = useNavigate();
  const inviteCodeInputId = useId();
  const wsNameInputId = useId();
  const wsDescInputId = useId();

  const { createWorkspace, joinWorkspace, fetchWorkspaces } = useWorkspaceStore();
  const { logout, user } = useAuthStore();

  // Active Option Tab: 'join' | 'create'
  const [activeMode, setActiveMode] = useState<"join" | "create">("join");

  // Join Workspace Form State
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Create Workspace Form State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Success Notification State
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  // Handle Join Workspace Submit
  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = inviteCode.trim();
    if (!trimmedCode) {
      setJoinError("Please enter a valid workspace invite code.");
      return;
    }

    setJoining(true);
    setJoinError(null);
    setSuccessMessage(null);

    try {
      const workspace = await joinWorkspace(trimmedCode);
      if (workspace) {
        setSuccessMessage(`Joined workspace "${workspace.name}" successfully!`);
        await fetchWorkspaces();
        setTimeout(() => navigate("/dashboard"), 800);
      }
    } catch (err: any) {
      setJoinError(err.message || "Failed to join workspace. Please check the invite code.");
      setJoining(false);
    }
  };

  // Handle Create Workspace Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 3) {
      setCreateError("Workspace name must be at least 3 characters long.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    setSuccessMessage(null);

    try {
      const workspace = await createWorkspace({
        name: trimmedName,
        description: description.trim() || undefined,
      });

      if (workspace) {
        setSuccessMessage(`Workspace "${workspace.name}" created successfully!`);
        await fetchWorkspaces();
        setTimeout(() => navigate("/dashboard"), 800);
      }
    } catch (err: any) {
      setCreateError(err.message || "Failed to create workspace.");
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-bg-base text-text-primary transition-colors duration-200">
      {/* Top Header Bar */}
      <header className="h-16 border-b border-border-default flex items-center justify-between px-6 bg-bg-surface shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center text-white">
            <Brain className="w-5 h-5" />
          </div>
          <span className="font-extrabold text-[15px] tracking-wider text-text-primary uppercase">
            ResearchMind
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg border border-border-default hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Toggle Theme"
          >
            {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          </button>

          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="px-3 h-8 rounded-lg border border-border-default hover:border-destructive hover:bg-destructive/10 text-text-secondary hover:text-destructive text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-xl space-y-6">
          {/* Welcome Text Header */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-accent-bg text-accent-primary border border-accent-primary/20 flex items-center justify-center mx-auto shadow-md">
              <Building2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary">
              Welcome to ResearchMind{user?.name ? `, ${user.name}` : ""}!
            </h1>
            <p className="text-xs md:text-sm text-text-secondary max-w-md mx-auto">
              Let's set up your workspace. You can join an existing team workspace with an invite code or create a new workspace.
            </p>
          </div>

          {/* Global Success Notification */}
          {successMessage && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-center gap-2.5 font-medium animate-in fade-in">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-2 p-1.5 rounded-2xl bg-bg-surface border border-border-default gap-1.5">
            <button
              onClick={() => {
                setActiveMode("join");
                setJoinError(null);
                setCreateError(null);
              }}
              className={`py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeMode === "join"
                  ? "bg-accent-primary text-white shadow-md"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50"
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>Join a Workspace</span>
            </button>

            <button
              onClick={() => {
                setActiveMode("create");
                setJoinError(null);
                setCreateError(null);
              }}
              className={`py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeMode === "create"
                  ? "bg-accent-primary text-white shadow-md"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50"
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>Create a Workspace</span>
            </button>
          </div>

          {/* Content Card */}
          <div className="bg-bg-surface border border-border-default rounded-2xl p-6 md:p-8 shadow-xl space-y-6">
            {/* OPTION 1: Join Workspace */}
            {activeMode === "join" && (
              <form onSubmit={handleJoinSubmit} className="space-y-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-text-primary font-bold text-base">
                    <KeyRound className="w-5 h-5 text-accent-primary" />
                    <h2>Join an Existing Workspace</h2>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Enter the invite code provided by your workspace admin or owner.
                  </p>
                </div>

                {joinError && (
                  <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{joinError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor={inviteCodeInputId} className="text-xs font-semibold text-text-primary block">
                    Invite Code <span className="text-destructive">*</span>
                  </label>
                  <input
                    id={inviteCodeInputId}
                    type="text"
                    placeholder="e.g. INV_WSA_12345"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    className="w-full p-3 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-accent-primary/50 uppercase placeholder:normal-case"
                    autoFocus
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={joining || !inviteCode.trim()}
                  className="w-full bg-accent-primary hover:bg-accent-hover text-white text-xs h-10 px-5 gap-2 font-bold cursor-pointer disabled:opacity-50"
                >
                  {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  <span>Join Workspace</span>
                </Button>
              </form>
            )}

            {/* OPTION 2: Create Workspace */}
            {activeMode === "create" && (
              <form onSubmit={handleCreateSubmit} className="space-y-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-text-primary font-bold text-base">
                    <Plus className="w-5 h-5 text-accent-primary" />
                    <h2>Create a New Workspace</h2>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Build a dedicated workspace for your research team, tasks, and documents.
                  </p>
                </div>

                {createError && (
                  <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{createError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor={wsNameInputId} className="text-xs font-semibold text-text-primary block">
                    Workspace Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    id={wsNameInputId}
                    type="text"
                    placeholder="e.g. AI Oceanography Lab, Quantum Research"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-3 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                    autoFocus
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={wsDescInputId} className="text-xs font-semibold text-text-primary block">
                    Description <span className="text-text-secondary font-normal">(Optional)</span>
                  </label>
                  <textarea
                    id={wsDescInputId}
                    rows={3}
                    placeholder="Brief summary of research goals or team domain..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-3 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={creating || !name.trim()}
                  className="w-full bg-accent-primary hover:bg-accent-hover text-white text-xs h-10 px-5 gap-2 font-bold cursor-pointer disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span>Create Workspace</span>
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
