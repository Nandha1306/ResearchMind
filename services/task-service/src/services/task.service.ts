import { Board } from "../models/Board";
import { Task, TaskDocument } from "../models/Task";
import { createActivity } from "./task-activity.service";
import { detectTaskActivityChanges } from "./task-activity-diff.service";
import { AppError } from "../../../../packages/shared/errors/AppError";

interface CreateTaskInput {
  workspaceId: string;
  boardId: string;
  title: string;
  description?: string;
  status?: "todo" | "in_progress" | "done";
  priority?: "low" | "medium" | "high";
  assigneeId?: string | null;
  dueDate?: Date | null;
  parentTaskId?: string | null;
  createdBy: string;
}

/**
 * Verify that a board belongs to the requested workspace.
 */
const ensureBoardInWorkspace = async (
  workspaceId: string,
  boardId: string
) => {
  const board = await Board.findOne({
    _id: boardId,
    workspaceId,
  });

  return Boolean(board);
};

/**
 * Verify that a parent task belongs to the same workspace.
 */
const ensureParentTaskInWorkspace = async (
  workspaceId: string,
  parentTaskId: string
) => {
  const parentTask = await Task.findOne({
    _id: parentTaskId,
    workspaceId,
  });

  return Boolean(parentTask);
};

/**
 * Create a task inside a workspace-owned board.
 */
export const createTask = async ({
  workspaceId,
  boardId,
  title,
  description,
  status,
  priority,
  assigneeId,
  dueDate,
  parentTaskId,
  createdBy,
}: CreateTaskInput) => {
  const boardExists =
    await ensureBoardInWorkspace(
      workspaceId,
      boardId
    );

  if (!boardExists) {
    return null;
  }

  if (parentTaskId) {
    const parentExists =
      await ensureParentTaskInWorkspace(
        workspaceId,
        parentTaskId
      );

    if (!parentExists) {
      return null;
    }
  }

  const task = await Task.create({
    workspaceId,
    boardId,
    title,
    description,
    status,
    priority,
    assigneeId,
    dueDate,
    parentTaskId,
    createdBy,
  });

  await createActivity({
    workspaceId,
    taskId: task._id.toString(),
    userId: createdBy,
    action: "created",
    payload: {},
  });

  return task;
};

export const bulkCreateTasks = async ({
  workspaceId,
  tasks,
  createdBy,
}: {
  workspaceId: string;
  tasks: Array<{
    boardId: string;
    title: string;
    description?: string;
    status?: "todo" | "in_progress" | "done";
    priority?: "low" | "medium" | "high";
    assigneeId?: string | null;
    dueDate?: string | null;
    parentTaskId?: string | null;
  }>;
  createdBy: string;
}) => {
  /*
   * Phase 1: Pre-validate the entire batch.
   *
   * IMPORTANT:
   * No Task documents or TaskActivity documents are written
   * during this phase.
   */

  for (const task of tasks) {
    const boardExists = await ensureBoardInWorkspace(
      workspaceId,
      task.boardId
    );

    if (!boardExists) {
      throw new AppError(
        `Board "${task.boardId}" does not belong to this workspace`,
        400
      );
    }

    if (task.parentTaskId) {
      const parentExists =
        await ensureParentTaskInWorkspace(
          workspaceId,
          task.parentTaskId
        );

      if (!parentExists) {
        throw new AppError(
          `Parent task "${task.parentTaskId}" does not belong to this workspace`,
          400
        );
      }
    }
  }

  /*
   * Phase 2: All validation has passed.
   *
   * Now create the tasks using the existing createTask()
   * business logic so TaskActivity records are generated
   * exactly like normal task creation.
   */

  const createdTasks = [];

  for (const task of tasks) {
    const createdTask = await createTask({
      workspaceId,
      boardId: task.boardId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      dueDate: task.dueDate
        ? new Date(task.dueDate)
        : null,
      parentTaskId: task.parentTaskId,
      createdBy,
    });

    /*
     * This should theoretically never fail because the
     * same board/parent validation was already performed.
     *
     * Keep the guard as defense-in-depth.
     */
    if (!createdTask) {
      throw new AppError(
        `Failed to create task "${task.title}"`,
        400
      );
    }

    createdTasks.push(createdTask);
  }

  return createdTasks;
};

/**
 * Get all tasks belonging to a workspace.
 */
export const getWorkspaceTasks = async (
  workspaceId: string,
  boardId?: string
) => {
  const filter: {
    workspaceId: string;
    boardId?: string;
  } = {
    workspaceId,
  };

  if (boardId) {
    filter.boardId = boardId;
  }

  return Task.find(filter)
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get a single task scoped to a workspace.
 */
export const getTaskById = async (
  workspaceId: string,
  taskId: string
) => {
  return Task.findOne({
    _id: taskId,
    workspaceId,
  }).lean();
};

/**
 * Update a task.
 */
export const updateTask = async (
  workspaceId: string,
  taskId: string,
  userId: string,
  data: Partial<
    Pick<
      TaskDocument,
      | "title"
      | "description"
      | "status"
      | "priority"
      | "assigneeId"
      | "dueDate"
      | "parentTaskId"
      | "boardId"
    >
  >
) => {
  const existingTask = await Task.findOne({
    _id: taskId,
    workspaceId,
  });

  if (!existingTask) {
    return null;
  }

  if (data.boardId) {
    const boardExists =
      await ensureBoardInWorkspace(
        workspaceId,
        data.boardId
      );

    if (!boardExists) {
      return null;
    }
  }

  if (data.parentTaskId) {
    const parentExists =
      await ensureParentTaskInWorkspace(
        workspaceId,
        data.parentTaskId
      );

    if (!parentExists) {
      return null;
    }
  }

  const updatedTask = await Task.findOneAndUpdate(
    {
      _id: taskId,
      workspaceId,
    },
    {
      $set: data,
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedTask) {
    return null;
  }

  const changes = detectTaskActivityChanges(
    existingTask,
    updatedTask
  );

  for (const change of changes) {
    await createActivity({
      workspaceId,
      taskId,
      userId,
      action: change.action,
      payload: change.payload,
    });
  }

  return updatedTask.toObject();
};

/**
 * Delete a task scoped to a workspace.
 */
export const deleteTask = async (
  workspaceId: string,
  taskId: string
) => {
  return Task.findOneAndDelete({
    _id: taskId,
    workspaceId,
  });
};