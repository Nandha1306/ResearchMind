import { Schema, model } from "mongoose";

/** Document metadata and extracted content. */
const documentSchema = new Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      index: true,
    },

    uploadedBy: {
      type: String,
      required: true,
    },

    originalName: {
      type: String,
      required: true,
    },

    fileType: {
      type: String,
      required: true,
      enum: ["pdf", "docx"],
    },

    fileSize: {
      type: Number,
      required: true,
    },

    /*
     * Storage location (server-owned; NEVER sent to clients -- see
     * utils/document-serializer.ts). Files are delivered only through
     * GET /api/documents/:id/file after a membership check (SEC-005).
     *
     * cloudinaryUrl: the public delivery URL of LEGACY assets (uploaded before
     * SEC-005 as public `upload` assets). Null for new, authenticated assets.
     */
    cloudinaryUrl: {
      type: String,
      default: null,
    },

    cloudinaryPublicId: {
      type: String,
      default: null,
    },

    /** "image" (PDF) or "raw" (DOCX). Null on legacy records: derived from fileType. */
    cloudinaryResourceType: {
      type: String,
      enum: ["image", "raw", null],
      default: null,
    },

    /**
     * Cloudinary delivery type: "authenticated" for every upload since
     * SEC-005 (signed URLs only, built server-side). Null on legacy records,
     * which are public "upload" assets until the user runs the migration
     * script (src/scripts/migrate-cloudinary-private.ts).
     */
    cloudinaryDeliveryType: {
      type: String,
      enum: ["upload", "authenticated", "private", null],
      default: null,
    },

    /** Delivery format reported by Cloudinary (e.g. "pdf" for image assets). */
    cloudinaryFormat: {
      type: String,
      default: null,
    },

    extractedText: {
      type: String,
      default: "",
    },

    embeddingStatus: {
      type: String,
      enum: [
        "pending",
        "indexing",
        "indexed",
        "failed",
      ],
      default: "pending",
    },

    /*
     * Embedding job bookkeeping (server-owned). A worker must atomically claim
     * the document (pending/failed/stale indexing -> indexing) before
     * processing, which makes duplicate deliveries and concurrent workers
     * safe and bounds retries.
     */
    embeddingAttempts: {
      type: Number,
      default: 0,
    },

    /**
     * Fencing token: incremented on every claim and never reset (unlike
     * embeddingAttempts, which a manual re-index resets). A status update
     * must present the token of the claim it belongs to, so a worker whose
     * claim was superseded -- even across a re-index -- cannot overwrite the
     * current holder's result.
     */
    claimSequence: {
      type: Number,
      default: 0,
    },

    indexingStartedAt: {
      type: Date,
      default: null,
    },

    embeddingError: {
      type: String,
      default: null,
    },

    /*
     * Set when deletion starts. A document with deletedAt is hidden from
     * every read, cannot be claimed or marked indexed by a worker, and is
     * removed once its vectors are gone. If removal is interrupted, the
     * recovery sweep finishes it.
     */
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Recovery sweep: find pending/failed/stale documents and unfinished deletions.
documentSchema.index({ embeddingStatus: 1, updatedAt: 1 });
documentSchema.index({ deletedAt: 1 });
// Paged workspace list, newest first (ISS-043).
documentSchema.index({ workspaceId: 1, deletedAt: 1, createdAt: -1, _id: -1 });

export const Document = model(
  "Document",
  documentSchema
);