import { Link } from '@tanstack/react-router';

interface Breadcrumb {
  id: string;
  title: string;
  slug: string;
}

interface BreadcrumbNavProps {
  breadcrumbs: Breadcrumb[];
  spaceKey: string;
  spaceName: string;
}

/** Renders breadcrumb navigation from space root through ancestor pages. */
export default function BreadcrumbNav({ breadcrumbs, spaceKey, spaceName }: BreadcrumbNavProps) {
  return (
    <nav className="flex items-center gap-1 text-sm text-confluence-text-subtle mb-4 flex-wrap">
      <Link
        to="/space/$spaceKey"
        params={{ spaceKey }}
        className="hover:text-confluence-primary transition-colors"
      >
        {spaceName}
      </Link>

      {breadcrumbs.map((crumb, index) => (
        <span key={crumb.id} className="flex items-center gap-1">
          <svg className="w-3 h-3 text-confluence-text-muted" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          {index < breadcrumbs.length - 1 ? (
            <Link
              to="/space/$spaceKey/page/$slug"
              params={{ spaceKey, slug: crumb.slug }}
              className="hover:text-confluence-primary transition-colors"
            >
              {crumb.title}
            </Link>
          ) : (
            <span className="text-confluence-text font-medium">{crumb.title}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
