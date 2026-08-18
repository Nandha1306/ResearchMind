import { z } from "zod";

export const semanticSearchSchema = z.object({
  workspaceId: z
    .string()
    .min(1, "Workspace ID is required"),

  query: z
    .string()
    .trim()
    .min(2, "Search query must contain at least 2 characters")
    .max(1000, "Search query cannot exceed 1000 characters"),

  topK: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional(),
});
