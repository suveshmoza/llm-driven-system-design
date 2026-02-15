import { useAuthStore } from '../stores/authStore';
import { SearchBar } from './SearchBar';
import { getInitials, stringToColor } from '../utils/format';

export function Header() {
  const { user, logout } = useAuthStore();

  return (
    <header className="h-16 bg-white flex items-center px-4 border-b border-gmail-border flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 w-64 flex-shrink-0">
        <button className="p-2 rounded-full hover:bg-gmail-hover">
          <svg width="24" height="24" viewBox="0 0 24 24">
            <path fill="#5F6368" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
          </svg>
        </button>
        <div className="flex items-center gap-1">
          <svg width="40" height="30" viewBox="0 0 75 24">
            <path fill="#EA4335" d="M0 8.5v7c0 2.5 2 4.5 4.5 4.5h2.7l5.3-6V4H4.5C2 4 0 6 0 8.5z" />
            <path fill="#34A853" d="M12.5 20h7c2.5 0 4.5-2 4.5-4.5v-7c0-2.5-2-4.5-4.5-4.5h-2.7l-5.3 6v10h1z" />
            <path fill="#FBBC04" d="M0 8.5L12.5 20V10L7.2 4H4.5C2 4 0 6 0 8.5z" />
            <path fill="#4285F4" d="M24 8.5L12.5 20h-1V10l5.3-6h2.7c2.5 0 4.5 2 4.5 4.5z" />
            <path fill="#C5221F" d="M12.5 10L0 8.5V8.5L12.5 20V10z" />
          </svg>
          <span className="text-xl text-gmail-text-secondary font-normal">
            Gmail
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex-1 max-w-2xl mx-4">
        <SearchBar />
      </div>

      {/* User Menu */}
      <div className="flex items-center gap-2 ml-auto">
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gmail-text-secondary hidden md:block">
              {user.email}
            </span>
            <div className="relative group">
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
                style={{ backgroundColor: stringToColor(user.displayName) }}
              >
                {getInitials(user.displayName)}
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white shadow-lg rounded-lg py-2 w-48 hidden group-hover:block z-50">
                <div className="px-4 py-2 border-b border-gmail-border">
                  <div className="text-sm font-medium text-gmail-text">
                    {user.displayName}
                  </div>
                  <div className="text-xs text-gmail-text-secondary">
                    {user.email}
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-2 text-sm text-gmail-text hover:bg-gmail-hover"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
