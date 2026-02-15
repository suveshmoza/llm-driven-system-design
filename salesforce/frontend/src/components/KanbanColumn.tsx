import { useDroppable } from '@dnd-kit/core';
import { OpportunityCard } from './OpportunityCard';
import type { Opportunity } from '../types';

interface KanbanColumnProps {
  stage: string;
  opportunities: Opportunity[];
}

function formatCurrency(cents: number): string {
  if (cents >= 100000000) return `$${(cents / 100000000).toFixed(1)}M`;
  if (cents >= 100000) return `$${(cents / 100000).toFixed(0)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

const stageColors: Record<string, string> = {
  'Prospecting': 'border-blue-400',
  'Qualification': 'border-cyan-400',
  'Needs Analysis': 'border-orange-400',
  'Proposal': 'border-purple-400',
  'Negotiation': 'border-red-400',
  'Closed Won': 'border-green-400',
  'Closed Lost': 'border-gray-400',
};

/** Renders a droppable Kanban column for a pipeline stage with opportunity cards and total amount. */
export function KanbanColumn({ stage, opportunities }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });

  const totalAmount = opportunities.reduce((sum, o) => sum + (o.amount_cents || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-64 bg-gray-50 rounded-lg border-t-3 ${stageColors[stage] || 'border-gray-400'} ${
        isOver ? 'bg-blue-50 ring-2 ring-salesforce-primary' : ''
      }`}
    >
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-salesforce-text truncate">{stage}</h3>
          <span className="text-xs bg-white border border-salesforce-border rounded-full px-2 py-0.5 text-salesforce-secondary">
            {opportunities.length}
          </span>
        </div>
        <p className="text-xs text-salesforce-secondary mt-1">
          {formatCurrency(totalAmount)}
        </p>
      </div>

      <div className="p-2 space-y-2 kanban-column min-h-[120px]">
        {opportunities.map((opp) => (
          <OpportunityCard key={opp.id} opportunity={opp} />
        ))}
        {opportunities.length === 0 && (
          <p className="text-xs text-salesforce-secondary text-center py-4">
            Drop deals here
          </p>
        )}
      </div>
    </div>
  );
}
