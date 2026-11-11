import { Schema, model } from "mongoose";

export interface TaskDocument {
  workspaceId: string;
  boardId: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  assigneeId: string | null;
  dueDate: Date | null;
  parentTaskId: string | null;
  createdBy: string;
  importKey?: string;
  importIndex?: number;
}

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

    /**
     * Set only on tasks created by a bulk import that carried an importKey
     * (e.g. meeting action items): the key and the item's position in it.
     * Together they make a repeated import a no-op (see the unique index).
     */
    importKey: {
      type: String,
      default: undefined,
    },

    importIndex: {
      type: Number,
      default: undefined,
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

// One task per (import, position): a duplicate or concurrent repeat of the
// same bulk import cannot create a second copy. Partial, so ordinary tasks
// (no importKey) are unaffected.
taskSchema.index(
  { workspaceId: 1, importKey: 1, importIndex: 1 },
  { unique: true, partialFilterExpression: { importKey: { $type: "string" } } }
);

export const Task = model("Task", taskSchema);