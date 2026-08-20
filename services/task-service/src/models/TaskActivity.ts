import { Schema, model } from "mongoose";

export interface TaskActivityDocument {
  workspaceId: string;
  taskId: Schema.Types.ObjectId | string;
  userId: string;
  action: "created" | "status_changed" | "assigned" | "due_date_set" | "priority_changed" | "comment";
  payload?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const taskActivitySchema = new Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      index: true,
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      enum: ["created", "status_changed", "assigned", "due_date_set", "priority_changed", "comment"],
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

taskActivitySchema.index({
  workspaceId: 1,
  taskId: 1,
});

export const TaskActivity = model("TaskActivity", taskActivitySchema);