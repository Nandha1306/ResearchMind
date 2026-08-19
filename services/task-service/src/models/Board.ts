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

export const Board = model("Board", boardSchema);