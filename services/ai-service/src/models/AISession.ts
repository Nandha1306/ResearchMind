import { Schema, model, Document } from "mongoose";

export interface IAISessionSource {
  documentId: string;
  chunkIndex: number;
  score: number;
}

export interface IAISession extends Document {
  workspaceId: string;
  userId: string;
  query: string;
  answer: string;
  sources: IAISessionSource[];
  aiModel: string;
  createdAt: Date;
  updatedAt: Date;
}

const aiSessionSchema = new Schema<IAISession>(
  {
    workspaceId: {
      type: String,
      required: true,
      index: true,
    },

    userId: {
      type: String,
      required: true,
      index: true,
    },

    query: {
      type: String,
      required: true,
    },

    answer: {
      type: String,
      required: true,
    },

    sources: [
      {
        documentId: {
          type: String,
          required: true,
        },
        chunkIndex: {
          type: Number,
          required: true,
        },
        score: {
          type: Number,
          required: true,
        },
      },
    ],

    aiModel: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const AISession = model<IAISession>("AISession", aiSessionSchema);
