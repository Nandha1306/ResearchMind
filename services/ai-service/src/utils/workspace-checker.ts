/**
 * Workspace membership check, shared across services (P1-A13): validates the
 * id (400), times out (3 s) and reports a failed check as 503 instead of
 * "not a member". Resolves true/false only for a definite answer.
 */
export {
  checkWorkspaceMembership,
  getWorkspaceMemberIds,
} from "../../../../packages/shared/auth/workspace-membership";
