import { TaskActivity } from "../models/TaskActivity";

interface CreateActivityInput {
  workspaceId: string;
  taskId: string;
  userId: string;
  action: "created" | "status_changed" | "assigned" | "due_date_set" | "priority_changed" | "comment";
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

export const getTaskActivities = async (
  workspaceId: string,
  taskId: string
) => {
  return TaskActivity.find({
    workspaceId,
    taskId,
  })
    .sort({ createdAt: -1 })
    .lean();
};
