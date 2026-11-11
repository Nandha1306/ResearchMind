export type TaskActivityChange = {
  action:
    | "status_changed"
    | "priority_changed"
    | "assigned"
    | "unassigned"
    | "due_date_set"
    | "due_date_changed"
    | "due_date_removed"
    | "title_changed"
    | "description_changed"
    | "board_changed";

  payload: Record<string, unknown>;
};

type ActivityRule = (
  previous: any,
  current: any
) => TaskActivityChange | null;

const sameDate = (
  a: Date | string | null | undefined,
  b: Date | string | null | undefined
): boolean => {
  if (a == null && b == null) {
    return true;
  }

  if (a == null || b == null) {
    return false;
  }

  const timeA = new Date(a).getTime();
  const timeB = new Date(b).getTime();

  return timeA === timeB;
};

const ACTIVITY_RULES: ActivityRule[] = [
  // Status change
  (previous, current) => {
    if (previous.status === current.status) {
      return null;
    }

    return {
      action: "status_changed",
      payload: {
        from: previous.status,
        to: current.status,
      },
    };
  },

  // Priority change
  (previous, current) => {
    if (previous.priority === current.priority) {
      return null;
    }

    return {
      action: "priority_changed",
      payload: {
        from: previous.priority,
        to: current.priority,
      },
    };
  },

  // Assignee change or unassignment
  (previous, current) => {
    const prevAssignee = previous.assigneeId ? String(previous.assigneeId) : null;
    const currAssignee = current.assigneeId ? String(current.assigneeId) : null;

    if (prevAssignee === currAssignee) {
      return null;
    }

    if (!currAssignee && prevAssignee) {
      return {
        action: "unassigned",
        payload: {
          from: prevAssignee,
        },
      };
    }

    return {
      action: "assigned",
      payload: {
        from: prevAssignee,
        to: currAssignee,
      },
    };
  },

  // Due date set, changed, or removed
  (previous, current) => {
    const prevDate = previous.dueDate;
    const currDate = current.dueDate;

    if (sameDate(prevDate, currDate)) {
      return null;
    }

    if (!prevDate && currDate) {
      return {
        action: "due_date_set",
        payload: {
          dueDate: currDate,
        },
      };
    }

    if (prevDate && !currDate) {
      return {
        action: "due_date_removed",
        payload: {
          previousDueDate: prevDate,
        },
      };
    }

    return {
      action: "due_date_changed",
      payload: {
        from: prevDate,
        to: currDate,
      },
    };
  },

  // Title change
  (previous, current) => {
    if (!current.title || previous.title === current.title) {
      return null;
    }

    return {
      action: "title_changed",
      payload: {
        from: previous.title,
        to: current.title,
      },
    };
  },

  // Description change
  (previous, current) => {
    const prevDesc = previous.description || "";
    const currDesc = current.description || "";

    if (prevDesc === currDesc) {
      return null;
    }

    return {
      action: "description_changed",
      payload: {
        from: prevDesc,
        to: currDesc,
      },
    };
  },

  // Board change
  (previous, current) => {
    const prevBoard = previous.boardId ? String(previous.boardId) : null;
    const currBoard = current.boardId ? String(current.boardId) : null;

    if (!currBoard || prevBoard === currBoard) {
      return null;
    }

    return {
      action: "board_changed",
      payload: {
        from: prevBoard,
        to: currBoard,
      },
    };
  },
];

export const detectTaskActivityChanges = (
  previous: any,
  current: any
): TaskActivityChange[] => {
  return ACTIVITY_RULES
    .map((rule) => rule(previous, current))
    .filter(
      (change): change is TaskActivityChange =>
        change !== null
    );
};