import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useCallback } from 'react';
import { useMarketStore } from '../stores/marketStore';
import { useAuthStore } from '../stores/authStore';
import { PriceChart } from '../components/PriceChart';
import { OrderBook } from '../components/OrderBook';
import { TradeForm } from '../components/TradeForm';
import { formatPrice, formatPercent, formatCompact, getPriceColorClass } from '../utils/format';

function TradePage() {
  const { symbol } = Route.useParams();
  const prices = useMarketStore((s) => s.prices);
  const pairs = useMarketStore((s) => s.pairs);
  const candles = useMarketStore((s) => s.candles);
  const orderBook = useMarketStore((s) => s.orderBook);
  const fetchPairs = useMarketStore((s) => s.fetchPairs);
  const fetchCandles = useMarketStore((s) => s.fetchCandles);
  const fetchOrderBook = useMarketStore((s) => s.fetchOrderBook);
  const user = useAuthStore((s) => s.user);
  const [interval, setInterval_] = useState('1m');

  const pair = pairs.find((p) => p.symbol === symbol);
  const priceData = prices[symbol];

  const refreshData = useCallback(() => {
    fetchCandles(symbol, interval);
    fetchOrderBook(symbol);
  }, [symbol, interval, fetchCandles, fetchOrderBook]);

  useEffect(() => {
    if (pairs.length === 0) fetchPairs();
    refreshData();

    const timer = setInterval(() => {
      fetchOrderBook(symbol);
    }, 5000);

    return () => clearInterval(timer);
  }, [symbol, interval, pairs.length, fetchPairs, refreshData, fetchOrderBook]);

  const currentPrice = priceData?.price ?? pair?.price ?? 0;
  const pricePrecision = pair?.pricePrecision ?? 2;

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      {/* Header bar */}
      <div className="flex items-center gap-6 mb-4 pb-4 border-b border-cb-border">
        <div>
          <h1 className="text-xl font-bold">{symbol}</h1>
          <p className="text-cb-text-secondary text-sm">
            {pair?.baseCurrency}/{pair?.quoteCurrency}
          </p>
        </div>

        <div className="flex-1" />

        <div className="text-right">
          <div className="text-2xl font-bold">{formatPrice(currentPrice, pricePrecision)}</div>
          {priceData && (
            <div className={`text-sm ${getPriceColorClass(priceData.changePercent24h)}`}>
              {formatPercent(priceData.changePercent24h)}
            </div>
          )}
        </div>

        <div className="hidden md:flex gap-8 text-sm">
          <div>
            <span className="text-cb-text-secondary">24h High</span>
            <div>{priceData ? formatPrice(priceData.high24h, pricePrecision) : '--'}</div>
          </div>
          <div>
            <span className="text-cb-text-secondary">24h Low</span>
            <div>{priceData ? formatPrice(priceData.low24h, pricePrecision) : '--'}</div>
          </div>
          <div>
            <span className="text-cb-text-secondary">24h Volume</span>
            <div>{priceData ? `$${formatCompact(priceData.volume24h)}` : '--'}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Chart */}
        <div className="lg:col-span-8">
          <div className="bg-cb-card rounded-xl border border-cb-border p-4">
            <div className="flex items-center gap-2 mb-4">
              {['1m', '5m', '15m', '1h', '1d'].map((iv) => (
                <button
                  key={iv}
                  onClick={() => {
                    setInterval_(iv);
                    fetchCandles(symbol, iv);
                  }}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    interval === iv
                      ? 'bg-cb-primary text-white'
                      : 'text-cb-text-secondary hover:text-cb-text hover:bg-cb-surface'
                  }`}
                >
                  {iv.toUpperCase()}
                </button>
              ))}
            </div>
            <PriceChart candles={candles} symbol={symbol} />
          </div>
        </div>

        {/* Order Book + Trade Form */}
        <div className="lg:col-span-4 space-y-4">
          {/* Order Book */}
          <div className="bg-cb-card rounded-xl border border-cb-border p-4">
            <h2 className="text-sm font-semibold text-cb-text-secondary mb-3">Order Book</h2>
            <OrderBook
              bids={orderBook?.bids ?? []}
              asks={orderBook?.asks ?? []}
              spread={orderBook?.spread ?? null}
              pricePrecision={pricePrecision}
            />
          </div>

          {/* Trade Form */}
          {user && pair && (
            <div className="bg-cb-card rounded-xl border border-cb-border p-4">
              <TradeForm
                pair={pair}
                currentPrice={currentPrice}
              />
            </div>
          )}

          {!user && (
            <div className="bg-cb-card rounded-xl border border-cb-border p-6 text-center">
              <p className="text-cb-text-secondary mb-4">Sign in to start trading</p>
              <a
                href="/login"
                className="inline-block bg-cb-primary hover:bg-cb-primary-hover text-white font-semibold px-6 py-2 rounded-lg transition-colors"
              >
                Sign In
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/trade/$symbol')({
  component: TradePage,
});
