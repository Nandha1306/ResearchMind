import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuthStore } from "../store/auth.store";
import { LogOut } from "lucide-react";

// Simple Dummy Dashboard & Workspace Creation views to avoid routing to blank pages
const DashboardDummy: React.FC = () => {
  const { user, logout } = useAuthStore();
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#EDEDEE] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#111111] border border-[#2A2A2A] rounded-xl p-8 space-y-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#7C6AF7] flex items-center justify-center text-white text-[28px] font-bold mx-auto">
          R
        </div>
        <div>
          <h1 className="text-[22px] font-semibold text-[#EDEDEE]">Welcome to ResearchMind</h1>
          <p className="text-[#8B8B8F] text-[13px] mt-1">Hello, {user?.name || "Student"} ({user?.email})</p>
        </div>
        <div className="bg-[#1A1A1A] p-4 rounded-lg text-left space-y-2 text-[13px]">
          <p className="text-[#8B8B8F]"><strong className="text-[#EDEDEE]">Role:</strong> Engineering Student</p>
          <p className="text-[#8B8B8F]"><strong className="text-[#EDEDEE]">Status:</strong> Authenticated Session Active</p>
        </div>
        <div className="pt-2">
          <button
            onClick={() => logout()}
            className="w-full h-10 border border-[#EF4444] text-[#EF4444] hover:bg-[rgba(239,68,68,0.06)] rounded-md font-medium text-[14px] transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const CreateWorkspaceDummy: React.FC = () => {
  const { logout } = useAuthStore();
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#EDEDEE] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#111111] border border-[#2A2A2A] rounded-xl p-8 space-y-6 text-center">
        <h1 className="text-[22px] font-semibold text-[#EDEDEE]">Create a New Workspace</h1>
        <p className="text-[#8B8B8F] text-[13px]">Setup your AI research repository to start uploading papers.</p>
        <button
          onClick={() => logout()}
          className="w-full h-10 border border-[#EF4444] text-[#EF4444] hover:bg-[rgba(239,68,68,0.06)] rounded-md font-medium text-[14px] transition-colors flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
};

export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardDummy />} />
          <Route path="/create-workspace" element={<CreateWorkspaceDummy />} />
        </Route>

        {/* Default Redirects */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
