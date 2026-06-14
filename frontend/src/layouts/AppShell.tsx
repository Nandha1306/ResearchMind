import React, { useState, useEffect } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { TopBar } from "../components/layout/TopBar";
import { RightContextPanel } from "../components/layout/RightContextPanel";
import { useAuthStore } from "../store/auth.store";
import { X } from "lucide-react";

export const AppShell: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  
  // Layout state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // Automatically adjust layouts based on window size
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setIsSidebarCollapsed(true);
        setIsRightPanelOpen(false);
      } else if (width < 1280) {
        setIsSidebarCollapsed(true);
        setIsRightPanelOpen(false);
      } else {
        setIsSidebarCollapsed(false);
        setIsRightPanelOpen(true);
      }
    };

    handleResize(); // run initial resize on mount
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Calculate spacer padding on desktop
  const leftSidebarPadding = isSidebarCollapsed ? "md:pl-12" : "md:pl-60";

  return (
    <div className="min-h-screen bg-bg-base text-text-primary transition-colors flex flex-col font-sans">
      {/* 1. Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />
      </div>

      {/* 2. Mobile Sidebar Drawer Overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-50 md:hidden transition-opacity duration-200"
          onClick={() => setIsMobileSidebarOpen(false)}
        >
          <div 
            className="w-60 h-full bg-bg-surface border-r border-border-default flex flex-col relative animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button inside mobile drawer header */}
            <div className="absolute top-3 right-3 z-50">
              <button 
                onClick={() => setIsMobileSidebarOpen(false)}
                className="p-1.5 rounded-lg hover:bg-bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <Sidebar
              isCollapsed={false}
              onToggleCollapse={() => {}}
            />
          </div>
        </div>
      )}

      {/* 3. Main App Container */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${leftSidebarPadding}`}>
        {/* Topbar */}
        <TopBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
          isRightPanelVisible={isRightPanelOpen}
        />

        {/* Outer body: Main page content + Right Panel */}
        <div className="flex-1 flex flex-row min-h-[calc(100vh-3.5rem)] overflow-hidden relative">
          
          {/* Main Outlet Container */}
          <main className="flex-1 overflow-y-auto no-scrollbar flex flex-col min-w-0">
            <Outlet />
          </main>

          {/* Desktop Right Context Panel (Inline side-by-side) */}
          <div className="hidden xl:block border-l border-border-default select-none">
            <RightContextPanel
              isVisible={isRightPanelOpen}
              onClose={() => setIsRightPanelOpen(false)}
            />
          </div>

          {/* Tablet & Mobile Right Panel Drawer Overlay */}
          {isRightPanelOpen && (
            <div 
              className="fixed inset-0 bg-black/60 z-40 xl:hidden transition-opacity duration-200"
              onClick={() => setIsRightPanelOpen(false)}
            >
              <div 
                className="absolute right-0 top-0 bottom-0 w-80 bg-bg-surface border-l border-border-default h-full shadow-2xl animate-in slide-in-from-right duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header within overlay to allow closing */}
                <div className="h-14 flex items-center justify-between px-4 border-b border-border-default bg-bg-surface">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                    Workspace Insight Context
                  </span>
                  <button 
                    onClick={() => setIsRightPanelOpen(false)}
                    className="p-1 rounded bg-bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="h-[calc(100vh-3.5rem)]">
                  <RightContextPanel
                    isVisible={true}
                    onClose={() => setIsRightPanelOpen(false)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
