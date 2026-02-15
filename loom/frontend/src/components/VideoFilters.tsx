interface VideoFiltersProps {
  search: string;
  onSearchChange: (search: string) => void;
}

/** Search input for filtering the video library by title or description. */
export function VideoFilters({ search, onSearchChange }: VideoFiltersProps) {
  return (
    <div className="mb-6">
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-loom-secondary"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-loom-border rounded-lg focus:outline-none focus:ring-2 focus:ring-loom-primary text-sm"
          placeholder="Search videos..."
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-loom-secondary hover:text-loom-text"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
