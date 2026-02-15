import type { TradingPair } from '../types';
import { formatPrice, formatPercent, formatCompact, getPriceColorClass, getCurrencyColor } from '../utils/format';
import { MiniSparkline } from './MiniSparkline';

interface AssetRowProps {
  pair: TradingPair;
  index: number;
}

export function AssetRow({ pair, index }: AssetRowProps) {
  const changeColor = getPriceColorClass(pair.changePercent24h);
  const sparklineColor = pair.changePercent24h >= 0 ? '#00C087' : '#FF3B30';
  const currencyColor = getCurrencyColor(pair.baseCurrency);

  return (
    <a
      href={`/trade/${pair.symbol}`}
      className="grid grid-cols-12 gap-4 px-4 py-4 border-b border-cb-border last:border-b-0 hover:bg-cb-surface/50 transition-colors items-center"
    >
      {/* Name */}
      <div className="col-span-3 flex items-center gap-3">
        <span className="text-cb-text-secondary text-sm w-6">{index + 1}</span>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
          style={{ backgroundColor: currencyColor }}
        >
          {pair.baseCurrency.slice(0, 2)}
        </div>
        <div>
          <div className="font-medium text-sm">{pair.baseCurrency}</div>
          <div className="text-xs text-cb-text-secondary">{pair.symbol}</div>
        </div>
      </div>

      {/* Price */}
      <div className="col-span-2 text-right">
        <span className="font-medium">${formatPrice(pair.price, pair.pricePrecision)}</span>
      </div>

      {/* 24h Change */}
      <div className="col-span-2 text-right">
        <span className={`font-medium ${changeColor}`}>
          {formatPercent(pair.changePercent24h)}
        </span>
      </div>

      {/* Volume */}
      <div className="col-span-2 text-right hidden md:block">
        <span className="text-cb-text-secondary">${formatCompact(pair.volume24h)}</span>
      </div>

      {/* Mini chart */}
      <div className="col-span-2 hidden md:flex justify-end">
        <MiniSparkline
          data={generateMiniData(pair.price, pair.changePercent24h)}
          color={sparklineColor}
          width={100}
          height={32}
        />
      </div>

      {/* Trade button */}
      <div className="col-span-1 text-right">
        <span className="inline-block bg-cb-primary/10 text-cb-primary text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-cb-primary/20 transition-colors">
          Trade
        </span>
      </div>
    </a>
  );
}

// Generate fake sparkline data based on current price and change direction
function generateMiniData(currentPrice: number, changePercent: number): number[] {
  const points = 20;
  const data: number[] = [];
  const startPrice = currentPrice / (1 + changePercent / 100);
  const step = (currentPrice - startPrice) / points;

  for (let i = 0; i < points; i++) {
    const noise = (Math.random() - 0.5) * currentPrice * 0.005;
    data.push(startPrice + step * i + noise);
  }
  data.push(currentPrice);
  return data;
}
