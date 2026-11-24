import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email({ message: "Please enter a valid email address" }),
  password: z
    .string()
    .min(1, { message: "Password is required" }),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    // ISS-039: mirrors the server's registerSchema (packages/validation), so a
    // bad value is reported here instead of by a late server 400.
    // Wave 6 (W6-SEC-04): same upper bounds as the server (name trimmed).
    name: z
      .string()
      .trim()
      .min(1, { message: "Full Name is required" })
      .min(2, { message: "Name must be at least 2 characters" })
      .max(100, { message: "Name must be at most 100 characters" }),
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .max(254, { message: "Email must be at most 254 characters" })
      .email({ message: "Please enter a valid email address" }),
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters" })
      .max(128, { message: "Password must be at most 128 characters" })
      .regex(/[A-Za-z]/, { message: "Password must contain at least one letter" })
      .regex(/[0-9]/, { message: "Password must contain at least one digit" }),
    confirmPassword: z
      .string()
      .min(1, { message: "Please confirm your password" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
