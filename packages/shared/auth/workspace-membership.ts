import { AppError } from "../errors/AppError";

/**
 * Workspace membership checks against workspace-service, shared by the
 * document, task and ai services (previously three diverging copies).
 *
 * Membership is answered by workspace-service, the owner of the data, using
 * the caller's own bearer token -- the user id is never taken from the
 * request body or query string.
 *
 * Outcomes are kept distinct, so an outage is never reported as "access
 * denied" and a malformed id never reaches another service's URL:
 *   - malformed workspace id                -> AppError 400
 *   - caller not authenticated              -> AppError 401
 *   - the check itself could not complete   -> AppError 503 (timeout,
 *     network error, 5xx, unexpected reply)
 *   - otherwise                             -> true (member) / false (not)
 */

export const MEMBERSHIP_CHECK_TIMEOUT_MS = 3000;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const CHECK_FAILED_MESSAGE =
  "Workspace access could not be verified right now. Please try again.";

const workspaceServiceUrl = () =>
  (process.env.WORKSPACE_SERVICE_URL || "http://127.0.0.1:5002").replace(/\/+$/, "");

export const isValidWorkspaceId = (workspaceId: unknown): workspaceId is string =>
  typeof workspaceId === "string" && OBJECT_ID.test(workspaceId);

export const assertValidWorkspaceId = (workspaceId: unknown): string => {
  if (!isValidWorkspaceId(workspaceId)) {
    throw new AppError("Invalid workspace ID", 400);
  }
  return workspaceId;
};

interface CheckOptions {
  timeoutMs?: number;
}

const callWorkspaceService = async (
  path: string,
  authHeader: string,
  timeoutMs: number
): Promise<Response> => {
  try {
    return await fetch(`${workspaceServiceUrl()}${path}`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.warn(
      `[workspace-membership] workspace-service request failed: ${(error as Error)?.name ?? "Error"}`
    );
    throw new AppError(CHECK_FAILED_MESSAGE, 503);
  }
};

const readJson = async (response: Response): Promise<any> =>
  response.json().catch(() => null);

/**
 * Is the caller (identified by `authHeader`) a member of `workspaceId`?
 * `_userId` is kept for call-site compatibility; workspace-service derives the
 * user from the token itself.
 */
export const checkWorkspaceMembership = async (
  workspaceId: string,
  _userId: string,
  authHeader?: string,
  { timeoutMs = MEMBERSHIP_CHECK_TIMEOUT_MS }: CheckOptions = {}
): Promise<boolean> => {
  assertValidWorkspaceId(workspaceId);

  if (!authHeader) {
    throw new AppError("Authentication required", 401);
  }

  const response = await callWorkspaceService(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/membership`,
    authHeader,
    timeoutMs
  );

  if (response.status === 401) {
    throw new AppError("Authentication required", 401);
  }
  if (!response.ok) {
    console.warn(`[workspace-membership] membership check returned ${response.status}`);
    throw new AppError(CHECK_FAILED_MESSAGE, 503);
  }

  const body = await readJson(response);
  if (body?.success !== true || typeof body?.data?.isMember !== "boolean") {
    throw new AppError(CHECK_FAILED_MESSAGE, 503);
  }

  return body.data.isMember;
};

/**
 * The caller's access to a workspace: member, and owner. Same outcomes as
 * checkWorkspaceMembership. `isOwner` is true only when workspace-service
 * says so explicitly (an older workspace-service without the field means
 * "not owner": owner-only actions fail closed).
 */
export const getWorkspaceAccess = async (
  workspaceId: string,
  authHeader?: string,
  { timeoutMs = MEMBERSHIP_CHECK_TIMEOUT_MS }: CheckOptions = {}
): Promise<{ isMember: boolean; isOwner: boolean }> => {
  assertValidWorkspaceId(workspaceId);

  if (!authHeader) {
    throw new AppError("Authentication required", 401);
  }

  const response = await callWorkspaceService(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/membership`,
    authHeader,
    timeoutMs
  );

  if (response.status === 401) {
    throw new AppError("Authentication required", 401);
  }
  if (!response.ok) {
    console.warn(`[workspace-membership] membership check returned ${response.status}`);
    throw new AppError(CHECK_FAILED_MESSAGE, 503);
  }

  const body = await readJson(response);
  if (body?.success !== true || typeof body?.data?.isMember !== "boolean") {
    throw new AppError(CHECK_FAILED_MESSAGE, 503);
  }

  const isMember = body.data.isMember;
  return { isMember, isOwner: isMember && body.data.isOwner === true };
};

/**
 * Owner-only actions (SEC-010): resolves when the caller owns the workspace;
 * otherwise 403 -- "not a member" or `ownerOnlyMessage` -- plus the
 * 400/401/503 outcomes above.
 */
export const assertWorkspaceOwner = async (
  workspaceId: string,
  authHeader: string | undefined,
  ownerOnlyMessage: string
): Promise<void> => {
  const { isMember, isOwner } = await getWorkspaceAccess(workspaceId, authHeader);
  if (!isMember) {
    throw new AppError("Access denied. You are not a member of this workspace.", 403);
  }
  if (!isOwner) {
    throw new AppError(ownerOnlyMessage, 403);
  }
};

/**
 * The user ids of a workspace's members, read with the caller's token (the
 * caller must be a member). Used to validate references to other users, such
 * as a task assignee.
 *
 * Throws 403 when the caller is not a member (workspace-service answers 404
 * "not found or access denied"), plus the 400/401/503 outcomes above.
 */
export const getWorkspaceMemberIds = async (
  workspaceId: string,
  authHeader?: string,
  { timeoutMs = MEMBERSHIP_CHECK_TIMEOUT_MS }: CheckOptions = {}
): Promise<string[]> => {
  assertValidWorkspaceId(workspaceId);

  if (!authHeader) {
    throw new AppError("Authentication required", 401);
  }

  const response = await callWorkspaceService(
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
    authHeader,
    timeoutMs
  );

  if (response.status === 401) {
    throw new AppError("Authentication required", 401);
  }
  if (response.status === 404 || response.status === 403) {
    throw new AppError("You are not a member of this workspace", 403);
  }
  if (!response.ok) {
    console.warn(`[workspace-membership] workspace lookup returned ${response.status}`);
    throw new AppError(CHECK_FAILED_MESSAGE, 503);
  }

  const members = (await readJson(response))?.data?.members;
  if (!Array.isArray(members)) {
    throw new AppError(CHECK_FAILED_MESSAGE, 503);
  }

  return members.map(String);
};
