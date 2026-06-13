import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, Mail, Lock, User, Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";
import { useAuthStore } from "../../store/auth.store";
import { authApi } from "../../api/auth.api";
import { registerSchema } from "../../lib/validations/auth.schema";
import type { RegisterInput } from "../../lib/validations/auth.schema";
import { PasswordStrength } from "./PasswordStrength";
import { Button } from "../ui/button";

export const RegisterForm: React.FC = () => {
  const navigate = useNavigate();
  const { register: storeRegister } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const passwordVal = watch("password");

  const onSubmit = async (data: RegisterInput) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const response = await authApi.register({
        name: data.name,
        email: data.email,
        password: data.password,
      });
      if (response.success && response.data) {
        const { user, accessToken, refreshToken } = response.data;
        storeRegister(user, accessToken, refreshToken);
        navigate("/dashboard");
      } else {
        setApiError("Registration failed. Invalid response structure.");
      }
    } catch (err: any) {
      console.error(err);
      setApiError(
        err.response?.data?.message || err.message || "Registration failed. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[340px] flex flex-col items-center">
      {/* Badge */}
      <div className="flex items-center gap-1.5 bg-[rgba(124,106,247,0.12)] border border-[rgba(124,106,247,0.3)] text-[#9B8DF9] text-[11px] rounded px-2 py-0.5 mb-4">
        <Sparkles className="w-3.5 h-3.5" />
        <span>Join your team's workspace</span>
      </div>

      {/* Heading */}
      <h2 className="text-[22px] font-semibold text-[#EDEDEE] leading-tight mb-1">
        Create account
      </h2>
      <p className="text-[13px] text-[#8B8B8F] mb-6">
        Start building your AI knowledge base
      </p>

      {/* General API error if exists */}
      {apiError && (
        <div className="w-full flex items-start gap-2 bg-[rgba(239,68,68,0.1)] border border-[#EF4444] rounded p-2.5 mb-4 text-[12px] text-[#EF4444]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{apiError}</span>
        </div>
      )}

      {/* Register Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="w-full space-y-4">
        {/* Name Fields: First name & Last name split */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="firstName" className="block text-[12px] font-medium text-muted-foreground">
              First name
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground/60">
                <User className="w-4 h-4" />
              </span>
              <input
                id="firstName"
                type="text"
                placeholder="Arjun"
                required
                className="w-full h-10 pl-10 pr-4 bg-card border border-border rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all"
                onChange={(e) => {
                  const currentName = watch("name") || "";
                  const lastName = currentName.split(" ").slice(1).join(" ");
                  register("name").onChange({
                    target: {
                      name: "name",
                      value: `${e.target.value} ${lastName}`.trim(),
                    },
                  });
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="lastName" className="block text-[12px] font-medium text-muted-foreground">
              Last name
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground/60">
                <User className="w-4 h-4" />
              </span>
              <input
                id="lastName"
                type="text"
                placeholder="Kumar"
                className="w-full h-10 pl-10 pr-4 bg-card border border-border rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all"
                onChange={(e) => {
                  const currentName = watch("name") || "";
                  const firstName = currentName.split(" ")[0] || "";
                  register("name").onChange({
                    target: {
                      name: "name",
                      value: `${firstName} ${e.target.value}`.trim(),
                    },
                  });
                }}
              />
            </div>
          </div>
        </div>
        {errors.name && (
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{errors.name.message}</span>
          </div>
        )}

        {/* Email */}
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-[12px] font-medium text-muted-foreground">
            Email
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground/60">
              <Mail className="w-4 h-4" />
            </span>
            <input
              id="email"
              type="email"
              placeholder="you@university.edu"
              {...register("email")}
              className={`w-full h-10 pl-10 pr-4 bg-card border ${
                errors.email ? "border-destructive" : "border-border"
              } rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all`}
            />
          </div>
          {errors.email && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.email.message}</span>
            </div>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-[12px] font-medium text-muted-foreground">
            Password
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground/60">
              <Lock className="w-4 h-4" />
            </span>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              {...register("password")}
              className={`w-full h-10 pl-10 pr-10 bg-card border ${
                errors.password ? "border-destructive" : "border-border"
              } rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-3 flex items-center text-muted-foreground/60 hover:text-foreground"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {/* Strength Meter */}
          <PasswordStrength password={passwordVal} />
          {errors.password && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.password.message}</span>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="block text-[12px] font-medium text-muted-foreground">
            Confirm password
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground/60">
              <Lock className="w-4 h-4" />
            </span>
            <input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="••••••••"
              {...register("confirmPassword")}
              className={`w-full h-10 pl-10 pr-10 bg-card border ${
                errors.confirmPassword ? "border-destructive" : "border-border"
              } rounded-md text-[14px] text-foreground placeholder-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/15 outline-none transition-all`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-3 flex items-center text-muted-foreground/60 hover:text-foreground"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.confirmPassword && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.confirmPassword.message}</span>
            </div>
          )}
        </div>

        {/* Action Button */}
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-10 bg-[#7C6AF7] text-white hover:bg-[#9B8DF9] rounded-md font-medium text-[14px] transition-colors flex items-center justify-center gap-2 mt-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Creating account...</span>
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      {/* Divider */}
      <div className="w-full flex items-center gap-3 my-5">
        <div className="h-[1px] flex-1 bg-[#2A2A2A]" />
        <span className="text-[11px] text-[#4A4A50]">or</span>
        <div className="h-[1px] flex-1 bg-[#2A2A2A]" />
      </div>

      {/* Google Button */}
      <button
        type="button"
        className="w-full h-10 border border-[#2A2A2A] rounded-md bg-transparent hover:bg-[#1A1A1A] hover:border-[#3A3A3A] transition-colors flex items-center justify-center gap-2 text-[14px] text-[#8B8B8F] hover:text-[#EDEDEE]"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.62-.63-1.07-1.37-1.39-2.09z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            fill="#EA4335"
          />
        </svg>
        <span>Continue with Google</span>
      </button>

      {/* Footer Switcher */}
      <div className="mt-6 text-[12px] text-[#8B8B8F]">
        Already have an account?{" "}
        <Link to="/login" className="text-[#7C6AF7] hover:underline font-medium ml-0.5">
          Sign in
        </Link>
      </div>
    </div>
  );
};
