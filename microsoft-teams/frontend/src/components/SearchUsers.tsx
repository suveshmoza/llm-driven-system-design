import { useState } from 'react';
import { userApi } from '../services/api';
import type { User } from '../types';

interface SearchUsersProps {
  onSelect: (user: User) => void;
  placeholder?: string;
}

/** Typeahead user search input with debounced API queries and selectable results. */
export function SearchUsers({ onSelect, placeholder }: SearchUsersProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (q.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const { users } = await userApi.search(q);
      setResults(users);
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (user: User) => {
    onSelect(user);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder={placeholder || 'Search users...'}
        className="w-full border border-teams-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teams-primary"
      />

      {(results.length > 0 || searching) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-teams-surface border border-teams-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
          {searching && (
            <div className="px-3 py-2 text-sm text-teams-secondary">Searching...</div>
          )}
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => handleSelect(user)}
              className="w-full text-left px-3 py-2 hover:bg-teams-bg flex items-center gap-2"
            >
              <div className="w-6 h-6 rounded-full bg-teams-primary text-white flex items-center justify-center text-xs font-bold">
                {(user.display_name || user.username).charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-sm text-teams-text">{user.display_name || user.username}</div>
                <div className="text-xs text-teams-secondary">@{user.username}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
