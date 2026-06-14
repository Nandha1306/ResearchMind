import { z } from "zod";

export const createWorkspaceSchema =
  z.object({
    name: z
      .string()
      .min(
        3,
        "Workspace name is required"
      ),

    description: z
      .string()
      .max(500)
      .optional(),
  });

export const joinWorkspaceSchema =
  z.object({
    inviteCode: z
      .string()
      .min(
        1,
        "Invite code is required"
      ),
  });   