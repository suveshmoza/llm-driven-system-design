import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { PortfolioSummary } from '../components/PortfolioSummary';
import { WalletBalances } from '../components/WalletBalances';

function PortfolioPage() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();

  const totalValueUsd = usePortfolioStore((s) => s.totalValueUsd);
  const holdings = usePortfolioStore((s) => s.holdings);
  const wallets = usePortfolioStore((s) => s.wallets);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);
  const fetchWallets = usePortfolioStore((s) => s.fetchWallets);
  const portfolioLoading = usePortfolioStore((s) => s.isLoading);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchPortfolio();
      fetchWallets();
    }
  }, [user, fetchPortfolio, fetchWallets]);

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cb-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Portfolio</h1>

      {portfolioLoading && holdings.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cb-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <PortfolioSummary
              totalValueUsd={totalValueUsd}
              holdings={holdings}
            />
          </div>
          <div>
            <WalletBalances wallets={wallets} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Route definition for the portfolio page with holdings and wallet balances. */
export const Route = createFileRoute('/portfolio')({
  component: PortfolioPage,
});
