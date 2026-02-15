import type { PageTreeNode } from '../types';
import PageTreeItem from './PageTreeItem';

interface PageTreeProps {
  nodes: PageTreeNode[];
  spaceKey: string;
  depth?: number;
}

export default function PageTree({ nodes, spaceKey, depth = 0 }: PageTreeProps) {
  if (nodes.length === 0) {
    if (depth === 0) {
      return (
        <div className="px-2 py-2 text-sm text-confluence-text-muted italic">
          No pages yet
        </div>
      );
    }
    return null;
  }

  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <PageTreeItem key={node.id} node={node} spaceKey={spaceKey} depth={depth} />
      ))}
    </ul>
  );
}
