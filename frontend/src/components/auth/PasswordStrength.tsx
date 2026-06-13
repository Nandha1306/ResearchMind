import React from "react";
import { Check, X } from "lucide-react";

interface PasswordStrengthProps {
  password?: string;
}

export const PasswordStrength: React.FC<PasswordStrengthProps> = ({ password = "" }) => {
  // Rules check
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  let score = 0;
  if (password) {
    if (hasMinLength) score += 1;
    if (hasUppercase) score += 1;
    if (hasNumber) score += 1;
    if (hasSpecial) score += 1;
  }

  const getStrengthLabelAndColor = () => {
    if (!password) return { label: "Enter a password", color: "text-[#4A4A50]", barColor: "bg-[#2A2A2A]" };
    switch (score) {
      case 1:
        return { label: "Weak", color: "text-[#EF4444]", barColor: "bg-[#EF4444]" };
      case 2:
        return { label: "Fair", color: "text-[#F59E0B]", barColor: "bg-[#F59E0B]" };
      case 3:
        return { label: "Good", color: "text-[#3B82F6]", barColor: "bg-[#3B82F6]" };
      case 4:
        return { label: "Strong", color: "text-[#22C55E]", barColor: "bg-[#22C55E]" };
      default:
        return { label: "Weak", color: "text-[#EF4444]", barColor: "bg-[#EF4444]" };
    }
  };

  const { label, color, barColor } = getStrengthLabelAndColor();

  return (
    <div className="w-full mt-2 space-y-2">
      {/* 4 Segmented Bars */}
      <div className="grid grid-cols-4 gap-1.5 h-1">
        {[1, 2, 3, 4].map((index) => {
          const isActive = password && index <= score;
          return (
            <div
              key={index}
              className={`h-full rounded-full transition-all duration-300 ${
                isActive ? barColor : "bg-muted-foreground/20"
              }`}
            />
          );
        })}
      </div>

      {/* Label and detailed requirements checklist */}
      <div className="flex justify-between items-center text-[11px]">
        <span className="text-muted-foreground">Password strength:</span>
        <span className={`font-medium transition-colors duration-300 ${color}`}>{label}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-muted-foreground bg-card border border-border rounded p-2">
        <div className="flex items-center gap-1.5">
          {hasMinLength ? (
            <Check className="w-3 h-3 text-[#22C55E]" />
          ) : (
            <X className="w-3 h-3 text-[#EF4444]" />
          )}
          <span>At least 8 characters</span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasUppercase ? (
            <Check className="w-3 h-3 text-[#22C55E]" />
          ) : (
            <X className="w-3 h-3 text-[#EF4444]" />
          )}
          <span>One uppercase letter</span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasNumber ? (
            <Check className="w-3 h-3 text-[#22C55E]" />
          ) : (
            <X className="w-3 h-3 text-[#EF4444]" />
          )}
          <span>One number</span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasSpecial ? (
            <Check className="w-3 h-3 text-[#22C55E]" />
          ) : (
            <X className="w-3 h-3 text-[#EF4444]" />
          )}
          <span>One special character</span>
        </div>
      </div>
    </div>
  );
};
