import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UserMinus, Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspace.store";
import { useAuthStore } from "../../store/auth.store";
import { useWorkspaceMembers } from "../../hooks/useWorkspaceMembers";
import { workspaceApi } from "../../api/workspace.api";
import { canRemoveMember } from "../../utils/workspace-roles";

/**
 * Members of the current workspace. The owner sees a Remove action next to
 * every other member (SEC-010); the server enforces the rule (403 for anyone
 * else) and the removed member loses access immediately. Their tasks are
 * unassigned by the server.
 */
export const WorkspaceMembersList: React.FC = () => {
  const queryClient = useQueryClient();
  const { currentWorkspace, fetchWorkspaces } = useWorkspaceStore();
  const { user } = useAuthStore();
  const workspaceId = currentWorkspace?._id;
  const { data: members = [], isLoading, isError } = useWorkspaceMembers(workspaceId);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const removeMember = async (memberId: string, name: string) => {
    if (!workspaceId || removingId) return;
    if (!window.confirm(`Remove ${name} from this workspace? They lose access immediately and their tasks are unassigned.`)) {
      return;
    }
    setRemovingId(memberId);
    setMessage(null);
    try {
      await workspaceApi.removeMember(workspaceId, memberId);
      await queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
      // Refresh the stored workspace (member count) without blocking the UI.
      void fetchWorkspaces().catch(() => {});
      setMessage(`${name} was removed.`);
    } catch (err) {
      const serverMessage = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setMessage(`Could not remove ${name}: ${serverMessage || (err as Error)?.message || "Please try again."}`);
    } finally {
      setRemovingId(null);
    }
  };

  if (!workspaceId) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">Members</h3>
      {isLoading && <p className="text-[11px] text-text-muted">Loading members...</p>}
      {isError && <p className="text-[11px] text-red-400">Members could not be loaded.</p>}
      <ul className="space-y-1.5">
        {members.map((member) => {
          const isOwnerRow = member.userId === currentWorkspace?.ownerId;
          return (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-2 text-[12px] text-text-primary bg-bg-elevated border border-border-subtle rounded-lg px-2.5 py-1.5"
            >
              <span className="truncate" title={member.email || member.name}>
                {member.name}
                {isOwnerRow && <span className="ml-1.5 text-[10px] text-text-muted">(Owner)</span>}
              </span>
              {canRemoveMember(currentWorkspace, user, member.userId) && (
                <button
                  type="button"
                  onClick={() => void removeMember(member.userId, member.name)}
                  disabled={Boolean(removingId)}
                  className="p-1 rounded text-text-muted hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 cursor-pointer"
                  title={`Remove ${member.name}`}
                  aria-label={`Remove ${member.name}`}
                >
                  {removingId === member.userId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserMinus className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {message && <p className="text-[11px] text-text-secondary" role="status">{message}</p>}
    </div>
  );
};
