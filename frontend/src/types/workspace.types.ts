export interface WorkspaceMember {
  userId: string;
  role: "Lead" | "Member" | "Advisor" | "Viewer";
  email?: string;
}

export interface Workspace {
  _id: string;
  name: string;
  description: string;
  ownerId: string;
  inviteCode: string;
  members: WorkspaceMember[];
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
