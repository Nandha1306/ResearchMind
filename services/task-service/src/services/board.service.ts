import { Board } from "../models/Board";
import { Task } from "../models/Task";
import { TaskActivity } from "../models/TaskActivity";
import { AppError } from "../../../../packages/shared/errors/AppError";
import { afterCursor, pageSort, toPage, type ListPageRequest } from "../../../../packages/shared/http/list-page";

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
/** Most boards in one list page (ISS-043); also the default page size. */
export const BOARD_LIST_MAX = 200;

export const getWorkspaceBoards = async (
  workspaceId: string,
  page: ListPageRequest = { limit: BOARD_LIST_MAX, cursor: null }
) => {
  // Oldest first (as before), cursor-paged and bounded (ISS-043).
  const rows = await Board.find({ workspaceId, ...afterCursor(page.cursor, 1) })
    .sort(pageSort(1))
    .limit(page.limit + 1)
    .lean();
  return toPage(rows as any[], page.limit);
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
      // ARC-010: replaces Mongoose's deprecated "new" option (same behaviour).
      returnDocument: "after",
      runValidators: true,
    }
  ).lean();
};

/**
 * Delete a workspace-owned board.
 */
/**
 * Delete a workspace-owned board.
 *
 * DECISION (TASK-003 step 1): deleting a board that still holds tasks is
 * REFUSED by default with a 409 and the task count, and cascades only when the
 * caller explicitly opts in with `cascade: true`.
 *
 * Rationale: a board delete previously orphaned its tasks silently -- they
 * vanished from the Kanban (which filters by the selected board) yet were still
 * returned by getWorkspaceTasks and could not be deleted. Making the
 * destructive path opt-in keeps the safe default for an autonomous Phase 5
 * agent, which must not be able to erase fifty tasks with one unqualified call,
 * while still allowing a deliberate cleanup.
 *
 * ORDERING (no transaction available -- see withOptionalTransaction): activity
 * rows, then tasks, then the board itself. A crash midway leaves the board
 * present and the call safely repeatable; it can never leave tasks pointing at
 * a board that no longer exists.
 */
export const deleteBoard = async (
  workspaceId: string,
  boardId: string,
  options: { cascade?: boolean } = {}
) => {
  const board = await Board.findOne({
    _id: boardId,
    workspaceId,
  });

  if (!board) {
    return null;
  }

  const taskIds: { _id: unknown }[] = await Task.find({
    workspaceId,
    boardId,
  })
    .select("_id")
    .lean();

  if (taskIds.length > 0 && !options.cascade) {
    throw new AppError(
      `This board still contains ${taskIds.length} task${taskIds.length === 1 ? "" : "s"}. ` +
        `Delete or move them first, or repeat the request with "cascade": true to delete them as well.`,
      409
    );
  }

  let deletedActivityCount = 0;
  let deletedTaskCount = 0;

  if (taskIds.length > 0) {
    const ids = taskIds.map((t) => String(t._id));

    const activityResult = await TaskActivity.deleteMany({
      workspaceId,
      taskId: { $in: ids },
    });
    deletedActivityCount = activityResult.deletedCount ?? 0;

    const taskResult = await Task.deleteMany({
      workspaceId,
      boardId,
    });
    deletedTaskCount = taskResult.deletedCount ?? 0;
  }

  // The board goes last so a failure above never strands its tasks.
  const deletedBoard = await Board.findOneAndDelete({
    _id: boardId,
    workspaceId,
  });

  return {
    deletedBoard,
    deletedTaskCount,
    deletedActivityCount,
  };
};