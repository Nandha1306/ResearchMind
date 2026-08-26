import React, { useState, useId } from "react";
import { useWorkspaceStore } from "../../store/workspace.store";
import { Button } from "../ui/button";
import { X, Loader2, Building2, AlertCircle, CheckCircle2 } from "lucide-react";

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const nameId = useId();
  const descId = useId();
  const { createWorkspace } = useWorkspaceStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 3) {
      setError("Workspace name must be at least 3 characters long.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const created = await createWorkspace({
        name: trimmedName,
        description: description.trim() || undefined,
      });

      if (created) {
        setSuccessMsg(`Workspace "${created.name}" created successfully!`);
        setTimeout(() => {
          setIsSubmitting(false);
          setName("");
          setDescription("");
          setSuccessMsg(null);
          onClose();
          if (onSuccess) onSuccess();
        }, 800);
      }
    } catch (err: any) {
      setError(err.message || "Failed to create workspace.");
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-workspace-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-bg-surface border border-border-default rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 text-text-primary">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent-bg text-accent-primary border border-accent-primary/20">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 id="create-workspace-modal-title" className="text-base font-bold text-text-primary">
                Create Workspace
              </h3>
              <p className="text-xs text-text-secondary">Set up a new research workspace for your team.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error / Success Notifications */}
        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="text-xs font-semibold text-text-primary block">
              Workspace Name <span className="text-destructive">*</span>
            </label>
            <input
              id={nameId}
              type="text"
              placeholder="e.g. AI Oceanography Lab, Quantum Research"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={descId} className="text-xs font-semibold text-text-primary block">
              Description <span className="text-text-secondary font-normal">(Optional)</span>
            </label>
            <textarea
              id={descId}
              rows={3}
              placeholder="Brief description of the research goals or domain..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-bg-elevated border border-border-default text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-xs h-9 px-4 border-border-default hover:bg-bg-elevated cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="bg-accent-primary hover:bg-accent-hover text-white text-xs h-9 px-5 gap-2 font-medium cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Create Workspace</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
