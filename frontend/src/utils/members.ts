import type { WorkspaceMember } from "../types/workspace.types";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export interface MemberDisplay {
  label: string;
  /** False when the id does not belong to a current member. */
  isMember: boolean;
}

/**
 * How to show a stored user reference (task assignee, activity author)
 * (P1-A16). Names come from the member list; ids are never shown raw.
 *  - current member                 -> their name (or email)
 *  - a user id that is not a member -> "Former member"
 *  - anything else                  -> the stored text as-is: tasks saved
 *    before this fix may hold a display name instead of an id
 */
export const describeMember = (
  /** undefined = still loading; null = could not be loaded. */
  members: WorkspaceMember[] | undefined | null,
  userId: string | null | undefined
): MemberDisplay | null => {
  if (!userId) return null;
  // Member list not available: do not judge membership.
  if (members === undefined) return { label: "…", isMember: true };
  if (members === null) return { label: "Assigned (names unavailable)", isMember: true };
  const member = members.find((m) => m.userId === userId);
  if (member) {
    return { label: member.name || member.email || "Member", isMember: true };
  }
  if (OBJECT_ID.test(userId)) {
    return { label: "Former member", isMember: false };
  }
  return { label: userId, isMember: false };
};
