import { Link, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

/** Renders the top navigation bar with user menu and auth links. */
export function Header() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate({ to: '/login' });
  };

  return (
    <header className="bg-zoom-surface border-b border-zoom-card px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link to="/" className="text-xl font-bold text-zoom-primary flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="inline-block">
            <rect width="28" height="28" rx="6" fill="#2D8CFF" />
            <path
              d="M7 10.5C7 9.67 7.67 9 8.5 9H15.5C16.33 9 17 9.67 17 10.5V17.5C17 18.33 16.33 19 15.5 19H8.5C7.67 19 7 18.33 7 17.5V10.5Z"
              fill="white"
            />
            <path d="M18 12L21 9.5V18.5L18 16V12Z" fill="white" />
          </svg>
          Zoom
        </Link>
        {user && (
          <nav className="flex items-center gap-4">
            <Link
              to="/"
              className="text-zoom-secondary hover:text-zoom-text transition-colors text-sm"
            >
              Dashboard
            </Link>
            <Link
              to="/schedule"
              className="text-zoom-secondary hover:text-zoom-text transition-colors text-sm"
            >
              Schedule
            </Link>
            <Link
              to="/history"
              className="text-zoom-secondary hover:text-zoom-text transition-colors text-sm"
            >
              History
            </Link>
          </nav>
        )}
      </div>
      {user && (
        <div className="flex items-center gap-4">
          <span className="text-sm text-zoom-secondary">{user.displayName}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-zoom-secondary hover:text-zoom-red transition-colors"
          >
            Sign Out
          </button>
        </div>
      )}
    </header>
  );
}
