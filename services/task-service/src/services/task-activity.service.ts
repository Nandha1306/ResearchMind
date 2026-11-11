import { TaskActivity, TaskActivityDocument } from "../models/TaskActivity";
import { Task } from "../models/Task";

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

export const getTaskActivities = async (
  workspaceId: string,
  taskId: string
) => {
  const existingTask = await Task.findOne({
    _id: taskId,
    workspaceId,
  });

  if (!existingTask) {
    return null;
  }

  return TaskActivity.find({
    workspaceId,
    taskId,
  })
    .sort({ createdAt: -1 })
    .lean();
};

