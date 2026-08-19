import { Request, Response } from "express";

import {
  createBoard,
  getWorkspaceBoards,
  getBoardById,
  updateBoard,
  deleteBoard,
} from "../services/board.service";

import { AppError } from "../../../../packages/shared/errors/AppError";

const getAuthenticatedUserId = (req: Request) => {
  const user = (req as any).user;

  return user?.userId || user?.id;
};

const getRequiredWorkspaceId = (req: Request) => {
  const workspaceId =
    req.params.workspaceId ||
    req.body.workspaceId;

  if (!workspaceId) {
    throw new AppError(
      "Workspace ID is required",
      400
    );
  }

  return workspaceId;
};

export const createBoardHandler = async (
  req: Request,
  res: Response
) => {
  const workspaceId =
    getRequiredWorkspaceId(req);

  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    throw new AppError(
      "Authenticated user not found",
      401
    );
  }

  const { name } = req.body;

  if (!name || typeof name !== "string") {
    throw new AppError(
      "Board name is required",
      400
    );
  }

  const board = await createBoard({
    workspaceId,
    name,
  });

  res.status(201).json({
    success: true,
    data: board,
  });
};

export const getWorkspaceBoardsHandler =
  async (
    req: Request,
    res: Response
  ) => {
    const workspaceId =
      getRequiredWorkspaceId(req);

    const boards =
      await getWorkspaceBoards(
        workspaceId
      );

    res.status(200).json({
      success: true,
      data: boards,
    });
  };

export const getBoardHandler = async (
  req: Request,
  res: Response
) => {
  const workspaceId =
    getRequiredWorkspaceId(req);

  const board = await getBoardById(
    workspaceId,
    req.params.id as string
  );

  if (!board) {
    throw new AppError(
      "Board not found",
      404
    );
  }

  res.status(200).json({
    success: true,
    data: board,
  });
};

export const updateBoardHandler =
  async (
    req: Request,
    res: Response
  ) => {
    const workspaceId =
      getRequiredWorkspaceId(req);

    const { name } = req.body;

    if (
      name !== undefined &&
      typeof name !== "string"
    ) {
      throw new AppError(
        "Board name must be a string",
        400
      );
    }

    const board =
      await updateBoard(
        workspaceId,
        req.params.id as string,
        { name }
      );

    if (!board) {
      throw new AppError(
        "Board not found",
        404
      );
    }

    res.status(200).json({
      success: true,
      data: board,
    });
  };

export const deleteBoardHandler =
  async (
    req: Request,
    res: Response
  ) => {
    const workspaceId =
      getRequiredWorkspaceId(req);

    const board =
      await deleteBoard(
        workspaceId,
        req.params.id as string
      );

    if (!board) {
      throw new AppError(
        "Board not found",
        404
      );
    }

    res.status(200).json({
      success: true,
      message: "Board deleted successfully",
    });
  };