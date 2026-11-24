import { z } from "zod";

export const createWorkspaceSchema =
  z.object({
    name: z
      .string()
      .min(
        3,
        "Workspace name is required"
      )
      // ISS-050 (iii): same bound as the client form.
      .max(100, "Workspace name must be at most 100 characters"),

    description: z
      .string()
      .max(500)
      .optional(),
  });

export const joinWorkspaceSchema =
  z.object({
    inviteCode: z
      .string()
      .trim()
      .min(
        1,
        "Invite code is required"
      )
      .max(64, "Invalid invite code"),
  });   