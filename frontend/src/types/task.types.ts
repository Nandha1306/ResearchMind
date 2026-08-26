export interface Board {
  _id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  _id: string;
  workspaceId: string;
  boardId: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  assigneeId?: string | null;
  dueDate?: string | null;
  parentTaskId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BulkCreateTaskInput {
  boardId: string;
  title: string;
  description?: string;
  status?: "todo" | "in_progress" | "done";
  priority?: "low" | "medium" | "high";
  assigneeId?: string | null;
  dueDate?: string | null;
  parentTaskId?: string | null;
}

export interface BulkCreateTasksPayload {
  tasks: BulkCreateTaskInput[];
}

export interface MeetingActionItem {
  task: string;
  assignee: string;
  due: string;
}

export interface MeetingSummary {
  meeting_date: string;
  attendees: string[];
  summary: string;
  decisions: string[];
  action_items: MeetingActionItem[];
  open_questions: string[];
  next_meeting: string;
}

export interface TaskActivity {
  _id: string;
  workspaceId: string;
  taskId: string;
  userId: string;
  action: "created" | "status_changed" | "assigned" | "due_date_set" | "priority_changed" | "comment";
  payload?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  boardId: string;
  title: string;
  description?: string;
  status?: "todo" | "in_progress" | "done";
  priority?: "low" | "medium" | "high";
  assigneeId?: string | null;
  dueDate?: string | null;
  parentTaskId?: string | null;
}

export interface SummarizeMeetingRequest {
  workspaceId: string;
  text: string;
}
