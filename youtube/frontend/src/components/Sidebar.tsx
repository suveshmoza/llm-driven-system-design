import { Link, useLocation } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

/**
 * Navigation menu items configuration.
 * Each item defines an icon key, display label, route path,
 * and optional auth requirement.
 */
const menuItems = [
  { icon: 'home', label: 'Home', path: '/' },
  { icon: 'shorts', label: 'Shorts', path: '/shorts' },
  { icon: 'subscriptions', label: 'Subscriptions', path: '/subscriptions', requiresAuth: true },
];

const libraryItems = [
  { icon: 'history', label: 'History', path: '/history', requiresAuth: true },
  { icon: 'playlist', label: 'Playlists', path: '/playlists', requiresAuth: true },
  { icon: 'watchlater', label: 'Watch later', path: '/watchlater', requiresAuth: true },
  { icon: 'liked', label: 'Liked videos', path: '/liked', requiresAuth: true },
];

const exploreItems = [
  { icon: 'trending', label: 'Trending', path: '/trending' },
  { icon: 'music', label: 'Music', path: '/music' },
  { icon: 'gaming', label: 'Gaming', path: '/gaming' },
  { icon: 'news', label: 'News', path: '/news' },
];

const icons: Record<string, JSX.Element> = {
  home: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 4.33l7 6.12V20h-4v-6H9v6H5v-9.55l7-6.12M12 3L4 10v11h6v-6h4v6h6V10l-8-7z"/>
    </svg>
  ),
  homeActive: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M4 21V10L12 3L20 10V21H14V14H10V21H4Z"/>
    </svg>
  ),
  shorts: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M10 14.65v-5.3L15 12l-5 2.65zm7.77-4.33-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.5-4.5c1.29-.68 2.06-2.04 1.99-3.49-.07-1.42-.94-2.68-2.23-3.25zm-.23 5.86-8.5 4.5c-1.34.71-3.01.2-3.72-1.14-.71-1.34-.2-3.01 1.14-3.72l2.04-1.08v-1.21l-.69-.28-1.11-.46c-.99-.41-1.65-1.35-1.7-2.41-.05-1.06.52-2.06 1.46-2.56l8.5-4.5c1.34-.71 3.01-.2 3.72 1.14.71 1.34.2 3.01-1.14 3.72L15.5 9.26v1.21l1.8.74c.99.41 1.65 1.35 1.7 2.41.05 1.06-.52 2.06-1.46 2.56z"/>
    </svg>
  ),
  subscriptions: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M10 18v-6l5 3-5 3zm7-15H7v2h10V3zm3 4H4v2h16V7zm2 4H2v10h20V11zm-2 8H4v-6h16v6z"/>
    </svg>
  ),
  trending: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 15.5h-2V17h2v1.5zm0-3.5H10v-.5c0-.55.45-1 1-1s1 .45 1 1v.5h.01c.01.28-.11.53-.3.72l-1.7 1.7v.08H12v1.5H9.99v-.5c0-.55.45-1 1-1s1 .45 1 1v-.5l1.7-1.7c.19-.19.3-.44.3-.73V11H10v-1.5h2v1.5zm2.5-5H9v2h5.5c.28 0 .5-.22.5-.5v-1c0-.28-.22-.5-.5-.5z"/>
    </svg>
  ),
  history: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14.97 16.95 10 13.87V7h2v5.76l4.03 2.49-1.06 1.7zM22 12c0 5.51-4.49 10-10 10S2 17.51 2 12h2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8C8.58 4 5.81 6.08 4.65 9.08L6 10H2V6l1.76 1.76C5.28 4.68 8.39 3 12 3c5.51 0 10 4.49 10 10z"/>
    </svg>
  ),
  playlist: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M22 7H2v2h20V7zm-8 6H2v2h12v-2zm0 4H2v2h12v-2zm4-4v10l6-5-6-5z"/>
    </svg>
  ),
  watchlater: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 3c-4.96 0-9 4.04-9 9s4.04 9 9 9 9-4.04 9-9-4.04-9-9-9m0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm.5-11H11v6l5.25 3.15.75-1.23-4.5-2.67V8z"/>
    </svg>
  ),
  liked: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4l1.82 1.82C9.15 23.14 9.57 23.29 10 23.29l5.5-.01c1.5-.02 2.87-1.1 3.27-2.55l1.38-5.03c.43-1.56-.58-3.19-2.18-3.7zM5 13v6H4v-6h1zm14.28 5.5-1.38 5.04c-.18.65-.76 1.11-1.44 1.12l-5.55.01c-.11 0-.22-.04-.3-.12L9 22.94V12.02l5.76-6.43c.18-.2.43-.31.69-.31.4 0 .74.28.86.66l-1.69 5.5 6.66.02c.78.25 1.11 1.14.73 1.84z"/>
    </svg>
  ),
  music: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6zm-2 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>
  ),
  gaming: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M21.58 16.09l-1.09-7.66C20.21 6.46 18.52 5 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19c.68 0 1.32-.27 1.8-.75L9 16h6l2.25 2.25c.48.48 1.13.75 1.8.75 1.56 0 2.75-1.37 2.53-2.91zM11 11H9v2H8v-2H6v-1h2V8h1v2h2v1zm4-1c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm2 3c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
    </svg>
  ),
  news: (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M22 3H2v6h1v11c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9h1V3zM4 5h16v2H4V5zm15 15H5V9h14v11zM8 12h8v2H8v-2zm0 4h4v2H8v-2z"/>
    </svg>
  ),
};

