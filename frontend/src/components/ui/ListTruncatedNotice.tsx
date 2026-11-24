import React from "react";
import { Info } from "lucide-react";

/**
 * Shown when a list hit the client page ceiling (ISS-043): the workspace has
 * more items than were loaded. Counts on the page refer to the loaded items.
 */
export const ListTruncatedNotice: React.FC<{ shown: number; noun: string }> = ({ shown, noun }) => (
  <div
    role="status"
    className="flex items-start gap-2 rounded-lg border border-border-default bg-bg-elevated px-3 py-2 text-[12px] text-text-secondary"
  >
    <Info className="w-4 h-4 shrink-0 mt-0.5" />
    <span>
      Showing the first {shown} {noun}. This workspace has more; counts on this page refer to the {noun} shown.
    </span>
  </div>
);
