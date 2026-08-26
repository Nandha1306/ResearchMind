import React, { useState, useEffect, useId } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useWorkspaceStore } from "../store/workspace.store";
import {
  getWorkspaceBoards,
  getWorkspaceTasks,
  updateTask,
  createBoard,
} from "../api/task.api";
import type { Board, Task } from "../types/task.types";
import {
  Columns3,
  Loader2,
  AlertCircle,
  Building2,
  Calendar,
  User,
  Clock,
  CheckCircle2,
  CircleDot,
  GripVertical,
  Plus,
  X,
} from "lucide-react";

// Kanban Columns Definition
type TaskStatus = "todo" | "in_progress" | "done";

interface ColumnDef {
  id: TaskStatus;
  title: string;
  badgeStyle: string;
  icon: React.ReactNode;
}

const KANBAN_COLUMNS: ColumnDef[] = [
  {
    id: "todo",
    title: "TODO",
    badgeStyle: "text-[#7C6AF7] bg-[#7C6AF7]/10 border-[#7C6AF7]/30",
    icon: <CircleDot className="w-3.5 h-3.5 text-[#7C6AF7]" />,
  },
  {
    id: "in_progress",
    title: "IN PROGRESS",
    badgeStyle: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  },
  {
    id: "done",
    title: "DONE",
    badgeStyle: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  },
];

// Helper to style Priority badges
const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case "high":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "medium":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "low":
    default:
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  }
};

// 1. Draggable Task Card Item Component
interface TaskCardProps {
  task: Task;
  isUpdating: boolean;
}

const TaskCardItem: React.FC<TaskCardProps> = ({ task, isUpdating }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative p-3.5 rounded-xl bg-bg-surface border border-border-default shadow-md hover:border-border-subtle transition-all space-y-2.5 group select-none ${
        isUpdating ? "opacity-60 pointer-events-none" : ""
      }`}
    >
      {/* Updating Lock Indicator */}
      {isUpdating && (
        <div className="absolute inset-0 bg-bg-surface/80 rounded-xl flex items-center justify-center z-10">
          <Loader2 className="w-4 h-4 animate-spin text-[#7C6AF7]" />
        </div>
      )}

      {/* Top Header: Title & Drag Handle */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold text-text-primary leading-snug line-clamp-2">
          {task.title}
        </h4>

        <button
          {...attributes}
          {...listeners}
          className="p-1 text-text-secondary/40 hover:text-text-primary rounded cursor-grab active:cursor-grabbing shrink-0"
          aria-label="Drag task"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Description Snippet */}
      {task.description && (
        <p className="text-[11px] text-text-secondary line-clamp-2 leading-relaxed">
          {task.description}
        </p>
      )}

      {/* Metadata Badges Footer */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border-default/50 text-[10px]">
        {/* Priority Badge */}
        <span
          className={`px-2 py-0.5 rounded-md font-medium uppercase tracking-wider border ${getPriorityBadge(
            task.priority
          )}`}
        >
          {task.priority}
        </span>

        {/* Due Date */}
        {task.dueDate && (
          <span className="px-2 py-0.5 rounded-md bg-bg-elevated border border-border-default text-text-secondary flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5 text-amber-400" />
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}

        {/* Assignee Context */}
        {task.assigneeId && (
          <span className="px-2 py-0.5 rounded-md bg-bg-elevated border border-border-default text-text-secondary flex items-center gap-1">
            <User className="w-2.5 h-2.5 text-[#7C6AF7]" />
            {task.assigneeId}
          </span>
        )}
      </div>
    </div>
  );
};

// 2. Droppable Column Component
interface ColumnProps {
  column: ColumnDef;
  tasks: Task[];
  updatingTaskIds: string[];
}

const KanbanColumnContainer: React.FC<ColumnProps> = ({
  column,
  tasks,
  updatingTaskIds,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  const taskIds = tasks.map((t) => t._id);

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[280px] max-w-full rounded-2xl bg-bg-surface/60 border p-4 flex flex-col gap-3 transition-colors ${
        isOver ? "border-[#7C6AF7] bg-[#7C6AF7]/5" : "border-border-default"
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          {column.icon}
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
            {column.title}
          </h3>
        </div>

        <span
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${column.badgeStyle}`}
        >
          {tasks.length}
        </span>
      </div>

      {/* Task Cards Container */}
      <div className="flex-1 space-y-3 min-h-[150px]">
        <SortableContext
          items={taskIds}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskCardItem
                key={task._id}
                task={task}
                isUpdating={updatingTaskIds.includes(task._id)}
              />
            ))
          ) : (
            <div className="h-full min-h-[120px] rounded-xl border border-dashed border-border-default/60 flex items-center justify-center text-[11px] text-text-secondary/50 p-4 text-center">
              No tasks in this column
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
};

