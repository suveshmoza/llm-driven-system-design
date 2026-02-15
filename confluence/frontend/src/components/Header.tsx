import { Link } from '@tanstack/react-router';
import type { User } from '../types';

interface HeaderProps {
  user: User | null;
  onLogout: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
}

/** Top navigation bar with logo, search input, and user menu. */
export default function Header({ user, onLogout, searchQuery, onSearchChange, onSearchSubmit }: HeaderProps) {
  return (
    <header className="h-14 bg-white border-b border-confluence-border flex items-center px-4 shrink-0">
      {/* Logo */}
      <Link to="/" className="flex items-center gap-2 mr-6">
        <div className="w-8 h-8 bg-confluence-primary rounded flex items-center justify-center">
          <span className="text-white font-bold text-sm">C</span>
        </div>
        <span className="text-lg font-semibold text-confluence-text">Confluence</span>
      </Link>

      {/* Navigation */}
      <nav className="flex items-center gap-4 mr-6">
        <Link
          to="/"
          className="text-sm text-confluence-text-subtle hover:text-confluence-primary transition-colors"
        >
          Home
        </Link>
      </nav>

      {/* Search */}
      <form onSubmit={onSearchSubmit} className="flex-1 max-w-lg mx-4">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-confluence-text-muted"
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
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search pages..."
            className="w-full pl-9 pr-4 py-1.5 text-sm bg-confluence-sidebar border border-confluence-border rounded focus:outline-none focus:ring-2 focus:ring-confluence-primary focus:bg-white transition-colors"
          />
        </div>
      </form>

      {/* User menu */}
      <div className="flex items-center gap-3 ml-auto">
        {user ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-confluence-primary rounded-full flex items-center justify-center">
                <span className="text-white text-xs font-medium">
                  {(user.display_name || user.username).charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-sm text-confluence-text">
                {user.display_name || user.username}
              </span>
            </div>
            <button
              onClick={onLogout}
              className="text-sm text-confluence-text-subtle hover:text-confluence-text transition-colors"
            >
              Log out
            </button>
          </>
        ) : (
          <Link
            to="/login"
            className="text-sm px-3 py-1.5 bg-confluence-primary text-white rounded hover:bg-confluence-hover transition-colors"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
