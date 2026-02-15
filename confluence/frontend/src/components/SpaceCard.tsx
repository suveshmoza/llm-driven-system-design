import { Link } from '@tanstack/react-router';
import type { Space } from '../types';

interface SpaceCardProps {
  space: Space;
}

/** Renders a clickable space card with key badge, name, and page count. */
export default function SpaceCard({ space }: SpaceCardProps) {
  return (
    <Link
      to="/space/$spaceKey"
      params={{ spaceKey: space.key }}
      className="block p-4 bg-white rounded-lg border border-confluence-border hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-confluence-primary rounded-lg flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-sm">{space.key}</span>
        </div>
        <div className="min-w-0">
          <h3 className="font-medium text-confluence-text truncate">{space.name}</h3>
          <p className="text-xs text-confluence-text-muted">
            {space.page_count || 0} pages
          </p>
        </div>
      </div>
      {space.description && (
        <p className="text-sm text-confluence-text-subtle mt-2 line-clamp-2">
          {space.description}
        </p>
      )}
    </Link>
  );
}
