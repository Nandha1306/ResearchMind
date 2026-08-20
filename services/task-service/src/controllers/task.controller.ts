import { Request, Response } from "express";

import {
  createTask,
  getWorkspaceTasks,
  getTaskById,
  updateTask,
  deleteTask,
} from "../services/task.service";

import { AppError } from "../../../../packages/shared/errors/AppError";

const getUserId = (req: Request): string => {
  const user = (req as any).user;

  const userId = user?.userId || user?.id;

  if (!userId) {
    throw new AppError(
      "Authenticated user not found",
      401
    );
  }

  return userId;
};

const getWorkspaceId = (req: Request): string => {
  const workspaceId = req.params.workspaceId as string;

  if (!workspaceId) {
    throw new AppError(
      "Workspace ID is required",
      400
    );
  }

  return workspaceId;
};

export const createTaskHandler = async (
  req: Request,
  res: Response
) => {
  const workspaceId =
    getWorkspaceId(req);

  const createdBy =
    getUserId(req);

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
    throw new AppError(
      "Board ID is required",
      400
    );
  }

  if (
    !title ||
    typeof title !== "string" ||
    !title.trim()
  ) {
    throw new AppError(
      "Task title is required",
      400
    );
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

  if (!task) {
    throw new AppError(
      "Board or parent task does not belong to this workspace",
      400
    );
  }

  res.status(201).json({
    success: true,
    data: task,
  });
};

export const getWorkspaceTasksHandler =
  async (
    req: Request,
    res: Response
  ) => {
    const workspaceId =
      getWorkspaceId(req);

    const tasks =
      await getWorkspaceTasks(
        workspaceId,
        req.query.boardId as string | undefined
      );

    res.status(200).json({
      success: true,
      data: tasks,
    });
  };

export const getTaskHandler = async (
  req: Request,
  res: Response
) => {
  const workspaceId =
    getWorkspaceId(req);

  const task = await getTaskById(
    workspaceId,
    req.params.id as string
  );

  if (!task) {
    throw new AppError(
      "Task not found",
      404
    );
  }

  res.status(200).json({
    success: true,
    data: task,
  });
};

export const updateTaskHandler =
  async (
    req: Request,
    res: Response
  ) => {
    const workspaceId =
      getWorkspaceId(req);

    const userId =
      getUserId(req);

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

    const task =
      await updateTask(
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
      throw new AppError(
        "Task not found or related resource does not belong to this workspace",
        404
      );
    }

    res.status(200).json({
      success: true,
      data: task,
    });
  };

export const deleteTaskHandler =
  async (
    req: Request,
    res: Response
  ) => {
    const workspaceId =
      getWorkspaceId(req);

    const task =
      await deleteTask(
        workspaceId,
        req.params.id as string
      );

    if (!task) {
      throw new AppError(
        "Task not found",
        404
      );
    }

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
    });
  };