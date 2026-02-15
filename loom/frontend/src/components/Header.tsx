import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

/** Application header with navigation links, recording button, and auth controls. */
export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  return (
    <header className="bg-loom-sidebar text-white">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate({ to: '/' })}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 bg-loom-primary rounded-lg flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <polygon points="10,8 16,12 10,16" fill="white" />
            </svg>
          </div>
          <span className="text-lg font-bold">Loom</span>
        </button>

        <nav className="flex items-center gap-4">
          {user ? (
            <>
              <button
                onClick={() => navigate({ to: '/' })}
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                Library
              </button>
              <button
                onClick={() => navigate({ to: '/record' })}
                className="text-sm px-3 py-1.5 bg-loom-primary rounded-lg hover:bg-loom-hover transition-colors"
              >
                Record
              </button>
              <div className="flex items-center gap-3 ml-2">
                <span className="text-sm text-gray-300">{user.username}</span>
                <button
                  onClick={() => {
                    logout();
                    navigate({ to: '/login' });
                  }}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => navigate({ to: '/login' })}
              className="text-sm text-gray-300 hover:text-white transition-colors"
            >
              Sign In
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
