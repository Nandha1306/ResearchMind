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
  },
  {
    timestamps: true,
  }
);

export const Document = model(
  "Document",
  documentSchema
);