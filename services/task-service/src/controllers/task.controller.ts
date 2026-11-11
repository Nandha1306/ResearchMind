import { Request, Response } from "express";
import {
  createTask,
  bulkCreateTasks,
  getWorkspaceTasks,
  getTaskById,
  updateTask,
  deleteTask,
} from "../services/task.service";
import { getTaskActivities } from "../services/task-activity.service";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { AuthRequest } from "../../../../packages/shared/auth/authenticate";

const getUserId = (req: Request): string => {
  const user = (req as any).user;
  const userId = user?.userId || user?.id;

  if (!userId) {
    throw new AppError("Authenticated user not found", 401);
  }

  return userId;
};

const getWorkspaceId = (req: Request): string => {
  const workspaceId = req.params.workspaceId as string;

  if (!workspaceId) {
    throw new AppError("Workspace ID is required", 400);
  }

  return workspaceId;
};

export const createTaskHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceId(req);
    const createdBy = getUserId(req);

    const {
      boardId,
      title,
      description,
      status,
      priority,
      assigneeId,
      dueDate,
      parentTaskId,
    } = req.body;

    if (!boardId) {
      throw new AppError("Board ID is required", 400);
    }

    if (!title || typeof title !== "string" || !title.trim()) {
      throw new AppError("Task title is required", 400);
    }

    const task = await createTask({
      workspaceId,
      boardId,
      title: title.trim(),
      description,
      status,
      priority,
      assigneeId,
      dueDate,
      parentTaskId,
      createdBy,
    });

    res.status(201).json({
      success: true,
      data: task,
    });
  }
);

export const bulkCreateTasksHandler = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspaceId = getWorkspaceId(req);
    const userId = getUserId(req);
    const { tasks } = req.body;

    const createdTasks = await bulkCreateTasks({
      workspaceId,
      tasks,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      data: createdTasks,
    });
  }
);

export const getWorkspaceTasksHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceId(req);

    const tasks = await getWorkspaceTasks(
      workspaceId,
      req.query.boardId as string | undefined,
      req.query.parentTaskId as string | undefined
    );

    res.status(200).json({
      success: true,
      data: tasks,
    });
  }
);

export const getTaskHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceId(req);

    const task = await getTaskById(workspaceId, req.params.id as string);

    if (!task) {
      throw new AppError("Task not found", 404);
    }

    res.status(200).json({
      success: true,
      data: task,
    });
  }
);

export const updateTaskHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceId(req);
    const userId = getUserId(req);

    const {
      title,
      description,
      status,
      priority,
      assigneeId,
      dueDate,
      parentTaskId,
      boardId,
    } = req.body;

    const task = await updateTask(
      workspaceId,
      req.params.id as string,
      userId,
      {
        title,
        description,
        status,
        priority,
        assigneeId,
        dueDate,
        parentTaskId,
        boardId,
      }
    );

    if (!task) {
      throw new AppError("Task not found", 404);
    }

    res.status(200).json({
      success: true,
      data: task,
    });
  }
);

export const deleteTaskHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceId(req);

    const result = await deleteTask(workspaceId, req.params.id as string);

    if (!result) {
      throw new AppError("Task not found", 404);
    }

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
      data: {
        deletedTaskCount: result.deletedTaskCount,
        deletedSubtaskCount: result.deletedSubtaskCount,
        deletedActivityCount: result.deletedActivityCount,
      },
    });
  }
);

export const getTaskActivitiesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceId(req);
    const taskId = (req.params.id || req.params.taskId) as string;

    const activities = await getTaskActivities(workspaceId, taskId);

    if (activities === null) {
      throw new AppError("Task not found", 404);
    }

    res.status(200).json({
      success: true,
      data: activities,
    });
  }
);