import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { useState } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  onFilter?: (filters: FilterOptions) => void;
  placeholder?: string;
}

export interface FilterOptions {
  statType?: "hits" | "runs" | "rbi" | "slg";
  confidenceMin?: number;
  team?: string;
}

export function SearchBar({ onSearch, onFilter, placeholder = "Search players..." }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({});

  const handleSearch = (value: string) => {
    setQuery(value);
    onSearch(value);
  };

  const handleFilterChange = (newFilters: FilterOptions) => {
    setFilters(newFilters);
    onFilter?.(newFilters);
  };

  const clearSearch = () => {
    setQuery("");
    setFilters({});
    onSearch("");
    onFilter?.({});
  };

  return (
    <div className="space-y-3 mb-6">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10 bg-slate-800 border-slate-700 text-white placeholder-slate-500"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button
          onClick={() => setShowFilters(!showFilters)}
          variant="outline"
          className="bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
        >
          Filters
        </Button>
      </div>

      {showFilters && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-300">Stat Type</label>
            <select
              value={filters.statType || ""}
              onChange={(e) =>
                handleFilterChange({
                  ...filters,
                  statType: (e.target.value as any) || undefined,
                })
              }
              className="w-full mt-1 bg-slate-700 border border-slate-600 rounded text-white px-3 py-2"
            >
              <option value="">All Stats</option>
              <option value="hits">Hits</option>
              <option value="runs">Runs</option>
              <option value="rbi">RBI</option>
              <option value="slg">Slg %</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-300">Min Confidence</label>
            <input
              type="range"
              min="0"
              max="100"
              value={filters.confidenceMin || 0}
              onChange={(e) =>
                handleFilterChange({
                  ...filters,
                  confidenceMin: parseInt(e.target.value),
                })
              }
              className="w-full mt-1"
            />
            <span className="text-xs text-slate-400">{filters.confidenceMin || 0}%</span>
          </div>

          <Button
            onClick={() => {
              setFilters({});
              onFilter?.({});
            }}
            variant="ghost"
            className="w-full text-slate-400 hover:text-white"
          >
            Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
}
