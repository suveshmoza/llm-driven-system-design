import { Link, useLocation } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

interface ProjectSidebarProps {
  projectId: string;
  projectName: string;
}

const navItems = [
  { label: 'Table Editor', path: 'tables', icon: 'T' },
  { label: 'SQL Editor', path: 'sql', icon: '>' },
  { label: 'Authentication', path: 'auth', icon: 'U' },
  { label: 'Settings', path: 'settings', icon: 'S' },
];

/** Renders the project navigation sidebar with links to Table Editor, SQL, Auth, and Settings. */
export function ProjectSidebar({ projectId, projectName }: ProjectSidebarProps) {
  const location = useLocation();
  const { logout } = useAuthStore();
  const user = useAuthStore((s) => s.user);

  const isActive = (path: string) => {
    return location.pathname.includes(`/project/${projectId}/${path}`);
  };

  return (
    <div className="w-56 bg-supabase-sidebar border-r border-supabase-border flex flex-col">
      {/* Project header */}
      <div className="p-4 border-b border-supabase-border">
        <Link to="/" className="text-supabase-secondary hover:text-supabase-text text-xs mb-2 block">
          &larr; All Projects
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-supabase-primary rounded flex items-center justify-center">
            <span className="text-black font-bold text-xs">
              {projectName.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-sm font-medium text-supabase-text truncate">{projectName}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={`/project/${projectId}/${item.path}` as string}
            className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
              isActive(item.path)
                ? 'bg-supabase-surface text-supabase-text border-l-2 border-supabase-primary'
                : 'text-supabase-secondary hover:text-supabase-text hover:bg-supabase-surface/50'
            }`}
          >
            <span className="w-5 h-5 flex items-center justify-center text-xs font-mono bg-supabase-dark-surface rounded">
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-supabase-border">
        <div className="flex items-center justify-between">
          <span className="text-xs text-supabase-secondary truncate">{user?.username}</span>
          <button
            onClick={() => logout()}
            className="text-xs text-supabase-secondary hover:text-supabase-text"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
