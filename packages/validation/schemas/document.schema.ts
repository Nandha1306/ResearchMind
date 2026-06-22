import { z } from "zod";

export const createDocumentSchema = z.object({
  workspaceId: z
    .string()
    .min(1, "Workspace ID is required"),

  uploadedBy: z
    .string()
    .min(1, "Uploaded by user ID is required"),

  originalName: z
    .string()
    .min(1, "Original name is required"),

  fileType: z
    .enum(["pdf", "docx"], {
      message: "File type must be 'pdf' or 'docx'",
    }),

  fileSize: z
    .number()
    .positive("File size must be positive"),

  cloudinaryUrl: z
    .string()
    .optional()
    .nullable(),

  cloudinaryPublicId: z
    .string()
    .optional()
    .nullable(),

  extractedText: z
    .string()
    .optional(),
});
