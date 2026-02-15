import { useMarketStore } from '../stores/marketStore';
import { formatPrice, formatPercent, getPriceColorClass } from '../utils/format';

export function PriceTicker() {
  const pairs = useMarketStore((s) => s.pairs);

  const topPairs = pairs.slice(0, 6);

  if (topPairs.length === 0) return null;

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
      {topPairs.map((pair) => (
        <a
          key={pair.symbol}
          href={`/trade/${pair.symbol}`}
          className="flex-shrink-0 bg-cb-card rounded-xl border border-cb-border p-4 min-w-[180px] hover:border-cb-primary/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">{pair.symbol}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
              pair.changePercent24h >= 0
                ? 'bg-cb-green/10 text-cb-green'
                : 'bg-cb-red/10 text-cb-red'
            }`}>
              {formatPercent(pair.changePercent24h)}
            </span>
          </div>
          <div className="text-lg font-bold">
            ${formatPrice(pair.price, pair.pricePrecision)}
          </div>
          <div className={`text-xs mt-1 ${getPriceColorClass(pair.change24h)}`}>
            {pair.change24h >= 0 ? '+' : ''}
            {formatPrice(pair.change24h, pair.pricePrecision)}
          </div>
        </a>
      ))}
    </div>
  );
}
