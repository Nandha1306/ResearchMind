import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MAX_UI_QUERY_LENGTH } from "../../utils/navigation";
import { useAuthStore } from "../../store/auth.store";
import { useWorkspaceStore } from "../../store/workspace.store";
import { useSignOut } from "../../hooks/useSignOut";
import {
  Menu,
  Search,
  Bell,
  Sun,
  Moon,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Loader2,
} from "lucide-react";

interface TopBarProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileSidebar: () => void;
  onToggleRightPanel: () => void;
  isRightPanelVisible: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileSidebar,
  onToggleRightPanel,
  isRightPanelVisible,
}) => {
  const location = useLocation();
  const { user } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { signOut, isSigningOut } = useSignOut();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  /*
   * "Search or ask ResearchMind" (P1-A25): submitting asks the AI researcher,
   * the same hand-off as the right-panel ask box. Cmd/Ctrl+K focuses it, as
   * the shortcut badge promises.
   */
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchText, setSearchText] = useState("");
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const question = searchText.trim();
    if (!question) return;
    navigate("/dashboard/ai-researcher", { state: { initialQuery: question } });
    setSearchText("");
    searchInputRef.current?.blur();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" ? "light" : "dark";
  });

  // Apply theme class to <html> element
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsUserMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUserMenuOpen]);

  // Compute page label for breadcrumb
  const getPageLabel = () => {
    const path = location.pathname;
    if (path === "/dashboard") return "Overview";
    if (path.startsWith("/dashboard/tasks")) return "Tasks";
    if (path.startsWith("/dashboard/documents")) return "Documents";
    if (path.startsWith("/dashboard/sources")) return "Sources";
    if (path.startsWith("/dashboard/analytics")) return "Analytics";
    if (path.startsWith("/dashboard/ai-researcher")) return "AI Researcher";
    if (path.startsWith("/dashboard/literature-review")) return "Literature Review";
    if (path.startsWith("/dashboard/meeting-notes")) return "Meeting Notes";
    if (path.startsWith("/dashboard/report-drafter")) return "Report Drafter";
    if (path.startsWith("/dashboard/settings")) return "Settings";
    return "Overview";
  };

  const userInitials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  return (
    <header className="h-14 bg-bg-surface border-b border-border-default px-4 flex items-center justify-between sticky top-0 z-20">
      
      {/* Left side: Navigation toggles & Breadcrumbs */}
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger menu toggle */}
        <button
          onClick={onOpenMobileSidebar}
          className="p-1.5 rounded-lg hover:bg-bg-elevated border border-border-subtle md:hidden text-text-secondary hover:text-text-primary cursor-pointer shrink-0"
          title="Toggle Sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Desktop Collapse Sidebar toggle button */}
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg hover:bg-bg-elevated border border-border-subtle hidden md:block text-text-secondary hover:text-text-primary cursor-pointer shrink-0"
          title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isSidebarCollapsed ? (
            <PanelLeft className="w-4 h-4 text-accent-primary" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-[12px] font-semibold select-none overflow-hidden text-ellipsis whitespace-nowrap max-w-[150px] sm:max-w-xs md:max-w-md">
          <span className="text-text-secondary truncate">
            {currentWorkspace?.name || "Workspace"}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <span className="text-accent-primary truncate">
            {getPageLabel()}
          </span>
        </div>
      </div>

      {/* Center: Global Search Input */}
      <form
        onSubmit={submitSearch}
        role="search"
        className="hidden sm:flex items-center flex-1 max-w-md mx-6 relative"
      >
        <div className="absolute left-3 text-text-muted">
          <Search className="w-4 h-4" />
        </div>
        <input
          ref={searchInputRef}
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          maxLength={MAX_UI_QUERY_LENGTH}
          aria-label="Ask ResearchMind"
          placeholder="Search or ask ResearchMind..."
          className="w-full h-9 pl-9 pr-12 text-[12px] text-text-primary bg-bg-elevated border border-border-subtle rounded-lg focus:border-accent-primary/60 outline-none transition-all"
        />
        {/* Command shortcut badge */}
        <div className="absolute right-3 flex items-center gap-0.5 bg-bg-surface border border-border-default rounded px-1.5 py-0.5 text-[9px] font-semibold text-text-muted select-none">
          <span>⌘</span>
          <span>K</span>
        </div>
      </form>

      {/* Right side: Actions, Theme, notifications, profile */}
      <div className="flex items-center gap-2">
        {/* Toggle Right Panel Context button on tablet & mobile */}
        <button
          onClick={onToggleRightPanel}
          className={`p-1.5 rounded-lg border hover:bg-bg-elevated transition-colors cursor-pointer shrink-0 ${
            isRightPanelVisible
              ? "border-accent-primary text-accent-primary bg-accent-bg"
              : "border-border-subtle text-text-secondary hover:text-text-primary"
          }`}
          title="Toggle Right Context Panel"
        >
          <PanelLeft className="w-4 h-4 transform rotate-180" />
        </button>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg hover:bg-bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary cursor-pointer shrink-0"
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === "dark" ? (
            <Sun className="w-4 h-4 text-warning" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>

        {/* Notification Bell */}
        {/* Notifications are not built yet: shown disabled, with no fake
            unread indicator. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="p-1.5 rounded-lg border border-border-subtle text-text-secondary relative shrink-0 opacity-50 cursor-not-allowed"
          title="Notifications are not available yet"
        >
          <Bell className="w-4 h-4" />
        </button>

        {/* Account menu */}
        <div className="relative ml-1 shrink-0" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={isUserMenuOpen}
            aria-label={user?.name ? `Account menu for ${user.name}` : "Account menu"}
            className="w-8 h-8 rounded-full bg-accent-bg text-accent-primary border border-accent-primary/20 text-[11px] font-bold flex items-center justify-center select-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            {userInitials}
          </button>

          {isUserMenuOpen && (
            <div
              role="menu"
              aria-label="Account"
              className="absolute right-0 top-full mt-2 w-56 bg-bg-elevated border border-border-default rounded-xl shadow-2xl py-1.5 z-50"
            >
              <div className="px-3 py-2 border-b border-border-subtle">
                <p className="text-[12px] font-semibold text-text-primary truncate">
                  {user?.name || "Signed in"}
                </p>
                {user?.email && (
                  <p className="text-[11px] text-text-secondary truncate mt-0.5">
                    {user.email}
                  </p>
                )}
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                disabled={isSigningOut}
                className="w-full mt-1 px-3 py-2 text-left text-[12px] font-medium text-text-secondary hover:text-destructive hover:bg-destructive/10 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:bg-destructive/10 focus:text-destructive"
              >
                {isSigningOut ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LogOut className="w-3.5 h-3.5" />
                )}
                <span>{isSigningOut ? "Signing out..." : "Sign Out"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
