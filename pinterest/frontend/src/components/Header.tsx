import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

export default function Header() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (searchQuery.trim().length >= 2) {
        navigate({ to: '/', search: { q: searchQuery.trim() } });
      }
    },
    [searchQuery, navigate],
  );

  const handleLogout = useCallback(async () => {
    await logout();
    navigate({ to: '/login' });
  }, [logout, navigate]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2 max-w-screen-2xl mx-auto">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-1 shrink-0">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="#E60023">
            <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
          </svg>
          <span className="text-pinterest-red font-bold text-lg hidden sm:inline">Pinterest</span>
        </Link>

        {/* Navigation links */}
        <nav className="flex items-center gap-1 shrink-0">
          <Link
            to="/"
            className="px-3 py-2 rounded-full text-sm font-semibold hover:bg-gray-100 transition-colors [&.active]:bg-black [&.active]:text-white"
          >
            Home
          </Link>
          {user && (
            <Link
              to="/create"
              className="px-3 py-2 rounded-full text-sm font-semibold hover:bg-gray-100 transition-colors [&.active]:bg-black [&.active]:text-white"
            >
              Create
            </Link>
          )}
        </nav>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex-1 mx-2">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary"
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for ideas"
              className="w-full bg-gray-bg rounded-full pl-10 pr-4 py-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </form>

        {/* User section */}
        {user ? (
          <div className="flex items-center gap-1 shrink-0" ref={menuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="relative w-8 h-8 rounded-full bg-pinterest-red text-white font-bold text-sm flex items-center justify-center hover:bg-pinterest-red-hover transition-colors"
            >
              {user.displayName?.[0]?.toUpperCase() || user.username[0].toUpperCase()}
            </button>

            {showUserMenu && (
              <div className="absolute right-4 top-14 bg-white rounded-2xl shadow-modal py-2 min-w-48 z-50">
                <Link
                  to="/profile/$username"
                  params={{ username: user.username }}
                  className="block px-4 py-2 hover:bg-gray-100 text-sm"
                  onClick={() => setShowUserMenu(false)}
                >
                  Profile
                </Link>
                <hr className="my-1" />
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/login" className="btn-pinterest text-sm">
              Log in
            </Link>
            <Link to="/register" className="btn-secondary text-sm">
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
