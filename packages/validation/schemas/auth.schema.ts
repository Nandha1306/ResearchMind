import { z } from "zod";

export const registerSchema = z.object({
  name: z
    .string()
    .min(2, "Name is required"),

  email: z
    .email("Invalid email address"),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one digit"),
});

export const loginSchema = z.object({
  email: z
    .email("Invalid email address"),

  password: z
    .string()
    .min(
      1,
      "Password is required"
    ),
});

export const logoutSchema = z.object({
  /*
   * The session being revoked must be named explicitly.
   *
   * An empty body previously reached the service as `undefined`, which matched
   * no document -- so logout answered 200 while revoking nothing. Requiring the
   * token here turns that silent no-op into a 400.
   */
  refreshToken: z
    .string({
      // Without this, a missing field falls back to Zod's generic
      // "expected string, received undefined". `.min()` alone only covers a
      // present-but-empty value.
      error: "Refresh token is required",
    })
    .min(
      1,
      "Refresh token is required"
    ),
});