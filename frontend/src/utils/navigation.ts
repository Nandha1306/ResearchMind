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
