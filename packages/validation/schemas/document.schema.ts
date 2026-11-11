import { z } from "zod";

/**
 * Body accepted by POST /api/documents (metadata-only record).
 *
 * Only client-describable metadata is accepted. Storage location
 * (cloudinaryUrl / cloudinaryPublicId), extracted text, the uploader and the
 * processing status are server-owned: they are produced by the upload
 * pipeline or derived from the authenticated user, never taken from a client.
 * Previously a client could set them, which let a workspace member point a
 * record at another tenant's Cloudinary asset (deleted on record deletion),
 * store an arbitrary/unsafe URL, or inject arbitrary text into the RAG index.
 * Unknown keys are stripped by `validate()`, so forged fields are ignored.
 */
export const createDocumentSchema = z.object({
  workspaceId: z
    .string()
    .min(1, "Workspace ID is required"),

  originalName: z
    .string()
    .trim()
    .min(1, "Original name is required")
    .max(255, "Original name must be at most 255 characters"),

  fileType: z
    .enum(["pdf", "docx"], {
      message: "File type must be 'pdf' or 'docx'",
    }),

  fileSize: z
    .number()
    .positive("File size must be positive"),
});
