import type { PortfolioHolding } from '../types';
import { formatUsd, getCurrencyColor } from '../utils/format';

interface PortfolioSummaryProps {
  totalValueUsd: string;
  holdings: PortfolioHolding[];
}

export function PortfolioSummary({ totalValueUsd, holdings }: PortfolioSummaryProps) {
  const nonZeroHoldings = holdings.filter((h) => parseFloat(h.valueUsd) > 0);

  return (
    <div className="space-y-6">
      {/* Total value */}
      <div className="bg-cb-card rounded-xl border border-cb-border p-6">
        <p className="text-cb-text-secondary text-sm mb-1">Total Portfolio Value</p>
        <p className="text-3xl font-bold">{formatUsd(totalValueUsd)}</p>
      </div>

      {/* Allocation chart (simple bar chart) */}
      <div className="bg-cb-card rounded-xl border border-cb-border p-6">
        <h2 className="text-sm font-semibold text-cb-text-secondary mb-4">Asset Allocation</h2>

        {/* Stacked bar */}
        {nonZeroHoldings.length > 0 && (
          <div className="flex rounded-full overflow-hidden h-4 mb-4">
            {nonZeroHoldings.map((h) => {
              const pct = parseFloat(h.allocation);
              if (pct < 0.5) return null;
              return (
                <div
                  key={h.currencyId}
                  style={{
                    width: `${pct}%`,
                    backgroundColor: getCurrencyColor(h.currencyId),
                  }}
                  title={`${h.currencyId}: ${pct.toFixed(1)}%`}
                />
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="space-y-3">
          {nonZeroHoldings.map((h) => (
            <div key={h.currencyId} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getCurrencyColor(h.currencyId) }}
                />
                <div>
                  <span className="text-sm font-medium">{h.currencyId}</span>
                  <span className="text-xs text-cb-text-secondary ml-2">
                    {h.currencyName}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{formatUsd(h.valueUsd)}</div>
                <div className="text-xs text-cb-text-secondary">
                  {parseFloat(h.allocation).toFixed(1)}%
                </div>
              </div>
            </div>
          ))}
        </div>

        {nonZeroHoldings.length === 0 && (
          <p className="text-cb-text-secondary text-sm text-center py-4">
            No holdings yet. Deposit funds to get started.
          </p>
        )}
      </div>
    </div>
  );
}
