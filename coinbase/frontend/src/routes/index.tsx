import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMarketStore } from '../stores/marketStore';
import { AssetList } from '../components/AssetList';
import { PriceTicker } from '../components/PriceTicker';

function IndexPage() {
  const fetchPairs = useMarketStore((s) => s.fetchPairs);
  const pairs = useMarketStore((s) => s.pairs);
  const isLoading = useMarketStore((s) => s.isLoading);

  useEffect(() => {
    fetchPairs();
    const interval = setInterval(fetchPairs, 10000);
    return () => clearInterval(interval);
  }, [fetchPairs]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <PriceTicker />

      <div className="mt-8">
        <h1 className="text-2xl font-bold text-cb-text mb-2">Markets</h1>
        <p className="text-cb-text-secondary mb-6">
          Trade crypto with confidence on our exchange
        </p>

        {isLoading && pairs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cb-primary" />
          </div>
        ) : (
          <AssetList pairs={pairs} />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: IndexPage,
});
