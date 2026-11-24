/**
 * Navigation helpers (P1-A19). Framework-free so they can be unit-tested.
 */

/** Longest question the AI researcher accepts from the UI. */
export const MAX_UI_QUERY_LENGTH = 1000;

/**
 * A question handed to the AI researcher page through router state
 * (`navigate(path, { state: { initialQuery } })`) by the right-panel "Ask
 * ResearchMind" box or the top-bar search. Returns null when there is none or
 * it is unusable.
 */
export const readInitialQuery = (state: unknown): string | null => {
  const value = (state as { initialQuery?: unknown } | null)?.initialQuery;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_UI_QUERY_LENGTH) return null;
  return trimmed;
};

export type DeepLinkResolution<W> =
  | { action: "select"; workspace: W }
  | { action: "stay" }
  | { action: "redirect" };

/**
 * `/app/workspace/:id/search` (REQ-128): which workspace the AI researcher
 * should open. A member's workspace is selected (or kept if it is already
 * current); a malformed id or a workspace the user is not a member of
 * redirects without switching. The server still enforces membership.
 */
export const resolveWorkspaceDeepLink = <W extends { _id: string }>(
  workspaces: W[] | null | undefined,
  currentId: string | null | undefined,
  id: string | null | undefined
): DeepLinkResolution<W> => {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) return { action: "redirect" };
  const workspace = workspaces?.find((ws) => ws._id === id);
  if (!workspace) return { action: "redirect" };
  if (workspace._id === currentId) return { action: "stay" };
  return { action: "select", workspace };
};

/** Where an unknown URL (or "/") leads. */
export const defaultRouteFor = (isAuthenticated: boolean) =>
  isAuthenticated ? "/dashboard" : "/login";

/**
 * Where to go after signing in: back to the protected page that sent the user
 * to the login screen, if any -- only same-app paths, never an external URL or
 * the auth pages themselves.
 */
export const postLoginDestination = (state: unknown): string => {
  const from = (state as { from?: { pathname?: unknown; search?: unknown } } | null)?.from;
  const pathname = typeof from?.pathname === "string" ? from.pathname : "";
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    // "/\host" is treated like "//host" by browsers: never leave the app.
    pathname.includes("\\") ||
    pathname === "/login" ||
    pathname === "/register"
  ) {
    return "/dashboard";
  }
  const search = typeof from?.search === "string" && from.search.startsWith("?") ? from.search : "";
  return `${pathname}${search}`;
};
