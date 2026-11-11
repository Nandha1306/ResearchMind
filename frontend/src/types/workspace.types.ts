/**
 * A workspace member as returned by GET /workspaces/:id/members. `userId` is
 * the stable identity (stored as a task's assigneeId); name and email are for
 * display only.
 */
export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface Workspace {
  _id: string;
  name: string;
  description: string;
  ownerId: string;
  inviteCode: string;
  members: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceCreationPayload {
  name: string;
  description?: string;
}

export interface WorkspaceJoinPayload {
  inviteCode: string;
}

export interface LocalTeammate {
  email: string;
  role: "Member" | "Advisor" | "Viewer";
}

export interface LocalOnboardingData {
  name: string;
  description: string;
  urlSlug: string;
  iconUrl?: string;
  selectedDomain: string;
  teammates: LocalTeammate[];
}
