import React, { useState, useEffect, useRef, useId } from "react";
import { createTask } from "../../api/task.api";
import type { Board, Task } from "../../types/task.types";
import type { WorkspaceMember } from "../../types/workspace.types";
import { Button } from "../ui/button";
import {
  X,
  Loader2,
  AlertCircle,
  Columns3,
  ListPlus,
  RefreshCw,
} from "lucide-react";

interface CreateTaskModalProps {
  onClose: () => void;
  workspaceId: string;
  boards: Board[];
  boardsLoading: boolean;
  boardsError?: string | null;
  onRetryBoards?: () => void;
  /** Board currently shown on the Kanban; preselected for convenience. */
  defaultBoardId?: string;
  /**
   * Real workspace members, the only source of assignee IDs.
   * workspace-service persists `members` as a plain string[] of user IDs while
   * the shared Workspace type declares WorkspaceMember objects, so accept both
   * rather than rendering blank options for whichever shape arrives.
   */
  members: Array<WorkspaceMember | string>;
  onTaskCreated: (task: Task) => void;
}

/** Minimal shape of the axios errors this app surfaces. */
interface ApiErrorShape {
  response?: { status?: number; data?: { message?: string } };
  message?: string;
}

const STATUS_OPTIONS: Array<{ value: Task["status"]; label: string }> = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS: Array<{ value: Task["priority"]; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  onClose,
  workspaceId,
  boards,
  boardsLoading,
  boardsError,
  onRetryBoards,
  defaultBoardId,
  members,
  onTaskCreated,
}) => {
  const titleId = useId();
  const descId = useId();
  const boardId_ = useId();
  const statusId = useId();
  const priorityId = useId();
  const assigneeId_ = useId();
  const dueDateId = useId();

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Guards against a second request while the first is still in flight.
  // A ref is used alongside the state flag because two clicks can land
  // within the same React batch, before `submitting` has re-rendered.
  const inFlightRef = useRef<boolean>(false);

  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  // The component is mounted only while the dialog is open, so opening it is a
  // fresh mount with fresh state -- no reset effect required.
  const [boardId, setBoardId] = useState<string>(() =>
    defaultBoardId && boards.some((b) => b._id === defaultBoardId)
      ? defaultBoardId
      : boards[0]?._id || ""
  );
  const [status, setStatus] = useState<Task["status"]>("todo");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  // ESC closes, matching TaskDetailModal / CreateWorkspaceModal behaviour.
  // Ignored mid-submit so an in-flight creation is never orphaned.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !inFlightRef.current) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const assignableMembers = members
    .map((member) =>
      typeof member === "string"
        ? { userId: member, label: member }
        : { userId: member.userId, label: member.email || member.userId }
    )
    .filter((member): member is { userId: string; label: string } =>
      Boolean(member.userId)
    );

  const hasBoards = boards.length > 0;
  const trimmedTitle = title.trim();
  const canSubmit = !submitting && hasBoards && Boolean(boardId) && Boolean(trimmedTitle);

  const mapError = (err: unknown): string => {
    const apiError = err as ApiErrorShape;
    const serverMessage = apiError?.response?.data?.message;

    switch (apiError?.response?.status) {
      case 400:
        return serverMessage || "That task data isn't valid. Check the title and board, then try again.";
      case 401:
        return "Your session has expired. Please sign in again.";
      case 403:
        return "You do not have access to create tasks in this workspace.";
      case 404:
        return "This workspace or board no longer exists. Refresh the board list and try again.";
      case 500:
        return "The task service failed to create this task. Please try again.";
      default:
        if (apiError?.response?.status) {
          return serverMessage || "Could not create the task. Please try again.";
        }
        return "Could not reach the task service. Check your connection and try again.";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (inFlightRef.current) return;

    if (!trimmedTitle) {
      setTitleError("Task title is required.");
      titleInputRef.current?.focus();
      return;
    }

    if (!boardId) {
      setError("Select a board for this task.");
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    setTitleError(null);

    try {
      const created = await createTask(workspaceId, {
        boardId,
        title: trimmedTitle,
        description: description.trim() || undefined,
        status,
        priority,
        assigneeId: assigneeId || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        // TOP-LEVEL GUARANTEE: this form never creates a child task. The
        // component receives no parent task id at all, so an open
        // TaskDetailModal cannot leak into this payload. Only the explicit
        // "Add Subtask" flow inside TaskDetailModal sets parentTaskId.
        parentTaskId: null,
      });

      onTaskCreated(created);
      onClose();
    } catch (err) {
      // Keep the modal open with every field intact so the user can retry.
      setError(mapError(err));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const fieldClass =
    "w-full px-3.5 py-2.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50 disabled:opacity-50";
  const labelClass = "text-xs font-medium text-text-secondary";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-task-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-bg-surface border border-border-default rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden text-text-primary">
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:px-6 border-b border-border-default">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#7C6AF7]/10 text-[#7C6AF7] border border-[#7C6AF7]/20">
              <ListPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 id="create-task-modal-title" className="text-base font-bold text-text-primary">
                Create Task
              </h2>
              <span className="text-xs text-text-secondary">
                Adds a new top-level task to this workspace board.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close create task dialog"
            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {boardsLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-text-secondary space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-[#7C6AF7]" />
              <p className="text-xs font-medium">Loading workspace boards...</p>
            </div>
          ) : boardsError ? (
            <div className="space-y-4">
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Could not load this workspace's boards, so a task cannot be created yet. {boardsError}
                </span>
              </div>
              {onRetryBoards && (
                <Button
                  type="button"
                  onClick={onRetryBoards}
                  className="bg-[#7C6AF7] hover:bg-[#6b58f5] text-white text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry loading boards</span>
                </Button>
              )}
            </div>
          ) : !hasBoards ? (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#7C6AF7]/10 text-[#7C6AF7] border border-[#7C6AF7]/20 flex items-center justify-center">
                <Columns3 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-text-primary">A board is required first</h3>
              <p className="text-xs text-text-secondary max-w-xs">
                Tasks live on a Kanban board. Create a board in this workspace, then come back to add tasks to it.
              </p>
            </div>
          ) : (
            <form id="create-task-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Title (required) */}
              <div className="space-y-1.5">
                <label htmlFor={titleId} className={labelClass}>
                  Title <span className="text-destructive">*</span>
                </label>
                <input
                  id={titleId}
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (titleError) setTitleError(null);
                  }}
                  disabled={submitting}
                  aria-required="true"
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? `${titleId}-error` : undefined}
                  placeholder="e.g. Draft the literature review section"
                  className={fieldClass}
                  autoFocus
                />
                {titleError && (
                  <p id={`${titleId}-error`} role="alert" className="text-[11px] text-destructive">
                    {titleError}
                  </p>
                )}
              </div>

              {/* Board (required) */}
              <div className="space-y-1.5">
                <label htmlFor={boardId_} className={labelClass}>
                  Board <span className="text-destructive">*</span>
                </label>
                <select
                  id={boardId_}
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  disabled={submitting}
                  aria-required="true"
                  className={fieldClass}
                >
                  {boards.map((board) => (
                    <option key={board._id} value={board._id}>
                      {board.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label htmlFor={descId} className={labelClass}>
                  Description
                </label>
                <textarea
                  id={descId}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={submitting}
                  rows={3}
                  placeholder="Optional context, acceptance criteria, or links."
                  className={`${fieldClass} resize-y leading-relaxed`}
                />
              </div>

              {/* Status + Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor={statusId} className={labelClass}>
                    Status
                  </label>
                  <select
                    id={statusId}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Task["status"])}
                    disabled={submitting}
                    className={fieldClass}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={priorityId} className={labelClass}>
                    Priority
                  </label>
                  <select
                    id={priorityId}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Task["priority"])}
                    disabled={submitting}
                    className={fieldClass}
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Assignee + Due date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor={assigneeId_} className={labelClass}>
                    Assignee
                  </label>
                  <select
                    id={assigneeId_}
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    disabled={submitting}
                    className={fieldClass}
                  >
                    <option value="">Unassigned</option>
                    {assignableMembers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={dueDateId} className={labelClass}>
                    Due date
                  </label>
                  <input
                    id={dueDateId}
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={submitting}
                    className={fieldClass}
                  />
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 md:px-6 border-t border-border-default">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="text-xs px-3.5 py-2 rounded-xl cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-task-form"
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            aria-busy={submitting}
            className="bg-[#7C6AF7] hover:bg-[#6b58f5] text-white text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <span>Create Task</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
