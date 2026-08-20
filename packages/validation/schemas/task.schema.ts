import { z } from "zod";

export const createTaskSchema = z.object({
  boardId: z.string().min(1, "Board ID is required"),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
});

export const updateTaskSchema = z.object({
  boardId: z.string().optional(),
  title: z.string().min(1, "Task title cannot be empty").optional(),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
});

export const bulkCreateTaskItemSchema = z.object({
  boardId: z.string().min(1, "Board ID is required"),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
});

export const bulkCreateTasksSchema = z.object({
  tasks: z
    .array(bulkCreateTaskItemSchema)
    .min(1, "At least one task is required for bulk creation")
    .max(50, "Cannot bulk create more than 50 tasks in a single request"),
});
