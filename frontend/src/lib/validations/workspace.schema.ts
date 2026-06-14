import { z } from "zod";

export const workspaceDetailsSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Workspace name is required" })
    .max(100, { message: "Workspace name must be less than 100 characters" }),
  urlSlug: z
    .string()
    .min(1, { message: "URL slug is required" })
    .regex(/^[a-z0-9-_]+$/, {
      message: "Slug can only contain lowercase letters, numbers, dashes, and underscores",
    }),
  description: z
    .string()
    .max(200, { message: "Description cannot exceed 200 characters" })
    .optional()
    .or(z.literal("")),
});

export type WorkspaceDetailsInput = z.infer<typeof workspaceDetailsSchema>;
