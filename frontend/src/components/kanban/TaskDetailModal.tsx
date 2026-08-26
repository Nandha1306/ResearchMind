import React, { useState, useEffect, useId } from "react";
import { getTaskById, getTaskActivities, getWorkspaceTasks, updateTask, createTask, deleteTask } from "../../api/task.api";
import type { Board, Task, TaskActivity } from "../../types/task.types";
import { Button } from "../ui/button";
import {
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Clock,
  User,
  Layout,
  Plus,
  Trash2,
  Activity,
  GitCommit,
  CheckSquare,
  Square,
} from "lucide-react";

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string | null;
  workspaceId: string;
  boards: Board[];
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: string) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  isOpen,
  onClose,
  taskId,
  workspaceId,
  boards,
  onTaskUpdated,
  onTaskDeleted,
}) => {
  const titleId = useId();
  const descId = useId();
  const statusId = useId();
  const priorityId = useId();
  const boardSelectId = useId();
  const dueDateId = useId();
  const subtaskTitleId = useId();

  // Task & Subtask States
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<TaskActivity[]>([]);

  // Form Fields State
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [status, setStatus] = useState<"todo" | "in_progress" | "done">("todo");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [boardId, setBoardId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);

  // Subtask Creation State
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string>("");

  // Independent Loading States
  const [taskLoading, setTaskLoading] = useState<boolean>(false);
  const [taskSaving, setTaskSaving] = useState<boolean>(false);
  const [activitiesLoading, setActivitiesLoading] = useState<boolean>(false);
  const [subtasksLoading, setSubtasksLoading] = useState<boolean>(false);
  const [subtaskCreating, setSubtaskCreating] = useState<boolean>(false);

  // Independent Error & Notification States
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [showConfirmClose, setShowConfirmClose] = useState<boolean>(false);
  const [deletingTask, setDeletingTask] = useState<boolean>(false);

  // Fetch Task Details, Subtasks, and Activity History
  useEffect(() => {
    if (!isOpen || !taskId || !workspaceId) {
      setTask(null);
      setSubtasks([]);
      setActivities([]);
      setError(null);
      setSuccessMessage(null);
      setHasUnsavedChanges(false);
      setShowConfirmClose(false);
      return;
    }

    const loadTaskData = async () => {
      setTaskLoading(true);
      setActivitiesLoading(true);
      setSubtasksLoading(true);
      setError(null);
      setSuccessMessage(null);

      try {
        // 1. Fetch Task Details
        const fetchedTask = await getTaskById(workspaceId, taskId);
        setTask(fetchedTask);
        setTitle(fetchedTask.title);
        setDescription(fetchedTask.description || "");
        setStatus(fetchedTask.status);
        setPriority(fetchedTask.priority);
        setBoardId(fetchedTask.boardId);
        setAssigneeId(fetchedTask.assigneeId || null);

        if (fetchedTask.dueDate) {
          const d = new Date(fetchedTask.dueDate);
          setDueDate(!isNaN(d.getTime()) ? d.toISOString().split("T")[0] : "");
        } else {
          setDueDate("");
        }

        // 2. Fetch Activities History
        getTaskActivities(workspaceId, taskId)
          .then((acts) => setActivities(acts))
          .catch(() => setActivities([]))
          .finally(() => setActivitiesLoading(false));

        // 3. Fetch Subtasks
        getWorkspaceTasks(workspaceId)
          .then((allTasks) => {
            const children = allTasks.filter((t) => t.parentTaskId === taskId);
            setSubtasks(children);
          })
          .catch(() => setSubtasks([]))
          .finally(() => setSubtasksLoading(false));

      } catch (err: any) {
        if (err.response?.status === 404) {
          setError("This task no longer exists.");
          if (taskId) onTaskDeleted(taskId);
        } else if (err.response?.status === 403) {
          setError("You do not have access to this workspace.");
        } else {
          setError(err.response?.data?.message || err.message || "Failed to load task details.");
        }
      } finally {
        setTaskLoading(false);
      }
    };

    loadTaskData();
  }, [isOpen, taskId, workspaceId]);

  // ESC Key Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleModalCloseAttempt();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, hasUnsavedChanges]);

  // Track Field Changes for Unsaved Protection
  const handleTitleChange = (val: string) => {
    setTitle(val);
    setHasUnsavedChanges(true);
  };

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    setHasUnsavedChanges(true);
  };

  const handleStatusChange = (val: "todo" | "in_progress" | "done") => {
    setStatus(val);
    setHasUnsavedChanges(true);
  };

  const handlePriorityChange = (val: "low" | "medium" | "high") => {
    setPriority(val);
    setHasUnsavedChanges(true);
  };

  const handleBoardChange = (val: string) => {
    setBoardId(val);
    setHasUnsavedChanges(true);
  };

  const handleDueDateChange = (val: string) => {
    setDueDate(val);
    setHasUnsavedChanges(true);
  };

  // Close Attempt Handler with Unsaved Protection
  const handleModalCloseAttempt = () => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowConfirmClose(false);
    setHasUnsavedChanges(false);
    onClose();
  };

  // Save Task Changes
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || !workspaceId || !taskId) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Task title cannot be empty.");
      return;
    }

    setTaskSaving(true);
    setError(null);
    setSuccessMessage(null);

    // Calculate changed fields only
    const updates: Partial<Task> = {};
    if (trimmedTitle !== task.title) updates.title = trimmedTitle;
    if (description !== (task.description || "")) updates.description = description;
    if (status !== task.status) updates.status = status;
    if (priority !== task.priority) updates.priority = priority;
    if (boardId !== task.boardId) updates.boardId = boardId;
    if (assigneeId !== task.assigneeId) updates.assigneeId = assigneeId;

    const formattedDueDate = dueDate ? new Date(dueDate).toISOString() : null;
    const originalDueDateFormatted = task.dueDate ? new Date(task.dueDate).toISOString() : null;
    if (formattedDueDate !== originalDueDateFormatted) {
      updates.dueDate = formattedDueDate;
    }

    if (Object.keys(updates).length === 0) {
      setSuccessMessage("No changes to save.");
      setTaskSaving(false);
      setHasUnsavedChanges(false);
      return;
    }

    try {
      const updated = await updateTask(workspaceId, taskId, updates);
      setTask(updated);
      onTaskUpdated(updated);
      setHasUnsavedChanges(false);
      setSuccessMessage("Task updated successfully!");

      // Refresh Activities after mutation
      getTaskActivities(workspaceId, taskId)
        .then((acts) => setActivities(acts))
        .catch(() => {});

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError("This task no longer exists.");
        if (taskId) onTaskDeleted(taskId);
      } else {
        setError(err.response?.data?.message || err.message || "Failed to save task changes.");
      }
    } finally {
      setTaskSaving(false);
    }
  };

  // Create Subtask Handler
  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || !workspaceId || !taskId || !newSubtaskTitle.trim()) return;

    setSubtaskCreating(true);
    setError(null);

    try {
      const createdChild = await createTask(workspaceId, {
        boardId: task.boardId,
        title: newSubtaskTitle.trim(),
        parentTaskId: task._id,
        status: "todo",
        priority: "medium",
      });

      setSubtasks((prev) => [...prev, createdChild]);
      setNewSubtaskTitle("");

      // Refresh Activity history
      getTaskActivities(workspaceId, taskId)
        .then((acts) => setActivities(acts))
        .catch(() => {});
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to create subtask.");
    } finally {
      setSubtaskCreating(false);
    }
  };

  // Toggle Subtask Status Handler
  const handleToggleSubtaskStatus = async (subtask: Task) => {
    if (!workspaceId) return;

    const nextStatus: "todo" | "done" = subtask.status === "done" ? "todo" : "done";

    try {
      const updatedSub = await updateTask(workspaceId, subtask._id, { status: nextStatus });
      setSubtasks((prev) => prev.map((s) => (s._id === subtask._id ? updatedSub : s)));

      // Refresh parent task activities
      if (taskId) {
        getTaskActivities(workspaceId, taskId)
          .then((acts) => setActivities(acts))
          .catch(() => {});
      }
    } catch (err: any) {
      setError("Failed to update subtask status.");
    }
  };

  // Delete Task Handler
  const handleDeleteTask = async () => {
    if (!workspaceId || !taskId || !window.confirm("Are you sure you want to delete this task?")) return;

    setDeletingTask(true);
    setError(null);

    try {
      await deleteTask(workspaceId, taskId);
      onTaskDeleted(taskId);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to delete task.");
      setDeletingTask(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-bg-surface border border-border-default rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-text-primary">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 md:px-6 border-b border-border-default bg-bg-surface">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#7C6AF7]/10 text-[#7C6AF7] border border-[#7C6AF7]/20">
              <Layout className="w-5 h-5" />
            </div>
            <div>
              <h2 id="task-modal-title" className="text-base font-bold text-text-primary">
                Task Details
              </h2>
              {task && (
                <span className="text-xs text-text-secondary">
                  ID: {task._id.substring(0, 8)}...
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {task && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteTask}
                disabled={deletingTask || taskSaving}
                aria-label="Delete task"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2.5 text-xs gap-1.5 cursor-pointer"
              >
                {deletingTask ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Delete</span>
              </Button>
            )}
            <button
              onClick={handleModalCloseAttempt}
              aria-label="Close modal"
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {taskLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-text-secondary space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#7C6AF7]" />
              <p className="text-sm font-medium">Loading task details...</p>
            </div>
          ) : error && !task ? (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : task ? (
            <form onSubmit={handleSave} className="space-y-6">
              {/* Alert Notifications */}
              {error && (
                <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* Title Input */}
              <div className="space-y-1.5">
                <label htmlFor={titleId} className="text-xs font-semibold text-text-primary block">
                  Title <span className="text-destructive">*</span>
                </label>
                <input
                  id={titleId}
                  type="text"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50"
                  placeholder="Task title..."
                  required
                />
              </div>

              {/* Description Input */}
              <div className="space-y-1.5">
                <label htmlFor={descId} className="text-xs font-semibold text-text-primary block">
                  Description
                </label>
                <textarea
                  id={descId}
                  rows={4}
                  value={description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50 resize-y"
                  placeholder="Add detailed task description..."
                />
              </div>

              {/* Metadata Form Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-xl bg-bg-elevated/40 border border-border-default">
                {/* Status Selector */}
                <div className="space-y-1">
                  <label htmlFor={statusId} className="text-[11px] font-semibold text-text-secondary block">
                    Status
                  </label>
                  <select
                    id={statusId}
                    value={status}
                    onChange={(e) => handleStatusChange(e.target.value as "todo" | "in_progress" | "done")}
                    className="w-full p-2 rounded-lg bg-bg-surface border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                {/* Priority Selector */}
                <div className="space-y-1">
                  <label htmlFor={priorityId} className="text-[11px] font-semibold text-text-secondary block">
                    Priority
                  </label>
                  <select
                    id={priorityId}
                    value={priority}
                    onChange={(e) => handlePriorityChange(e.target.value as "low" | "medium" | "high")}
                    className="w-full p-2 rounded-lg bg-bg-surface border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                {/* Board Selector */}
                <div className="space-y-1">
                  <label htmlFor={boardSelectId} className="text-[11px] font-semibold text-text-secondary block">
                    Target Board
                  </label>
                  <select
                    id={boardSelectId}
                    value={boardId}
                    onChange={(e) => handleBoardChange(e.target.value)}
                    className="w-full p-2 rounded-lg bg-bg-surface border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50"
                  >
                    {boards.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Due Date Input */}
                <div className="space-y-1">
                  <label htmlFor={dueDateId} className="text-[11px] font-semibold text-text-secondary block flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-amber-400" />
                    Due Date
                  </label>
                  <input
                    id={dueDateId}
                    type="date"
                    value={dueDate}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    className="w-full p-1.5 rounded-lg bg-bg-surface border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50"
                  />
                </div>

                {/* Assignee Field Info */}
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-text-secondary block flex items-center gap-1">
                    <User className="w-3 h-3 text-[#7C6AF7]" />
                    Assignee ID
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={assigneeId || "Unassigned"}
                      className="w-full p-1.5 rounded-lg bg-bg-surface/50 border border-border-default text-text-secondary text-xs truncate"
                    />
                    {assigneeId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAssigneeId(null);
                          setHasUnsavedChanges(true);
                        }}
                        className="h-7 text-[10px] px-2 text-destructive hover:bg-destructive/10"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>

                {/* Timestamps Info */}
                <div className="space-y-1 text-[11px] text-text-secondary flex flex-col justify-center">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-text-muted" />
                    <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-text-muted">
                    <span>Updated: {new Date(task.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleModalCloseAttempt}
                  disabled={taskSaving}
                  className="text-xs h-9 px-4 border-border-default hover:bg-bg-elevated cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={taskSaving || !title.trim()}
                  className="bg-[#7C6AF7] hover:bg-[#6b58f6] text-white text-xs h-9 px-5 gap-2 font-medium cursor-pointer disabled:opacity-50"
                >
                  {taskSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Save Changes</span>
                </Button>
              </div>
            </form>
          ) : null}

          {/* Subtasks Section */}
          {task && (
            <div className="space-y-4 pt-4 border-t border-border-default">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-[#7C6AF7]" />
                  Subtasks ({subtasks.length})
                </h3>
              </div>

              {/* Subtasks List */}
              {subtasksLoading ? (
                <div className="flex items-center gap-2 text-xs text-text-secondary py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7C6AF7]" />
                  <span>Loading subtasks...</span>
                </div>
              ) : subtasks.length > 0 ? (
                <div className="space-y-2">
                  {subtasks.map((sub) => (
                    <div
                      key={sub._id}
                      className="p-3 rounded-xl bg-bg-elevated/40 border border-border-default flex items-center justify-between gap-3 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleSubtaskStatus(sub)}
                        className="flex items-center gap-2.5 text-left flex-1 min-w-0 cursor-pointer group"
                      >
                        {sub.status === "done" ? (
                          <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-text-secondary shrink-0 group-hover:text-text-primary" />
                        )}
                        <span
                          className={`font-medium truncate ${
                            sub.status === "done" ? "line-through text-text-secondary" : "text-text-primary"
                          }`}
                        >
                          {sub.title}
                        </span>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                            sub.priority === "high"
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              : sub.priority === "medium"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          }`}
                        >
                          {sub.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-secondary italic">No subtasks added yet.</p>
              )}

              {/* Add Subtask Form */}
              <form onSubmit={handleAddSubtask} className="flex items-center gap-2 pt-1">
                <label htmlFor={subtaskTitleId} className="sr-only">
                  New Subtask Title
                </label>
                <input
                  id={subtaskTitleId}
                  type="text"
                  placeholder="Add a new subtask..."
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  className="flex-1 p-2 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50"
                />
                <Button
                  type="submit"
                  disabled={subtaskCreating || !newSubtaskTitle.trim()}
                  className="bg-[#7C6AF7] hover:bg-[#6b58f6] text-white text-xs h-8 px-3 gap-1 cursor-pointer shrink-0 disabled:opacity-50"
                >
                  {subtaskCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Add Subtask</span>
                </Button>
              </form>
            </div>
          )}

          {/* Activity History Timeline Section */}
          {task && (
            <div className="space-y-4 pt-4 border-t border-border-default">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  Activity History Timeline
                </h3>
              </div>

              {activitiesLoading ? (
                <div className="flex items-center gap-2 text-xs text-text-secondary py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>Loading history timeline...</span>
                </div>
              ) : activities.length > 0 ? (
                <div className="relative pl-4 space-y-4 border-l border-border-default">
                  {activities.map((act) => (
                    <div key={act._id} className="relative space-y-1">
                      {/* Timeline Node Dot */}
                      <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-bg-surface" />

                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-text-primary capitalize flex items-center gap-1.5">
                          <GitCommit className="w-3.5 h-3.5 text-emerald-400" />
                          {act.action.replace("_", " ")}
                        </span>
                        <span className="text-[10px] text-text-secondary">
                          {new Date(act.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {act.payload && Object.keys(act.payload).length > 0 && (
                        <div className="p-2 rounded-lg bg-bg-elevated/60 border border-border-default text-[11px] text-text-secondary font-mono">
                          {JSON.stringify(act.payload)}
                        </div>
                      )}

                      <span className="text-[10px] text-text-muted block">
                        User ID: {act.userId}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-secondary italic">No recorded activity history.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Discard Unsaved Changes Confirmation Modal */}
      {showConfirmClose && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-bg-surface border border-border-default rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
            <div className="space-y-1">
              <h4 className="text-base font-bold text-text-primary">Unsaved Changes</h4>
              <p className="text-xs text-text-secondary">
                You have modified task details. Are you sure you want to discard your changes?
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowConfirmClose(false)}
                className="text-xs h-9 px-4 border-border-default hover:bg-bg-elevated"
              >
                Keep Editing
              </Button>
              <Button
                onClick={handleConfirmDiscard}
                className="bg-destructive hover:bg-destructive/90 text-white text-xs h-9 px-4"
              >
                Discard Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
