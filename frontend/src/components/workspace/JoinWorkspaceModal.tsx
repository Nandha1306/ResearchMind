import React, { useState, useEffect } from "react";
import { useWorkspaceStore } from "../../store/workspace.store";
import { Button } from "../ui/button";
import { X, Loader2, AlertCircle, LogIn } from "lucide-react";

interface JoinWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ApiErrorShape {
  response?: { status?: number; data?: { message?: string } };
  message?: string;
}

export const JoinWorkspaceModal: React.FC<JoinWorkspaceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { joinWorkspace, fetchWorkspaces } = useWorkspaceStore();

  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setInviteCode("");
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError("Please enter a valid invite code.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await joinWorkspace({ inviteCode: code });
      await fetchWorkspaces();
      onClose();
    } catch (err) {
      const apiErr = err as ApiErrorShape;
      const msg =
        apiErr?.response?.data?.message ||
        "Failed to join workspace. Check the code and try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-workspace-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-bg-surface border border-border-default rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-text-primary">
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:px-6 border-b border-border-default">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
              <LogIn className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="join-workspace-modal-title"
                className="text-base font-bold text-text-primary"
              >
                Join Workspace
              </h2>
              <span className="text-xs text-text-secondary">
                Enter an invite code to join an existing team.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4">
          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="join-invite-code"
              className="text-xs font-medium text-text-secondary"
            >
              Invite Code <span className="text-destructive">*</span>
            </label>
            <input
              id="join-invite-code"
              type="text"
              value={inviteCode}
              onChange={(e) => {
                setInviteCode(e.target.value.toUpperCase());
                if (error) setError(null);
              }}
              disabled={submitting}
              placeholder="e.g. K3F9Q2XZ"
              className="w-full px-3.5 py-2.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-accent-primary/50 disabled:opacity-50"
              autoFocus
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
              className="text-xs px-3.5 py-2 rounded-xl cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !inviteCode.trim()}
              className="bg-accent-primary hover:bg-accent-hover text-white text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Joining...</span>
                </>
              ) : (
                <span>Join Workspace</span>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