/**
 * Props for the Sidebar component.
 */
interface SidebarProps {
  /** Whether to show the collapsed (icon-only) version */
  collapsed?: boolean;
}

/**
 * Left sidebar navigation component.
 * Displays navigation links to main sections (Home, Trending, etc.)
 * and the current user's channel. Supports both expanded and
 * collapsed modes for responsive layouts.
 *
 * @param props.collapsed - If true, shows only icons without labels
 */
export default function Sidebar({ collapsed = false }: SidebarProps) {
  const location = useLocation();
  const { user } = useAuthStore();

  const filteredMenuItems = menuItems.filter(
    (item) => !item.requiresAuth || user
  );

  const filteredLibraryItems = libraryItems.filter(
    (item) => !item.requiresAuth || user
  );

  if (collapsed) {
    return (
      <aside className="fixed left-0 top-14 bottom-0 w-[72px] bg-yt-dark overflow-y-auto py-1 scrollbar-thin">
        {filteredMenuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-1.5 py-4 px-1 rounded-lg mx-1 text-[10px] hover:bg-yt-dark-hover transition-colors ${
                isActive ? 'font-medium' : 'font-normal text-yt-text-secondary-dark'
              }`}
            >
              {isActive && item.icon === 'home' ? icons.homeActive : icons[item.icon]}
              <span className="leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="fixed left-0 top-14 bottom-0 w-60 bg-yt-dark overflow-y-auto py-3 px-3 scrollbar-thin">
      {/* Main navigation */}
      <div className="pb-3 border-b border-gray-700">
        {filteredMenuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`sidebar-item ${isActive ? 'active bg-yt-dark-hover' : ''}`}
            >
              {isActive && item.icon === 'home' ? icons.homeActive : icons[item.icon]}
              <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* You section */}
      {user && (
        <div className="py-3 border-b border-gray-700">
          <Link
            to="/channel/$channelId"
            params={{ channelId: user.id }}
            className="flex items-center gap-1 px-3 py-1.5 text-base font-medium hover:bg-yt-dark-hover rounded-lg transition-colors"
          >
            <span>You</span>
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            </svg>
          </Link>

          {filteredLibraryItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`sidebar-item ${isActive ? 'active bg-yt-dark-hover' : ''}`}
              >
                {icons[item.icon]}
                <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Explore section */}
      <div className="py-3 border-b border-gray-700">
        <h3 className="px-3 py-1.5 text-base font-medium mb-1">Explore</h3>
        {exploreItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`sidebar-item ${isActive ? 'active bg-yt-dark-hover' : ''}`}
            >
              {icons[item.icon]}
              <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Subscriptions section */}
      {user && (
        <div className="py-3">
          <h3 className="px-3 py-1.5 text-base font-medium mb-1">Subscriptions</h3>
          <Link
            to="/channel/$channelId"
            params={{ channelId: user.id }}
            className="sidebar-item"
          >
            <div className="w-6 h-6 rounded-full bg-purple-700 flex items-center justify-center text-xs font-medium">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <span className="truncate">{user.channelName}</span>
          </Link>
        </div>
      )}

      {/* Footer links */}
      <div className="py-4 px-3">
        <div className="text-xs text-yt-text-secondary-dark leading-relaxed">
          <div className="flex flex-wrap gap-x-2 gap-y-1 mb-3">
            <a href="#" className="hover:text-white">About</a>
            <a href="#" className="hover:text-white">Press</a>
            <a href="#" className="hover:text-white">Copyright</a>
            <a href="#" className="hover:text-white">Contact us</a>
            <a href="#" className="hover:text-white">Creators</a>
            <a href="#" className="hover:text-white">Advertise</a>
            <a href="#" className="hover:text-white">Developers</a>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-1 mb-4">
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Policy & Safety</a>
            <a href="#" className="hover:text-white">How YouTube works</a>
            <a href="#" className="hover:text-white">Test new features</a>
          </div>
          <p className="text-yt-text-secondary-dark">YouTube Clone</p>
        </div>
      </div>
    </aside>
  );
}
