import axiosInstance from "./axios";
import type { Board, Task, BulkCreateTasksPayload, TaskActivity, CreateTaskPayload, BulkCreateTasksResult } from "../types/task.types";

/** Fetch all Kanban boards for the given workspace. */
export const getWorkspaceBoards = async (
  workspaceId: string
): Promise<Board[]> => {
  const response = await axiosInstance.get(`/tasks/workspaces/${workspaceId}/boards`);
  return response.data.data || [];
};

/** Create a new Kanban board in a workspace. */
export const createBoard = async (
  workspaceId: string,
  name: string
): Promise<Board> => {
  const response = await axiosInstance.post(
    `/tasks/workspaces/${workspaceId}/boards`,
    { name }
  );
  return response.data.data;
};

/** Create a single task or subtask. */
export const createTask = async (
  workspaceId: string,
  payload: CreateTaskPayload
): Promise<Task> => {
  const response = await axiosInstance.post(
    `/tasks/workspaces/${workspaceId}/tasks`,
    payload
  );
  return response.data.data;
};

/** Bulk create tasks inside workspace boards. */
export const bulkCreateTasks = async (
  workspaceId: string,
  payload: BulkCreateTasksPayload
): Promise<BulkCreateTasksResult> => {
  const response = await axiosInstance.post(
    `/tasks/workspaces/${workspaceId}/tasks/bulk`,
    payload
  );
  return {
    tasks: response.data.data || [],
    replayed: response.data.replayed === true,
  };
};

/** Fetch all tasks for a workspace (optionally filtered by boardId or parentTaskId). */
export const getWorkspaceTasks = async (
  workspaceId: string,
  boardId?: string,
  parentTaskId?: string | null
): Promise<Task[]> => {
  const params: Record<string, string> = {};
  if (boardId) params.boardId = boardId;
  if (parentTaskId !== undefined) params.parentTaskId = String(parentTaskId);

  const response = await axiosInstance.get(
    `/tasks/workspaces/${workspaceId}/tasks`,
    { params: Object.keys(params).length ? params : undefined }
  );
  return response.data.data || [];
};

/** Fetch single task details by ID. */
export const getTaskById = async (
  workspaceId: string,
  taskId: string
): Promise<Task> => {
  const response = await axiosInstance.get(
    `/tasks/workspaces/${workspaceId}/tasks/${taskId}`
  );
  return response.data.data;
};

/** Fetch task activities history timeline. */
export const getTaskActivities = async (
  workspaceId: string,
  taskId: string
): Promise<TaskActivity[]> => {
  const response = await axiosInstance.get(
    `/tasks/workspaces/${workspaceId}/tasks/${taskId}/activities`
  );
  return response.data.data || [];
};

/** Update task details or status. */
export const updateTask = async (
  workspaceId: string,
  taskId: string,
  data: Partial<Task>
): Promise<Task> => {
  const response = await axiosInstance.patch(
    `/tasks/workspaces/${workspaceId}/tasks/${taskId}`,
    data
  );
  return response.data.data;
};

/** Delete a task by ID. */
export const deleteTask = async (
  workspaceId: string,
  taskId: string
): Promise<void> => {
  await axiosInstance.delete(
    `/tasks/workspaces/${workspaceId}/tasks/${taskId}`
  );
};