// Main Kanban Page Component
export const KanbanPage: React.FC = () => {
  const boardSelectId = useId();
  const { currentWorkspace } = useWorkspaceStore();

  // State
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<string[]>([]);

  // Board Creation State
  const [isCreateBoardOpen, setIsCreateBoardOpen] = useState<boolean>(false);
  const [newBoardName, setNewBoardName] = useState<string>("");
  const [creatingBoard, setCreatingBoard] = useState<boolean>(false);

  // Loading & Error States
  const [boardsLoading, setBoardsLoading] = useState<boolean>(false);
  const [tasksLoading, setTasksLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // DnD Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // 1. Fetch Real Boards when Workspace changes
  useEffect(() => {
    setTasks([]);
    setSelectedBoardId("");
    setError(null);

    if (!currentWorkspace?._id) {
      setBoards([]);
      return;
    }

    const fetchBoards = async () => {
      setBoardsLoading(true);
      setError(null);
      try {
        const workspaceBoards = await getWorkspaceBoards(currentWorkspace._id);
        setBoards(workspaceBoards);
        if (workspaceBoards.length > 0) {
          setSelectedBoardId(workspaceBoards[0]._id);
        }
      } catch (err: any) {
        const message =
          err.response?.data?.message || err.message || "Failed to load boards";
        setError(message);
        setBoards([]);
      } finally {
        setBoardsLoading(false);
      }
    };

    fetchBoards();
  }, [currentWorkspace?._id]);

  // 2. Fetch Tasks when Selected Board changes
  useEffect(() => {
    if (!currentWorkspace?._id || !selectedBoardId) {
      setTasks([]);
      return;
    }

    const fetchTasks = async () => {
      setTasksLoading(true);
      setError(null);
      try {
        const workspaceTasks = await getWorkspaceTasks(
          currentWorkspace._id,
          selectedBoardId
        );
        setTasks(workspaceTasks);
      } catch (err: any) {
        const message =
          err.response?.data?.message || err.message || "Failed to load tasks";
        setError(message);
        setTasks([]);
      } finally {
        setTasksLoading(false);
      }
    };

    fetchTasks();
  }, [currentWorkspace?._id, selectedBoardId]);

  // Create Board Handler
  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspace?._id || !newBoardName.trim()) return;

    setCreatingBoard(true);
    setError(null);
    try {
      const created = await createBoard(currentWorkspace._id, newBoardName.trim());
      setBoards((prev) => [...prev, created]);
      setSelectedBoardId(created._id);
      setNewBoardName("");
      setIsCreateBoardOpen(false);
    } catch (err: any) {
      const message =
        err.response?.data?.message || err.message || "Failed to create board";
      setError(message);
    } finally {
      setCreatingBoard(false);
    }
  };

  // Drag Start Handler
  const handleDragStart = (event: DragStartEvent) => {
    const taskId = event.active.id as string;
    const task = tasks.find((t) => t._id === taskId);
    if (task) {
      setActiveDragTask(task);
    }
  };

  // Drag End Handler & Backend Persistence
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragTask(null);

    if (!over || !currentWorkspace?._id) return;

    const taskId = active.id as string;
    const targetId = over.id as string;

    const draggedTask = tasks.find((t) => t._id === taskId);
    if (!draggedTask) return;

    let newStatus: TaskStatus | null = null;

    if (KANBAN_COLUMNS.some((col) => col.id === targetId)) {
      newStatus = targetId as TaskStatus;
    } else {
      const targetTask = tasks.find((t) => t._id === targetId);
      if (targetTask) {
        newStatus = targetTask.status;
      }
    }

    if (!newStatus || draggedTask.status === newStatus) return;

    if (updatingTaskIds.includes(taskId)) return;

    const previousStatus = draggedTask.status;

    setTasks((prevTasks) =>
      prevTasks.map((t) => (t._id === taskId ? { ...t, status: newStatus! } : t))
    );

    setUpdatingTaskIds((prev) => [...prev, taskId]);
    setError(null);

    try {
      const updatedTask = await updateTask(currentWorkspace._id, taskId, {
        status: newStatus,
      });

      setTasks((prevTasks) =>
        prevTasks.map((t) => (t._id === taskId ? updatedTask : t))
      );
    } catch (err: any) {
      setTasks((prevTasks) =>
        prevTasks.map((t) =>
          t._id === taskId ? { ...t, status: previousStatus } : t
        )
      );

      let errorMessage = "Unable to update task status. Reverted to previous status.";
      if (err.response?.status === 401) {
        errorMessage = "Your session has expired. Please sign in again.";
      } else if (err.response?.status === 403) {
        errorMessage = "You do not have access to update tasks in this workspace.";
      } else if (err.response?.status === 404) {
        errorMessage = "Task or board no longer exists.";
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setUpdatingTaskIds((prev) => prev.filter((id) => id !== taskId));
    }
  };

  if (!currentWorkspace) {
    return (
      <div className="p-6 md:p-8 max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-14 h-14 rounded-2xl bg-bg-surface border border-border-default flex items-center justify-center text-text-secondary mb-4 shadow-lg">
          <Building2 className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-text-primary">No Workspace Selected</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-md">
          Please select or create a workspace to view your Kanban boards and tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 bg-bg-base text-text-primary flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Header & Board Selector Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-default pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[#7C6AF7]/10 text-[#7C6AF7] border border-[#7C6AF7]/20">
              <Columns3 className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">
              Task Workflow Board
            </h1>
          </div>
          <p className="text-sm text-text-secondary">
            Manage, prioritize, and drag tasks across your workspace Kanban stages.
          </p>
        </div>

        {/* Real Board Selector & Create Board Button */}
        <div className="flex items-center gap-3">
          {boardsLoading ? (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin text-[#7C6AF7]" />
              <span>Loading boards...</span>
            </div>
          ) : boards.length > 0 ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor={boardSelectId}
                className="text-xs font-semibold text-text-secondary whitespace-nowrap"
              >
                Target Board:
              </label>
              <select
                id={boardSelectId}
                value={selectedBoardId}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="px-3.5 py-2 rounded-xl bg-bg-surface border border-border-default text-text-primary text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50 min-w-[180px]"
              >
                {boards.map((board) => (
                  <option key={board._id} value={board._id}>
                    {board.name}
                  </option>
                ))}
              </select>

              <Button
                onClick={() => setIsCreateBoardOpen(true)}
                className="bg-[#7C6AF7] hover:bg-[#6b58f5] text-white text-xs font-medium px-3.5 py-2 rounded-xl flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Board</span>
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setIsCreateBoardOpen(true)}
              className="bg-[#7C6AF7] hover:bg-[#6b58f5] text-white text-xs font-medium px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-md shadow-[#7C6AF7]/20"
            >
              <Plus className="w-4 h-4" />
              <span>Create Board</span>
            </Button>
          )}
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center gap-2.5 text-xs text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Board Content Area */}
      {boardsLoading || tasksLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[350px] gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#7C6AF7]" />
          <span className="text-xs text-text-secondary font-medium">
            Fetching Kanban tasks...
          </span>
        </div>
      ) : boards.length === 0 ? (
        <div className="flex-1 p-8 rounded-2xl bg-bg-surface border border-border-default flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#7C6AF7]/10 text-[#7C6AF7] border border-[#7C6AF7]/20 flex items-center justify-center">
            <Columns3 className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-text-primary">No Boards Found</h3>
            <p className="text-xs text-text-secondary max-w-sm">
              This workspace currently has no Kanban boards. Create a board now to manage workflows or convert meeting action items into tasks.
            </p>
          </div>
          <Button
            onClick={() => setIsCreateBoardOpen(true)}
            className="bg-[#7C6AF7] hover:bg-[#6b58f5] text-white text-xs font-medium px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-[#7C6AF7]/20"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Board</span>
          </Button>
        </div>
      ) : (
        /* DnD Context Grid */
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-5 items-start overflow-x-auto pb-4">
            {KANBAN_COLUMNS.map((column) => {
              const columnTasks = tasks.filter((t) => t.status === column.id);
              return (
                <KanbanColumnContainer
                  key={column.id}
                  column={column}
                  tasks={columnTasks}
                  updatingTaskIds={updatingTaskIds}
                />
              );
            })}
          </div>

          {/* Active Drag Overlay */}
          <DragOverlay>
            {activeDragTask ? (
              <div className="p-3.5 rounded-xl bg-bg-elevated border border-[#7C6AF7] shadow-2xl space-y-2 opacity-95 pointer-events-none scale-105 transition-transform">
                <h4 className="text-xs font-semibold text-text-primary">
                  {activeDragTask.title}
                </h4>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className={`px-2 py-0.5 rounded-md font-medium uppercase border ${getPriorityBadge(
                      activeDragTask.priority
                    )}`}
                  >
                    {activeDragTask.priority}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Create Board Modal */}
      {isCreateBoardOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bg-surface border border-border-default rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border-default pb-3">
              <div className="flex items-center gap-2">
                <Columns3 className="w-5 h-5 text-[#7C6AF7]" />
                <h3 className="text-base font-bold text-text-primary">
                  Create Kanban Board
                </h3>
              </div>
              <button
                onClick={() => setIsCreateBoardOpen(false)}
                className="p-1 text-text-secondary hover:text-text-primary rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBoard} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  Board Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sprint 1 Board, Research Tasks"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-[#7C6AF7]/50"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateBoardOpen(false)}
                  className="text-xs px-3.5 py-2 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={creatingBoard || !newBoardName.trim()}
                  className="bg-[#7C6AF7] hover:bg-[#6b58f5] text-white text-xs px-4 py-2 rounded-xl flex items-center gap-1.5"
                >
                  {creatingBoard ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create Board</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
