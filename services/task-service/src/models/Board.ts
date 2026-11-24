import { Schema, model } from "mongoose";

/**
 * Board represents a task board belonging to a workspace.
 */
const boardSchema = new Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
  },
  {
    timestamps: true,
  }
);

// Paged board list, oldest first (ISS-043).
boardSchema.index({ workspaceId: 1, createdAt: 1, _id: 1 });

export const Board = model("Board", boardSchema);