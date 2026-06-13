import mongoose, { Document, Schema } from "mongoose";

export interface IWorkspace extends Document {
  name: string;
  description?: string;
  ownerId: string;
  members: string[];
  inviteCode: string;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    ownerId: {
      type: String,
      required: true,
    },

    inviteCode: {
      type: String,
      unique: true,
      required: true,
    },

    members: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export const Workspace = mongoose.model<IWorkspace>(
  "Workspace",
  workspaceSchema
);