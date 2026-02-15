import type { DashboardKPIs } from '../types';

interface DashboardMetricsProps {
  kpis: DashboardKPIs;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const metrics = [
  { key: 'totalRevenue', label: 'Total Revenue', format: 'currency', color: 'bg-salesforce-success' },
  { key: 'pipelineValue', label: 'Pipeline Value', format: 'currency', color: 'bg-salesforce-primary' },
  { key: 'openOpportunities', label: 'Open Deals', format: 'number', color: 'bg-salesforce-cloud' },
  { key: 'wonOpportunities', label: 'Won Deals', format: 'number', color: 'bg-emerald-500' },
  { key: 'newLeads', label: 'New Leads', format: 'number', color: 'bg-salesforce-warning' },
  { key: 'activitiesDue', label: 'Activities Due', format: 'number', color: 'bg-salesforce-danger' },
  { key: 'conversionRate', label: 'Conversion Rate', format: 'percent', color: 'bg-indigo-500' },
  { key: 'avgDealSize', label: 'Avg Deal Size', format: 'currency', color: 'bg-purple-500' },
] as const;

/** Renders a grid of KPI metric cards for revenue, pipeline, deals, leads, and conversion rate. */
export function DashboardMetrics({ kpis }: DashboardMetricsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {metrics.map((metric) => {
        const value = kpis[metric.key as keyof DashboardKPIs];
        let displayValue: string;

        if (metric.format === 'currency') {
          displayValue = formatCurrency(value);
        } else if (metric.format === 'percent') {
          displayValue = `${value}%`;
        } else {
          displayValue = value.toLocaleString();
        }

        return (
          <div
            key={metric.key}
            className="bg-white rounded-lg shadow-sm border border-salesforce-border p-4"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 ${metric.color} rounded-lg flex items-center justify-center`}>
                <span className="text-white text-lg font-bold">
                  {metric.label.charAt(0)}
                </span>
              </div>
              <div>
                <p className="text-xs text-salesforce-secondary uppercase tracking-wide">
                  {metric.label}
                </p>
                <p className="text-xl font-bold text-salesforce-text">{displayValue}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
