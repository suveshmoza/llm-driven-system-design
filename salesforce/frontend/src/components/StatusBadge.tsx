interface StatusBadgeProps {
  status: string;
  type?: 'opportunity' | 'lead' | 'activity';
}

const opportunityColors: Record<string, string> = {
  'Prospecting': 'bg-blue-100 text-blue-800',
  'Qualification': 'bg-cyan-100 text-cyan-800',
  'Needs Analysis': 'bg-orange-100 text-orange-800',
  'Proposal': 'bg-purple-100 text-purple-800',
  'Negotiation': 'bg-red-100 text-red-800',
  'Closed Won': 'bg-green-100 text-green-800',
  'Closed Lost': 'bg-gray-100 text-gray-600',
};

const leadColors: Record<string, string> = {
  'New': 'bg-blue-100 text-blue-800',
  'Contacted': 'bg-yellow-100 text-yellow-800',
  'Qualified': 'bg-green-100 text-green-800',
  'Unqualified': 'bg-red-100 text-red-800',
  'Converted': 'bg-purple-100 text-purple-800',
};

const activityColors: Record<string, string> = {
  'call': 'bg-green-100 text-green-800',
  'email': 'bg-blue-100 text-blue-800',
  'meeting': 'bg-purple-100 text-purple-800',
  'note': 'bg-gray-100 text-gray-800',
};

/** Renders a color-coded pill badge for opportunity, lead, or activity status values. */
export function StatusBadge({ status, type = 'opportunity' }: StatusBadgeProps) {
  let colorClass = 'bg-gray-100 text-gray-800';

  if (type === 'opportunity') {
    colorClass = opportunityColors[status] || colorClass;
  } else if (type === 'lead') {
    colorClass = leadColors[status] || colorClass;
  } else if (type === 'activity') {
    colorClass = activityColors[status] || colorClass;
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
}
