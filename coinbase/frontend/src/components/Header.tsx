import { Link } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className="bg-cb-card border-b border-cb-border">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-cb-primary rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="text-lg font-bold text-cb-text hidden sm:block">coinbase</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            <Link
              to="/"
              className="text-sm text-cb-text-secondary hover:text-cb-text transition-colors"
              activeProps={{ className: 'text-sm text-cb-text font-medium' }}
            >
              Markets
            </Link>
            {user && (
              <>
                <Link
                  to="/portfolio"
                  className="text-sm text-cb-text-secondary hover:text-cb-text transition-colors"
                  activeProps={{ className: 'text-sm text-cb-text font-medium' }}
                >
                  Portfolio
                </Link>
                <Link
                  to="/orders"
                  className="text-sm text-cb-text-secondary hover:text-cb-text transition-colors"
                  activeProps={{ className: 'text-sm text-cb-text font-medium' }}
                >
                  Orders
                </Link>
              </>
            )}
          </nav>
        </div>

        {/* Auth */}
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-cb-text-secondary hidden sm:block">
                {user.displayName || user.username}
              </span>
              <button
                onClick={logout}
                className="text-sm text-cb-text-secondary hover:text-cb-text transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="text-sm text-cb-text-secondary hover:text-cb-text transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="text-sm bg-cb-primary hover:bg-cb-primary-hover text-white px-4 py-2 rounded-lg transition-colors"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
