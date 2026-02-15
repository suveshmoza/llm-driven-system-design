import { Link } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

export function Header() {
  const { user, isAuthenticated, logout } = useAuthStore();

  return (
    <header className="bg-white border-b border-panel-border px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 text-text-primary hover:opacity-80 transition-opacity">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-primary">
            <rect x="2" y="2" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="14" cy="14" r="5" stroke="currentColor" strokeWidth="2" />
            <line x1="8" y1="20" x2="20" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-lg font-semibold">Excalidraw</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {isAuthenticated && user ? (
            <>
              <span className="text-sm text-text-secondary">
                {user.displayName || user.username}
              </span>
              <button
                onClick={() => logout()}
                className="text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Login
              </Link>
              <Link
                to="/register"
                className="text-sm bg-primary text-white px-4 py-1.5 rounded-lg hover:bg-primary-hover transition-colors"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
