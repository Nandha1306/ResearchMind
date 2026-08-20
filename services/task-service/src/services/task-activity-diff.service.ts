export type TaskActivityChange = {
  action:
    | "status_changed"
    | "priority_changed"
    | "assigned"
    | "due_date_set";

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

  (previous, current) => {
    if (
      previous.assigneeId === current.assigneeId ||
      !current.assigneeId
    ) {
      return null;
    }

    return {
      action: "assigned",
      payload: {
        from: previous.assigneeId,
        to: current.assigneeId,
      },
    };
  },

  (previous, current) => {
    if (
      previous.dueDate != null ||
      current.dueDate == null ||
      sameDate(previous.dueDate, current.dueDate)
    ) {
      return null;
    }

    return {
      action: "due_date_set",
      payload: {
        dueDate: current.dueDate,
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