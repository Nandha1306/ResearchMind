/**
 * Workspace name rules, mirroring the server's createWorkspaceSchema
 * (packages/validation/schemas/workspace.schema.ts): 3..100 characters. The
 * form sends the trimmed name, so the check runs on the trimmed value.
 */
export const MIN_WORKSPACE_NAME_LENGTH = 3;
export const MAX_WORKSPACE_NAME_LENGTH = 100;

/** Why the server would reject this name, or null when it accepts it. */
export const workspaceNameProblem = (name: string): string | null => {
  const length = name.trim().length;
  if (length < MIN_WORKSPACE_NAME_LENGTH) {
    return `Workspace name must be at least ${MIN_WORKSPACE_NAME_LENGTH} characters long.`;
  }
  if (length > MAX_WORKSPACE_NAME_LENGTH) {
    return `Workspace name must be at most ${MAX_WORKSPACE_NAME_LENGTH} characters.`;
  }
  return null;
};
