import mongoose, { Document, Schema } from "mongoose";

export interface IWorkspace extends Document {
  name: string;
  description?: string;
  ownerId: string;
  members: string[];
  inviteCode: string;
  removedMembers?: string[];
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
      index: true,
    },

    /*
     * Users the owner removed (SEC-010). They cannot rejoin with any invite
     * code until the owner re-admits them (POST /:id/members/:userId/readmit).
     * Not returned in API responses (select: false).
     */
    removedMembers: {
      type: [String],
      default: [],
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

export const Workspace =
  mongoose.models.Workspace ||
  mongoose.model<IWorkspace>("Workspace", workspaceSchema);