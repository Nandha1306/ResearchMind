import { z } from "zod";

/** Must match the Task model's maxlength limits (services/task-service/src/models/Task.ts). */
export const MAX_TASK_TITLE_LENGTH = 200;
export const MAX_TASK_DESCRIPTION_LENGTH = 5000;
export const MAX_BULK_TASKS = 50;

const dueDateSchema = z
  .string()
  .datetime({ message: "dueDate must be a valid ISO date time string" })
  .nullable()
  .optional();

const titleSchema = (requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .max(MAX_TASK_TITLE_LENGTH, `Task title cannot exceed ${MAX_TASK_TITLE_LENGTH} characters`);

const descriptionSchema = z
  .string()
  .max(
    MAX_TASK_DESCRIPTION_LENGTH,
    `Task description cannot exceed ${MAX_TASK_DESCRIPTION_LENGTH} characters`
  )
  .optional();

/**
 * A workspace member's user id, or null for "unassigned". Membership itself is
 * verified by task-service against workspace-service; an empty string is
 * treated as unassigned.
 */
const assigneeIdSchema = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .optional()
  .transform((value) => (value === "" ? null : value));

export const createTaskSchema = z.object({
  boardId: z.string().min(1, "Board ID is required"),
  title: titleSchema("Task title is required"),
  description: descriptionSchema,
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: assigneeIdSchema,
  dueDate: dueDateSchema,
  parentTaskId: z.string().nullable().optional(),
});

export const updateTaskSchema = z.object({
  boardId: z.string().optional(),
  title: titleSchema("Task title cannot be empty").optional(),
  description: descriptionSchema,
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: assigneeIdSchema,
  dueDate: dueDateSchema,
  parentTaskId: z.string().nullable().optional(),
});

export const bulkCreateTaskItemSchema = z.object({
  boardId: z.string().min(1, "Board ID is required"),
  title: titleSchema("Task title is required"),
  description: descriptionSchema,
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: assigneeIdSchema,
  dueDate: dueDateSchema,
  parentTaskId: z.string().nullable().optional(),
});

export const bulkCreateTasksSchema = z.object({
  tasks: z
    .array(bulkCreateTaskItemSchema)
    .min(1, "At least one task is required for bulk creation")
    .max(MAX_BULK_TASKS, `Cannot bulk create more than ${MAX_BULK_TASKS} tasks in a single request`),
  /**
   * Optional client-generated key identifying one import (e.g. one set of
   * meeting action items). Repeating a request with the same key returns the
   * tasks created the first time instead of creating duplicates.
   */
  importKey: z
    .string()
    .trim()
    .min(8, "importKey must be at least 8 characters")
    .max(200, "importKey cannot exceed 200 characters")
    .regex(/^[\w:.,-]+$/, "importKey contains invalid characters")
    .optional(),
});
