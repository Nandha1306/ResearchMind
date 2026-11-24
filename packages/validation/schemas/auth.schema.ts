import { z } from "zod";

/*
 * Upper bounds (Wave 6, W6-SEC-04): registration only. The name is shown to
 * every workspace member, so it is trimmed and capped; 254 is the longest
 * usable e-mail address; bcrypt reads at most 72 bytes, 128 keeps room for
 * passphrases. loginSchema deliberately has no password maximum, so no
 * existing account can be locked out.
 */
export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_LENGTH = 128;

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name is required")
    .max(MAX_NAME_LENGTH, `Name must be at most ${MAX_NAME_LENGTH} characters`),

  email: z
    .email("Invalid email address")
    .max(MAX_EMAIL_LENGTH, `Email must be at most ${MAX_EMAIL_LENGTH} characters`),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
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