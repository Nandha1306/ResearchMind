import { Board } from "../models/Board";
import { Task, TaskDocument } from "../models/Task";
import { TaskActivity } from "../models/TaskActivity";
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
 * Hard ceiling on how deep a subtask chain may go.
 *
 * Doubles as the loop bound for the ancestry walk: even against a database
 * that already contains a cycle, the walk cannot run forever.
 */
const MAX_ANCESTRY_DEPTH = 20;

/**
 * Reject a parent assignment that would create -- or sit inside -- a cycle.
 *
 * `createTask`/`updateTask` previously validated only that the parent existed
 * in the same workspace, so this was accepted:
 *
 *     PATCH .../tasks/A  { parentTaskId: B }
 *     PATCH .../tasks/B  { parentTaskId: A }   -> A and B point at each other
 *
 * Nothing surfaced the corruption, but any recursive traversal (a subtask
 * tree, a progress roll-up, a Phase 5 agent walking the hierarchy) would spin
 * forever on it.
 *
 * Walks upward from `proposedParentId`. `selfId` is supplied on update: if it
 * appears anywhere in the chain, the assignment closes a loop. Passing no
 * `selfId` (creation) still validates that the chain the new task is joining
 * is not already corrupt.
 *
 * Call this only AFTER the parent has been confirmed to exist in the
 * workspace, so the first hop is a known-valid ObjectId.
 */
export const assertParentChainIsSafe = async (
  workspaceId: string,
  proposedParentId: string,
  selfId?: string
) => {
  if (selfId && String(proposedParentId) === String(selfId)) {
    throw new AppError(
      "A task cannot be its own parent",
      400
    );
  }

  const visited = new Set<string>();
  let cursor: string | null = String(proposedParentId);

  for (let hop = 0; hop < MAX_ANCESTRY_DEPTH; hop++) {
    if (!cursor) {
      return;
    }

    if (selfId && cursor === String(selfId)) {
      throw new AppError(
        "That parent is a descendant of this task, so the change would create a subtask cycle",
        400
      );
    }

    if (visited.has(cursor)) {
      // Pre-existing corruption rather than something this request introduced.
      throw new AppError(
        "This task's parent chain already contains a cycle and must be repaired first",
        400
      );
    }
    visited.add(cursor);

    const ancestor: { parentTaskId?: unknown } | null = await Task.findOne({
      _id: cursor,
      workspaceId,
    })
      .select("parentTaskId")
      .lean();

    if (!ancestor) {
      // Existence in the workspace is validated by the caller; a dangling
      // ancestor simply ends the chain.
      return;
    }

    cursor = ancestor.parentTaskId
      ? String(ancestor.parentTaskId)
      : null;
  }

  throw new AppError(
    `Subtask nesting exceeds the maximum supported depth of ${MAX_ANCESTRY_DEPTH}`,
    400
  );
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
    throw new AppError("Board does not belong to this workspace", 400);
  }

  if (parentTaskId) {
    const parentExists =
      await ensureParentTaskInWorkspace(
        workspaceId,
        parentTaskId
      );

    if (!parentExists) {
      throw new AppError("Parent task does not belong to this workspace", 400);
    }

    // Defence in depth: a brand-new task has no id, so it cannot close a loop
    // itself -- but it must not be grafted onto a chain that is already
    // cyclic or already at the depth limit.
    await assertParentChainIsSafe(
      workspaceId,
      parentTaskId
    );
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

      // Validated in phase 1 so a bad parent chain aborts the whole batch
      // before any document is written.
      await assertParentChainIsSafe(
        workspaceId,
        task.parentTaskId
      );
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
  boardId?: string,
  parentTaskId?: string | null
) => {
  const filter: Record<string, any> = {
    workspaceId,
  };

  if (boardId) {
    filter.boardId = boardId;
  }

  if (parentTaskId === "null" || parentTaskId === null) {
    filter.$or = [{ parentTaskId: null }, { parentTaskId: { $exists: false } }];
  } else if (parentTaskId) {
    filter.parentTaskId = parentTaskId;
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
      throw new AppError("Board does not belong to this workspace", 400);
    }
  }

  if (data.parentTaskId) {
    // Self-parenting is checked before the lookup so `PATCH A {parentTaskId:A}`
    // reports the precise reason rather than a generic parent error.
    if (String(data.parentTaskId) === String(taskId)) {
      throw new AppError(
        "A task cannot be its own parent",
        400
      );
    }

    const parentExists =
      await ensureParentTaskInWorkspace(
        workspaceId,
        data.parentTaskId
      );

    if (!parentExists) {
      throw new AppError("Parent task does not belong to this workspace", 400);
    }

    // This is the path that could actually create a cycle: re-pointing an
    // existing task at one of its own descendants.
    await assertParentChainIsSafe(
      workspaceId,
      data.parentTaskId,
      taskId
    );
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
/**
 * Collect a task and every descendant beneath it.
 *
 * Bounded by MAX_ANCESTRY_DEPTH levels and a `seen` set so a database that
 * already contains a cycle (possible for rows written before TASK-002) cannot
 * make this loop forever.
 */
const collectSubtree = async (
  workspaceId: string,
  rootTaskId: string
): Promise<string[]> => {
  const collected: string[] = [String(rootTaskId)];
  const seen = new Set<string>(collected);
  let frontier = [String(rootTaskId)];

  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH && frontier.length > 0; depth++) {
    const children: { _id: unknown }[] = await Task.find({
      workspaceId,
      parentTaskId: { $in: frontier },
    })
      .select("_id")
      .lean();

    const next: string[] = [];
    for (const child of children) {
      const id = String(child._id);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      collected.push(id);
      next.push(id);
    }
    frontier = next;
  }

  return collected;
};

/**
 * Delete a task, everything nested beneath it, and all of their activity rows.
 *
 * DECISION (TASK-003 step 2): subtasks CASCADE rather than being promoted to
 * top-level. Promotion would surface orphaned children as loose Kanban cards --
 * exactly the defect UX-004 tracks -- and silently change their meaning.
 * Deleting a parent deletes its subtree, which is what "delete this task" reads
 * as to a user.
 *
 * ORDERING: activities first, then tasks deepest-last via `collectSubtree`
 * order reversed, then the root. A crash midway therefore leaves the parent
 * still present and the operation safely repeatable -- it can never strand a
 * child whose parent has already gone. See `withOptionalTransaction` for why
 * this ordering carries the guarantee rather than a transaction.
 */
export const deleteTask = async (
  workspaceId: string,
  taskId: string
) => {
  const existing = await Task.findOne({
    _id: taskId,
    workspaceId,
  });

  if (!existing) {
    return null;
  }

  const subtreeIds = await collectSubtree(
    workspaceId,
    taskId
  );

  const activityResult = await TaskActivity.deleteMany({
    workspaceId,
    taskId: { $in: subtreeIds },
  });

  // Deepest first: reversing the breadth-first order means no parent is ever
  // removed before its own children.
  const deletionOrder = [...subtreeIds].reverse();

  const taskResult = await Task.deleteMany({
    workspaceId,
    _id: { $in: deletionOrder },
  });

  return {
    deletedTask: existing,
    deletedTaskCount: taskResult.deletedCount ?? 0,
    deletedSubtaskCount: Math.max((taskResult.deletedCount ?? 0) - 1, 0),
    deletedActivityCount: activityResult.deletedCount ?? 0,
  };
};