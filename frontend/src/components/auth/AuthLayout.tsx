import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Sun, Moon } from "lucide-react";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  const location = useLocation();
  const isLogin = location.pathname === "/login";

  const features = [
    "RAG-Powered Search",
    "AI Agents",
    "Literature Review",
    "Meeting AI",
  ];

  // Theme setup: Default to dark, keep synced with document element
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return "dark"; // Default design theme
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

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-background text-foreground transition-colors duration-200">
      {/* Top navigation tabs for routing swap */}
      <div className="absolute top-0 right-0 left-0 h-14 border-b border-border flex items-center px-6 bg-background z-20 justify-between">
        <div className="flex gap-6 h-full items-center">
          <Link
            to="/login"
            className={`text-[13px] font-medium h-full flex items-center border-b-2 px-1 transition-all ${
              isLogin
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className={`text-[13px] font-medium h-full flex items-center border-b-2 px-1 transition-all ${
              !isLogin
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Create account
          </Link>
        </div>

        {/* Functioning Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-all duration-150 flex items-center justify-center cursor-pointer"
          aria-label="Toggle Theme"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Left Panel: Branding Panel */}
      <div
        className="relative w-full lg:w-[45%] bg-card flex flex-col justify-between p-8 lg:p-12 pt-24 lg:pt-28 overflow-hidden shrink-0 border-b lg:border-b-0 lg:border-r border-border transition-colors duration-200"
        style={{
          backgroundImage: "radial-gradient(var(--border-default) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* Top Section: Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center font-bold text-white text-[18px]">
            R
          </div>
          <span className="text-[17px] font-semibold text-foreground">ResearchMind</span>
        </div>

        {/* Center Section: Core Value Proposition */}
        <div className="my-12 lg:my-auto max-w-[400px]">
          <h1 className="text-[26px] font-semibold text-foreground leading-[1.3] mb-4">
            Your project knowledge,<br />
            <span className="text-primary">finally understood.</span>
          </h1>
          <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[300px]">
            Upload papers, ask questions, generate reviews, automate tasks — all in one AI workspace built for student teams.
          </p>
        </div>

        {/* Bottom Section: Feature Pills */}
        <div className="flex flex-wrap gap-2 mt-4 lg:mt-0">
          {features.map((feat) => (
            <span
              key={feat}
              className="bg-[rgba(124,106,247,0.08)] dark:bg-[rgba(124,106,247,0.12)] border border-primary text-primary text-[11px] px-3 py-1 rounded-full font-medium"
            >
              {feat}
            </span>
          ))}
        </div>
      </div>

      {/* Right Panel: Active Form Section */}
      <div className="flex-1 flex items-center justify-center p-6 pt-24 lg:pt-14 bg-background transition-colors duration-200">
        <div className="w-full flex justify-center items-center py-8">
          {children}
        </div>
      </div>
    </div>
  );
};
