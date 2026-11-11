/**
 * Turning meeting action items into tasks (P1-A17, P1-A23). Framework-free so
 * it can be unit-tested.
 */

export interface ActionItemInput {
  task: string;
  assignee: string;
  due: string;
}

/** Server limits (packages/validation/schemas/task.schema.ts). */
export const MAX_TASKS_PER_IMPORT = 50;
const MAX_TITLE_LENGTH = 200;

/**
 * A due date only when the meeting gave an unambiguous calendar date
 * (YYYY-MM-DD). Free text such as "next Friday" or "03/04" is NOT guessed --
 * `new Date()` would silently turn it into a wrong date.
 */
export const toIsoDueDate = (due: string | null | undefined): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((due ?? "").trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date.toISOString() : null;
};

/** FNV-1a: a short, stable fingerprint of the selected items. */
const fingerprint = (text: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

/**
 * Identifies one import: the same summary and the same selection always give
 * the same key, so a repeated submission (double click, retry after a lost
 * response) is recognised by the server and creates nothing new.
 */
export const buildImportKey = (summaryKey: string, indices: number[]) => {
  const sorted = [...indices].sort((a, b) => a - b);
  return `${summaryKey}:${fingerprint(sorted.join(","))}:${sorted.length}`;
};

/** The bulk-create payload for the selected action items. */
export const buildActionItemTasks = (
  items: ActionItemInput[],
  indices: number[],
  boardId: string
) =>
  [...indices]
    .sort((a, b) => a - b)
    .map((index) => items[index])
    .filter((item): item is ActionItemInput => Boolean(item?.task?.trim()))
    .map((item) => {
      const dueDate = toIsoDueDate(item.due);
      const context = [
        item.assignee?.trim() ? `Assignee context: ${item.assignee.trim()}` : null,
        // Keep due text that could not be read as a date instead of dropping it.
        item.due?.trim() && !dueDate ? `Due (from meeting notes): ${item.due.trim()}` : null,
      ].filter(Boolean);

      return {
        boardId,
        title: item.task.trim().slice(0, MAX_TITLE_LENGTH),
        description: context.length > 0 ? context.join("\n") : undefined,
        status: "todo" as const,
        priority: "medium" as const,
        // Meeting notes name people in free text; they are never guessed
        // into workspace member ids (the name is kept in the description).
        assigneeId: null,
        dueDate,
        parentTaskId: null,
      };
    });
