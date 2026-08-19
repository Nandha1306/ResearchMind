import { Board } from "../models/Board";
import { Task, TaskDocument } from "../models/Task";

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

  return Task.create({
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

  return Task.findOneAndUpdate(
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
  ).lean();
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