import type { PipelineStage } from '../types';

interface PipelineChartProps {
  pipeline: PipelineStage[];
}

function formatCurrency(cents: number): string {
  if (cents >= 100000000) return `$${(cents / 100000000).toFixed(1)}M`;
  if (cents >= 100000) return `$${(cents / 100000).toFixed(0)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

const stageColors: Record<string, string> = {
  'Prospecting': '#0176D3',
  'Qualification': '#00A1E0',
  'Needs Analysis': '#FE9339',
  'Proposal': '#9B59B6',
  'Negotiation': '#E74C3C',
  'Closed Won': '#2E844A',
  'Closed Lost': '#706E6B',
};

/** Renders a CSS-only horizontal bar chart visualizing the sales pipeline by stage with color coding. */
export function PipelineChart({ pipeline }: PipelineChartProps) {
  const maxAmount = Math.max(...pipeline.map((s) => s.totalAmountCents), 1);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-salesforce-border p-6">
      <h3 className="text-lg font-semibold text-salesforce-text mb-4">Sales Pipeline</h3>
      <div className="space-y-3">
        {pipeline.map((stage) => {
          const width = Math.max((stage.totalAmountCents / maxAmount) * 100, 2);
          const color = stageColors[stage.stage] || '#706E6B';

          return (
            <div key={stage.stage}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-salesforce-text">{stage.stage}</span>
                <span className="text-sm text-salesforce-secondary">
                  {stage.count} deals - {formatCurrency(stage.totalAmountCents)}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-6">
                <div
                  className="h-6 rounded-full transition-all duration-500 flex items-center px-2"
                  style={{ width: `${width}%`, backgroundColor: color }}
                >
                  {width > 15 && (
                    <span className="text-xs text-white font-medium">
                      {formatCurrency(stage.totalAmountCents)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {pipeline.length === 0 && (
        <p className="text-salesforce-secondary text-center py-8">No pipeline data available</p>
      )}
    </div>
  );
}
