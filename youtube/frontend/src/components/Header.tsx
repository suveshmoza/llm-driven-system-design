import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useVideoStore } from '../stores/videoStore';
import AuthModal from './AuthModal';
import UploadModal from './UploadModal';

/**
 * Main application header component.
 * Provides the fixed top navigation bar with the YouTube logo,
 * search functionality, upload button (for authenticated users),
 * and user account menu. Manages auth and upload modal visibility.
 */
export default function Header() {
  const { user, logout } = useAuthStore();
  const { searchVideos, clearSearch } = useVideoStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchVideos(searchQuery.trim());
    }
  };

  const handleLogoClick = () => {
    clearSearch();
    setSearchQuery('');
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 h-14 bg-yt-dark flex items-center justify-between px-4 z-50 border-b border-transparent">
        {/* Logo Section */}
        <Link to="/" className="flex items-center gap-0.5 flex-shrink-0" onClick={handleLogoClick}>
          {/* YouTube Play Button Icon */}
          <div className="relative w-[90px] h-5">
            <svg viewBox="0 0 90 20" className="h-5 w-auto">
              <g fill="none">
                {/* Red rounded rectangle background */}
                <path
                  d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 2.24288e-07 14.285 0 14.285 0C14.285 0 5.35042 2.24288e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C2.24288e-07 5.35042 0 10 0 10C0 10 2.24288e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z"
                  fill="#FF0000"
                />
                {/* White play triangle */}
                <path
                  d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z"
                  fill="white"
                />
              </g>
              {/* YouTube text */}
              <text
                x="32"
                y="14.5"
                fill="white"
                fontSize="14"
                fontWeight="bold"
                fontFamily="'Roboto', Arial, sans-serif"
                letterSpacing="-0.5"
              >
                YouTube
              </text>
            </svg>
          </div>
        </Link>

        {/* Search bar - centered */}
        <form onSubmit={handleSearch} className="flex-1 max-w-[640px] mx-4">
          <div className="flex items-center">
            <div className="flex flex-1 border border-gray-700 rounded-l-full overflow-hidden focus-within:border-yt-blue-light">
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-yt-dark text-white px-4 py-2 placeholder-gray-500 focus:outline-none min-w-0"
              />
            </div>
            <button
              type="submit"
              className="px-6 py-2 bg-yt-dark-hover border border-gray-700 border-l-0 rounded-r-full hover:bg-yt-dark-elevated transition-colors"
              title="Search"
            >
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </button>
            {/* Voice search button */}
            <button
              type="button"
              className="ml-3 p-2.5 bg-yt-dark-hover rounded-full hover:bg-yt-dark-elevated transition-colors"
              title="Search with your voice"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
              </svg>
            </button>
          </div>
        </form>

        {/* User actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {user ? (
            <>
              {/* Create/Upload button */}
              <button
                onClick={() => setShowUploadModal(true)}
                className="icon-btn"
                title="Create"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>

              {/* Notifications */}
              <button className="icon-btn relative" title="Notifications">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                </svg>
              </button>

              {/* User menu */}
              <div className="relative ml-2">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="w-8 h-8 rounded-full bg-purple-700 flex items-center justify-center text-white font-medium text-sm hover:ring-2 hover:ring-yt-blue-light transition-all"
                >
                  {user.username.charAt(0).toUpperCase()}
                </button>

                {showUserMenu && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    {/* Dropdown menu */}
                    <div className="absolute right-0 top-12 bg-yt-dark-secondary border border-gray-700 rounded-xl shadow-2xl py-2 min-w-[300px] z-50">
                      {/* User info header */}
                      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-700">
                        <div className="w-10 h-10 rounded-full bg-purple-700 flex items-center justify-center text-white font-medium">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{user.channelName}</p>
                          <p className="text-sm text-yt-text-secondary-dark truncate">@{user.username}</p>
                        </div>
                      </div>

                      <div className="py-2">
                        <Link
                          to="/channel/$channelId"
                          params={{ channelId: user.id }}
                          className="flex items-center gap-4 px-4 py-2 hover:bg-yt-dark-hover transition-colors"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                          </svg>
                          <span>Your channel</span>
                        </Link>

                        <Link
                          to="/studio"
                          className="flex items-center gap-4 px-4 py-2 hover:bg-yt-dark-hover transition-colors"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
                          </svg>
                          <span>YouTube Studio</span>
                        </Link>
                      </div>

                      <div className="border-t border-gray-700 py-2">
                        <button
                          onClick={() => {
                            logout();
                            setShowUserMenu(false);
                          }}
                          className="flex items-center gap-4 w-full text-left px-4 py-2 hover:bg-yt-dark-hover transition-colors"
                        >
                          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                          </svg>
                          <span>Sign out</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 border border-gray-600 text-yt-blue-light rounded-full hover:bg-yt-blue-light/10 transition-colors"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
              </svg>
              <span className="font-medium">Sign in</span>
            </button>
          )}
        </div>
      </header>

      {/* Modals */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showUploadModal && <UploadModal onClose={() => setShowUploadModal(false)} />}
    </>
  );
}
