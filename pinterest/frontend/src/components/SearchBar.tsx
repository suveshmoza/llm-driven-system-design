import { useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

interface SearchBarProps {
  initialQuery?: string;
}

/** Renders a search input that navigates to search results on submission. */
export default function SearchBar({ initialQuery = '' }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const navigate = useNavigate();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim().length >= 2) {
        navigate({ to: '/', search: { q: query.trim() } });
      }
    },
    [query, navigate],
  );

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for ideas"
          className="w-full bg-gray-bg rounded-full pl-12 pr-4 py-4 text-base outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
        />
      </div>
    </form>
  );
}
