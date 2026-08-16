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
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-[#111111] border border-[#2A2A2A] rounded-xl p-3.5">
      {/* Search Input & Counter */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B8B8F]">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search documents..."
            className="w-full h-9 pl-9 pr-4 text-[12px] text-[#EDEDEE] bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg focus:border-[#7C6AF7]/60 outline-none transition-all placeholder:text-[#4A4A50]"
          />
        </div>

        <span className="text-[11px] font-semibold text-[#8B8B8F] whitespace-nowrap bg-[#1A1A1A] px-2.5 py-1 rounded-md border border-[#2A2A2A]">
          {filteredCount} / {totalCount}
        </span>
      </div>

      {/* Filters Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        <div className="text-[#8B8B8F] text-[11px] font-semibold flex items-center gap-1 pr-1.5 shrink-0">
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
                  ? "bg-[#7C6AF7] text-white shadow-sm"
                  : "bg-[#1A1A1A] text-[#8B8B8F] border border-[#2A2A2A] hover:text-[#EDEDEE] hover:border-[#3A3A3A]"
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
