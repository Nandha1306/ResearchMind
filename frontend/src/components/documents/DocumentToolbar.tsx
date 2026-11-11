import React from "react";
import { Search, Filter } from "lucide-react";
import type { DocumentFileType, EmbeddingStatus } from "../../types/document.types";

export type FilterOption = "all" | DocumentFileType | EmbeddingStatus;

interface DocumentToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilter: FilterOption;
  onFilterChange: (filter: FilterOption) => void;
  totalCount: number;
  filteredCount: number;
}

export const DocumentToolbar: React.FC<DocumentToolbarProps> = ({
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  totalCount,
  filteredCount,
}) => {
  const filters: { label: string; value: FilterOption }[] = [
    { label: "All", value: "all" },
    { label: "PDF", value: "pdf" },
    { label: "DOCX", value: "docx" },
    { label: "Pending", value: "pending" },
    { label: "Indexing", value: "indexing" },
    { label: "Indexed", value: "indexed" },
    { label: "Failed", value: "failed" },
  ];

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-bg-surface border border-border-default rounded-xl p-3.5 shadow-sm">
      {/* Search Input & Counter */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search documents..."
            className="w-full h-9 pl-9 pr-4 text-[12px] text-text-primary bg-bg-elevated border border-border-subtle rounded-lg focus:border-accent-primary/60 outline-none transition-all placeholder:text-text-muted"
          />
        </div>

        <span className="text-[11px] font-semibold text-text-secondary whitespace-nowrap bg-bg-elevated px-2.5 py-1 rounded-md border border-border-subtle">
          {filteredCount} / {totalCount}
        </span>
      </div>

      {/* Filters Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        <div className="text-text-secondary text-[11px] font-semibold flex items-center gap-1 pr-1.5 shrink-0">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter:</span>
        </div>

        {filters.map((filter) => {
          const isActive = activeFilter === filter.value;
          return (
            <button
              key={filter.value}
              onClick={() => onFilterChange(filter.value)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors shrink-0 cursor-pointer ${
                isActive
                  ? "bg-accent-primary text-white shadow-sm"
                  : "bg-bg-elevated text-text-secondary border border-border-subtle hover:text-text-primary hover:border-border-default"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
