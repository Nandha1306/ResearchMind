import { Board } from "../models/Board";

interface CreateBoardInput {
  workspaceId: string;
  name: string;
}

interface UpdateBoardInput {
  name?: string;
}

/**
 * Create a board inside a workspace.
 */
export const createBoard = async ({
  workspaceId,
  name,
}: CreateBoardInput) => {
  return Board.create({
    workspaceId,
    name,
  });
};

/**
 * Get all boards belonging to a workspace.
 */
export const getWorkspaceBoards = async (
  workspaceId: string
) => {
  return Board.find({ workspaceId })
    .sort({ createdAt: 1 })
    .lean();
};

/**
 * Get one board, restricted to the workspace.
 */
export const getBoardById = async (
  workspaceId: string,
  boardId: string
) => {
  return Board.findOne({
    _id: boardId,
    workspaceId,
  }).lean();
};

/**
 * Update a workspace-owned board.
 */
export const updateBoard = async (
  workspaceId: string,
  boardId: string,
  data: UpdateBoardInput
) => {
  return Board.findOneAndUpdate(
    {
      _id: boardId,
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
 * Delete a workspace-owned board.
 */
export const deleteBoard = async (
  workspaceId: string,
  boardId: string
) => {
  return Board.findOneAndDelete({
    _id: boardId,
    workspaceId,
  });
};