import type { TradingPair } from '../types';
import { AssetRow } from './AssetRow';

interface AssetListProps {
  pairs: TradingPair[];
}

/** Renders a table of trading pairs with price, change, volume, and sparkline columns. */
export function AssetList({ pairs }: AssetListProps) {
  return (
    <div className="bg-cb-card rounded-xl border border-cb-border overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-cb-border text-xs text-cb-text-secondary font-medium uppercase tracking-wider">
        <div className="col-span-3">Name</div>
        <div className="col-span-2 text-right">Price</div>
        <div className="col-span-2 text-right">24h Change</div>
        <div className="col-span-2 text-right hidden md:block">24h Volume</div>
        <div className="col-span-2 text-right hidden md:block">Market Chart</div>
        <div className="col-span-1 text-right">Trade</div>
      </div>

      {/* Rows */}
      {pairs.map((pair, index) => (
        <AssetRow key={pair.id} pair={pair} index={index} />
      ))}
    </div>
  );
}
