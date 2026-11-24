import { TaskActivity, TaskActivityDocument } from "../models/TaskActivity";
import { Task } from "../models/Task";
import { afterCursor, pageSort, toPage, type ListPageRequest } from "../../../../packages/shared/http/list-page";

interface CreateActivityInput {
  workspaceId: string;
  taskId: string;
  userId: string;
  action: TaskActivityDocument["action"];
  payload?: Record<string, any>;
}

export const createActivity = async ({
  workspaceId,
  taskId,
  userId,
  action,
  payload = {},
}: CreateActivityInput) => {
  return TaskActivity.create({
    workspaceId,
    taskId,
    userId,
    action,
    payload,
  });
};

/** Most activity entries in one list page (ISS-043); also the default page size. */
export const ACTIVITY_LIST_MAX = 200;

export const getTaskActivities = async (
  workspaceId: string,
  taskId: string,
  page: ListPageRequest = { limit: ACTIVITY_LIST_MAX, cursor: null }
) => {
  const existingTask = await Task.findOne({
    _id: taskId,
    workspaceId,
  });

  if (!existingTask) {
    return null;
  }

  // Newest first, cursor-paged and bounded (ISS-043).
  const rows = await TaskActivity.find({
    workspaceId,
    taskId,
    ...afterCursor(page.cursor, -1),
  })
    .sort(pageSort(-1))
    .limit(page.limit + 1)
    .lean();
  return toPage(rows as any[], page.limit);
};

