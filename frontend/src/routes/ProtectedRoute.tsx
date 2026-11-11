import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/auth.store";

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember the requested page so signing in returns to it (deep links).
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};
