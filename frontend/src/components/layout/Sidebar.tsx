import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/auth.store";
import { useWorkspaceStore } from "../../store/workspace.store";
import {
  Brain,
  LayoutDashboard,
  CheckSquare,
  FileText,
  Database,
  BarChart3,
  Cpu,
  BookOpen,
  FileCode,
  PenTool,
  Settings,
  Plus,
  ChevronsUpDown,
} from "lucide-react";

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggleCollapse }) => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const { user } = useAuthStore();
  const { workspaces, currentWorkspace, setCurrentWorkspace } = useWorkspaceStore();
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);

  // Active workspace role lookup
  const userRole = React.useMemo(() => {
    if (!currentWorkspace || !user) return "Lead";
    const member = currentWorkspace.members?.find((m) => m.userId === user.id);
    return member?.role || "Lead";
  }, [currentWorkspace, user]);

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "RM";

  const workspaceInitials = currentWorkspace?.name
    ? currentWorkspace.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "W";

  const menuItems = {
    main: [
      { name: "Overview", icon: LayoutDashboard, path: "/dashboard" },
      { name: "Tasks", icon: CheckSquare, path: "/dashboard/tasks" },
      { name: "Documents", icon: FileText, path: "/dashboard/documents" },
      { name: "Sources", icon: Database, path: "/dashboard/sources" },
      { name: "Analytics", icon: BarChart3, path: "/dashboard/analytics" },
    ],
    aiTools: [
      { name: "AI Researcher", icon: Cpu, path: "/dashboard/ai-researcher" },
      { name: "Literature Review", icon: BookOpen, path: "/dashboard/literature-review" },
      { name: "Meeting Notes", icon: FileCode, path: "/dashboard/meeting-notes" },
      { name: "Report Drafter", icon: PenTool, path: "/dashboard/report-drafter" },
    ],
  };

  const isLinkActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 h-full bg-bg-surface border-r border-border-default flex flex-col justify-between z-30 transition-all duration-300 ${
        isCollapsed ? "w-12" : "w-60"
      }`}
    >
      {/* Top Part */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {/* ResearchMind Logo Header */}
        <div className={`h-14 flex items-center border-b border-border-subtle ${isCollapsed ? "justify-center" : "px-4 justify-between"}`}>
          <Link to="/dashboard" className="flex items-center gap-2 select-none">
            <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center text-white">
              <Brain className="w-5 h-5" />
            </div>
            {!isCollapsed && (
              <span className="font-extrabold text-[15px] tracking-wider text-text-primary uppercase">
                ResearchMind
              </span>
            )}
          </Link>
        </div>

        {/* Workspace Switcher */}
        <div className="border-b border-border-subtle p-2 relative">
          {isCollapsed ? (
            <button
              onClick={() => onToggleCollapse()}
              className="w-8 h-8 rounded-lg bg-bg-elevated hover:bg-accent-bg border border-border-default text-text-primary text-[11px] font-bold flex items-center justify-center mx-auto"
              title={currentWorkspace?.name || "Workspace"}
            >
              {workspaceInitials}
            </button>
          ) : (
            <div>
              <button
                onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}
                className="w-full flex items-center justify-between p-2 rounded-lg bg-bg-elevated hover:bg-bg-elevated/70 border border-border-default transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-md bg-accent-primary text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                    {workspaceInitials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold text-text-primary truncate">
                      {currentWorkspace?.name || "Select Workspace"}
                    </span>
                    <span className="block text-[10px] text-text-secondary truncate mt-0.5">
                      Invite Code: {currentWorkspace?.inviteCode || "None"}
                    </span>
                  </div>
                </div>
                <ChevronsUpDown className="w-3.5 h-3.5 text-text-muted shrink-0 ml-1" />
              </button>

              {/* Workspace Selection Dropdown */}
              {showWorkspaceDropdown && (
                <div className="absolute left-2 right-2 top-full mt-1.5 bg-bg-elevated border border-border-default rounded-lg shadow-xl py-1.5 z-40 max-h-60 overflow-y-auto">
                  <span className="block px-3 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                    Workspaces
                  </span>
                  {workspaces.map((ws) => (
                    <button
                      key={ws._id}
                      onClick={() => {
                        setCurrentWorkspace(ws);
                        setShowWorkspaceDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-[12px] font-medium flex items-center justify-between transition-colors ${
                        currentWorkspace?._id === ws._id
                          ? "bg-accent-bg text-accent-primary"
                          : "text-text-secondary hover:bg-bg-surface hover:text-text-primary"
                      }`}
                    >
                      <span className="truncate">{ws.name}</span>
                      {currentWorkspace?._id === ws._id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                      )}
                    </button>
                  ))}
                  
                  <div className="border-t border-border-subtle mt-1.5 pt-1.5 px-2">
                    <button
                      onClick={() => {
                        setShowWorkspaceDropdown(false);
                        navigate("/create-workspace");
                      }}
                      className="w-full h-8 flex items-center justify-center gap-1.5 rounded bg-accent-primary hover:bg-accent-hover text-white text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New Workspace</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Menu Navigation Sections */}
        <nav className="flex-1 p-2 space-y-4 mt-2">
          {/* MAIN Section */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="block px-3 text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
                Main
              </span>
            )}
            {menuItems.main.map((item) => {
              const active = isLinkActive(item.path);
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={`flex items-center rounded-lg transition-all group relative ${
                    isCollapsed ? "justify-center p-2" : "px-3 py-2 gap-3"
                  } ${
                    active
                      ? "bg-bg-elevated border-l-2 border-accent-primary text-accent-primary"
                      : "text-text-secondary hover:bg-bg-elevated/45 hover:text-text-primary"
                  }`}
                >
                  <item.icon className={`w-4 h-4 shrink-0 ${active ? "text-accent-primary" : "text-text-secondary group-hover:text-text-primary"}`} />
                  {!isCollapsed && <span className="text-[13px] font-medium">{item.name}</span>}
                  
                  {/* Tooltip for collapsed state */}
                  {isCollapsed && (
                    <div className="absolute left-full ml-2.5 px-2 py-1 bg-bg-elevated border border-border-default rounded text-[11px] text-text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-md">
                      {item.name}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {/* AI TOOLS Section */}
          <div className="space-y-1">
            {!isCollapsed && (
              <span className="block px-3 text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 mt-2">
                AI Tools
              </span>
            )}
            {menuItems.aiTools.map((item) => {
              const active = isLinkActive(item.path);
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={`flex items-center rounded-lg transition-all group relative ${
                    isCollapsed ? "justify-center p-2" : "px-3 py-2 gap-3"
                  } ${
                    active
                      ? "bg-bg-elevated border-l-2 border-accent-primary text-accent-primary"
                      : "text-text-secondary hover:bg-bg-elevated/45 hover:text-text-primary"
                  }`}
                >
                  <item.icon className={`w-4 h-4 shrink-0 ${active ? "text-accent-primary" : "text-text-secondary group-hover:text-text-primary"}`} />
                  {!isCollapsed && <span className="text-[13px] font-medium">{item.name}</span>}

                  {/* Tooltip for collapsed state */}
                  {isCollapsed && (
                    <div className="absolute left-full ml-2.5 px-2 py-1 bg-bg-elevated border border-border-default rounded text-[11px] text-text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-md">
                      {item.name}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Bottom Settings & Profile */}
      <div className="border-t border-border-subtle p-2 space-y-2 shrink-0 bg-bg-surface">
        {/* Settings link */}
        <Link
          to="/dashboard/settings"
          className={`flex items-center rounded-lg transition-all group relative ${
            isCollapsed ? "justify-center p-2" : "px-3 py-2 gap-3"
          } ${
            isLinkActive("/dashboard/settings")
              ? "bg-bg-elevated border-l-2 border-accent-primary text-accent-primary"
              : "text-text-secondary hover:bg-bg-elevated/45 hover:text-text-primary"
          }`}
        >
          <Settings className="w-4 h-4 text-text-secondary group-hover:text-text-primary shrink-0" />
          {!isCollapsed && <span className="text-[13px] font-medium">Settings</span>}

          {isCollapsed && (
            <div className="absolute left-full ml-2.5 px-2 py-1 bg-bg-elevated border border-border-default rounded text-[11px] text-text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-md">
              Settings
            </div>
          )}
        </Link>

        {/* User Profile */}
        <div className={`flex items-center ${isCollapsed ? "justify-center p-1" : "p-2 rounded-lg bg-bg-elevated border border-border-subtle gap-2.5"}`}>
          {isCollapsed ? (
            <div className="w-8 h-8 rounded-full bg-accent-bg text-accent-primary border border-accent-primary/20 text-[11px] font-bold flex items-center justify-center" title={`${user?.name || "User"} - ${userRole}`}>
              {initials}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-full bg-accent-bg text-accent-primary border border-accent-primary/20 text-[11px] font-bold flex items-center justify-center shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold text-text-primary truncate">
                  {user?.name || "Researcher Name"}
                </span>
                <span className="block text-[10px] text-text-muted truncate mt-0.5">
                  {userRole}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
