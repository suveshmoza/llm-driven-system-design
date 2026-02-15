import { useMemo } from 'react';
import { formatPrice } from '../utils/format';

interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

interface OrderBookProps {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number | null;
  pricePrecision: number;
}

export function OrderBook({ bids, asks, spread, pricePrecision }: OrderBookProps) {
  // Calculate max quantity for bar width
  const maxQuantity = useMemo(() => {
    const allQuantities = [...bids.map((b) => b.quantity), ...asks.map((a) => a.quantity)];
    return Math.max(...allQuantities, 1);
  }, [bids, asks]);

  // Reverse asks so lowest price is at bottom (closest to spread)
  const displayAsks = [...asks].slice(0, 10).reverse();
  const displayBids = bids.slice(0, 10);

  return (
    <div className="text-xs font-mono">
      {/* Header */}
      <div className="grid grid-cols-3 text-cb-text-secondary mb-2 px-1">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (sell side) - red */}
      <div className="space-y-px mb-1">
        {displayAsks.length > 0 ? (
          displayAsks.map((level, i) => {
            const barWidth = (level.quantity / maxQuantity) * 100;
            const cumulative = displayAsks
              .slice(i)
              .reduce((sum, l) => sum + l.quantity * l.price, 0);

            return (
              <div
                key={`ask-${level.price}`}
                className="relative grid grid-cols-3 py-0.5 px-1 hover:bg-cb-surface/50 cursor-pointer"
              >
                {/* Background bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-cb-red/10"
                  style={{ width: `${barWidth}%` }}
                />
                <span className="text-cb-red relative z-10">
                  {formatPrice(level.price, pricePrecision)}
                </span>
                <span className="text-right relative z-10">
                  {level.quantity.toFixed(4)}
                </span>
                <span className="text-right text-cb-text-secondary relative z-10">
                  {formatPrice(cumulative, 2)}
                </span>
              </div>
            );
          })
        ) : (
          <div className="text-center text-cb-text-secondary py-2">No asks</div>
        )}
      </div>

      {/* Spread */}
      <div className="border-y border-cb-border py-1.5 px-1 my-1">
        <div className="flex justify-between items-center">
          <span className="text-cb-text-secondary">Spread</span>
          <span className="text-cb-text">
            {spread !== null ? formatPrice(spread, pricePrecision) : '--'}
          </span>
        </div>
      </div>

      {/* Bids (buy side) - green */}
      <div className="space-y-px mt-1">
        {displayBids.length > 0 ? (
          displayBids.map((level, i) => {
            const barWidth = (level.quantity / maxQuantity) * 100;
            const cumulative = displayBids
              .slice(0, i + 1)
              .reduce((sum, l) => sum + l.quantity * l.price, 0);

            return (
              <div
                key={`bid-${level.price}`}
                className="relative grid grid-cols-3 py-0.5 px-1 hover:bg-cb-surface/50 cursor-pointer"
              >
                {/* Background bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-cb-green/10"
                  style={{ width: `${barWidth}%` }}
                />
                <span className="text-cb-green relative z-10">
                  {formatPrice(level.price, pricePrecision)}
                </span>
                <span className="text-right relative z-10">
                  {level.quantity.toFixed(4)}
                </span>
                <span className="text-right text-cb-text-secondary relative z-10">
                  {formatPrice(cumulative, 2)}
                </span>
              </div>
            );
          })
        ) : (
          <div className="text-center text-cb-text-secondary py-2">No bids</div>
        )}
      </div>
    </div>
  );
}
