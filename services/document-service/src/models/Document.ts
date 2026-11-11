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

    cloudinaryUrl: {
      type: String,
      default: null,
    },

    cloudinaryPublicId: {
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

export const Document = model(
  "Document",
  documentSchema
);