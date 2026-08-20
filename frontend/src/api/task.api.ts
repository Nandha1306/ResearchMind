import axiosInstance from "./axios";
import type { Board, Task, BulkCreateTasksPayload } from "../types/task.types";

/** Fetch all Kanban boards for the given workspace. */
export const getWorkspaceBoards = async (
  workspaceId: string
): Promise<Board[]> => {
  const response = await axiosInstance.get(`/tasks/workspaces/${workspaceId}/boards`);
  return response.data.data || [];
};

/** Bulk create tasks inside workspace boards. */
export const bulkCreateTasks = async (
  workspaceId: string,
  payload: BulkCreateTasksPayload
): Promise<Task[]> => {
  const response = await axiosInstance.post(
    `/tasks/workspaces/${workspaceId}/tasks/bulk`,
    payload
  );
  return response.data.data || [];
};
