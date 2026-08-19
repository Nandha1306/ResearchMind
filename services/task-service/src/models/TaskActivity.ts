import { Schema, model } from "mongoose";

const taskSchema = new Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      index: true,
    },

    boardId: {
      type: Schema.Types.ObjectId,
      ref: "Board",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },

    status: {
      type: String,
      enum: ["todo", "in_progress", "done"],
      default: "todo",
      index: true,
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
      index: true,
    },

    assigneeId: {
      type: String,
      default: null,
      index: true,
    },

    dueDate: {
      type: Date,
      default: null,
    },

    parentTaskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },

    createdBy: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

taskSchema.index({
  workspaceId: 1,
  boardId: 1,
});

export const Task = model("Task", taskSchema);