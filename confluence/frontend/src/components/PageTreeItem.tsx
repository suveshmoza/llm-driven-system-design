import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { PageTreeNode } from '../types';
import PageTree from './PageTree';

interface PageTreeItemProps {
  node: PageTreeNode;
  spaceKey: string;
  depth: number;
}

export default function PageTreeItem({ node, spaceKey, depth }: PageTreeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <li>
      <div
        className="flex items-center group hover:bg-white rounded transition-colors"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {/* Expand/Collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-5 h-5 flex items-center justify-center shrink-0 text-confluence-text-muted hover:text-confluence-text transition-colors ${
            !hasChildren ? 'invisible' : ''
          }`}
        >
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Page icon */}
        <svg
          className="w-4 h-4 mr-1.5 text-confluence-text-muted shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>

        {/* Page link */}
        <Link
          to="/space/$spaceKey/page/$slug"
          params={{ spaceKey, slug: node.slug }}
          className="flex-1 py-1.5 text-sm text-confluence-text hover:text-confluence-primary truncate transition-colors"
          activeProps={{ className: 'text-confluence-primary font-medium' }}
        >
          {node.title}
        </Link>

        {/* Status indicator */}
        {node.status === 'draft' && (
          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded mr-1">
            Draft
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <PageTree nodes={node.children} spaceKey={spaceKey} depth={depth + 1} />
      )}
    </li>
  );
}
