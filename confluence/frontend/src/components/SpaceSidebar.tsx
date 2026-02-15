import { Link } from '@tanstack/react-router';
import type { Space, PageTreeNode } from '../types';
import PageTree from './PageTree';

interface SpaceSidebarProps {
  space: Space;
  tree: PageTreeNode[];
  spaceKey: string;
}

export default function SpaceSidebar({ space, tree, spaceKey }: SpaceSidebarProps) {
  return (
    <aside className="w-72 bg-confluence-sidebar border-r border-confluence-border overflow-y-auto scrollbar-thin shrink-0">
      <div className="p-4">
        {/* Space header */}
        <Link
          to="/space/$spaceKey"
          params={{ spaceKey }}
          className="flex items-center gap-2 mb-4 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 bg-confluence-primary rounded flex items-center justify-center">
            <span className="text-white font-bold text-xs">{space.key}</span>
          </div>
          <span className="font-semibold text-confluence-text text-sm truncate">
            {space.name}
          </span>
        </Link>

        {/* Create page button */}
        <Link
          to="/space/$spaceKey/page/$slug/edit"
          params={{ spaceKey, slug: 'new' }}
          className="flex items-center gap-2 w-full px-3 py-2 mb-4 text-sm text-confluence-primary border border-dashed border-confluence-primary rounded hover:bg-confluence-info transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create page
        </Link>

        {/* Page tree */}
        <div className="text-xs font-medium text-confluence-text-muted uppercase tracking-wider mb-2 px-2">
          Pages
        </div>
        <PageTree nodes={tree} spaceKey={spaceKey} />
      </div>
    </aside>
  );
}
