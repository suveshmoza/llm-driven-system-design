import type { PipelineStage, RevenueByMonth, LeadsBySource } from '../types';

interface ReportChartProps {
  type: 'pipeline' | 'revenue' | 'leads';
  pipelineData?: PipelineStage[];
  revenueData?: RevenueByMonth[];
  leadsData?: LeadsBySource[];
}

function formatCurrency(cents: number): string {
  if (cents >= 100000000) return `$${(cents / 100000000).toFixed(1)}M`;
  if (cents >= 100000) return `$${(cents / 100000).toFixed(0)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

const barColors = ['#0176D3', '#00A1E0', '#FE9339', '#9B59B6', '#E74C3C', '#2E844A', '#706E6B', '#3498DB'];

/** Renders CSS-only bar/column charts for pipeline, revenue-by-month, or leads-by-source report data. */
export function ReportChart({ type, pipelineData, revenueData, leadsData }: ReportChartProps) {
  if (type === 'pipeline' && pipelineData) {
    const maxAmount = Math.max(...pipelineData.map((s) => s.totalAmountCents), 1);

    return (
      <div className="bg-white rounded-lg shadow-sm border border-salesforce-border p-6">
        <h3 className="text-lg font-semibold text-salesforce-text mb-4">Pipeline by Stage</h3>
        <div className="flex items-end gap-3 h-48">
          {pipelineData.map((stage, i) => {
            const height = Math.max((stage.totalAmountCents / maxAmount) * 100, 5);
            return (
              <div key={stage.stage} className="flex-1 flex flex-col items-center">
                <span className="text-xs text-salesforce-secondary mb-1">
                  {formatCurrency(stage.totalAmountCents)}
                </span>
                <div
                  className="w-full rounded-t transition-all duration-300"
                  style={{ height: `${height}%`, backgroundColor: barColors[i % barColors.length] }}
                />
                <span className="text-xs text-salesforce-secondary mt-2 text-center leading-tight">
                  {stage.stage.split(' ').map((w, j) => (
                    <span key={j}>{w}<br /></span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        {pipelineData.length === 0 && (
          <p className="text-salesforce-secondary text-center py-8">No data</p>
        )}
      </div>
    );
  }

  if (type === 'revenue' && revenueData) {
    const maxAmount = Math.max(...revenueData.map((r) => r.totalAmountCents), 1);

    return (
      <div className="bg-white rounded-lg shadow-sm border border-salesforce-border p-6">
        <h3 className="text-lg font-semibold text-salesforce-text mb-4">Revenue by Month</h3>
        <div className="flex items-end gap-2 h-48">
          {revenueData.map((month) => {
            const height = Math.max((month.totalAmountCents / maxAmount) * 100, 5);
            return (
              <div key={month.month} className="flex-1 flex flex-col items-center">
                <span className="text-xs text-salesforce-secondary mb-1">
                  {formatCurrency(month.totalAmountCents)}
                </span>
                <div
                  className="w-full rounded-t transition-all duration-300 bg-salesforce-success"
                  style={{ height: `${height}%` }}
                />
                <span className="text-xs text-salesforce-secondary mt-2">
                  {month.month.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
        {revenueData.length === 0 && (
          <p className="text-salesforce-secondary text-center py-8">No data</p>
        )}
      </div>
    );
  }

  if (type === 'leads' && leadsData) {
    const maxCount = Math.max(...leadsData.map((l) => l.count), 1);

    return (
      <div className="bg-white rounded-lg shadow-sm border border-salesforce-border p-6">
        <h3 className="text-lg font-semibold text-salesforce-text mb-4">Leads by Source</h3>
        <div className="space-y-3">
          {leadsData.map((source, i) => {
            const width = Math.max((source.count / maxCount) * 100, 5);
            return (
              <div key={source.source}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-salesforce-text">{source.source}</span>
                  <span className="text-salesforce-secondary">{source.count} leads</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-4">
                  <div
                    className="h-4 rounded-full transition-all duration-300"
                    style={{ width: `${width}%`, backgroundColor: barColors[i % barColors.length] }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {leadsData.length === 0 && (
          <p className="text-salesforce-secondary text-center py-8">No data</p>
        )}
      </div>
    );
  }

  return null;
}
