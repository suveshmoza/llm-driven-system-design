import { useLocation, Link } from '@tanstack/react-router';

interface BreadcrumbProps {
  projectName: string;
}

/** Renders a breadcrumb navigation trail based on the current route path. */
export function Breadcrumb({ projectName }: BreadcrumbProps) {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);

  // Build breadcrumb items
  const items: { label: string; path?: string }[] = [
    { label: 'Projects', path: '/' },
    { label: projectName },
  ];

  // Add section
  if (parts.length >= 4) {
    const section = parts[3];
    const sectionLabels: Record<string, string> = {
      tables: 'Table Editor',
      sql: 'SQL Editor',
      auth: 'Authentication',
      settings: 'Settings',
    };
    items.push({ label: sectionLabels[section] || section });

    // Add table name if present
    if (parts.length >= 5 && section === 'tables') {
      items.push({ label: parts[4] });
    }
  }

  return (
    <div className="border-b border-supabase-border px-6 py-3 bg-supabase-dark-surface">
      <div className="flex items-center gap-2 text-sm">
        {items.map((item, index) => (
          <span key={index} className="flex items-center gap-2">
            {index > 0 && <span className="text-supabase-secondary">/</span>}
            {item.path ? (
              <Link to={item.path} className="text-supabase-secondary hover:text-supabase-text">
                {item.label}
              </Link>
            ) : index === items.length - 1 ? (
              <span className="text-supabase-text">{item.label}</span>
            ) : (
              <span className="text-supabase-secondary">{item.label}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
