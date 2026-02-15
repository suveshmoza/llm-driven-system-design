import type { Wallet } from '../types';

interface WalletCardProps {
  wallet: Wallet | null;
  loading: boolean;
  onRefresh: () => void;
}

/** Displays the PayPal wallet balance with a gradient card and refresh button. */
export function WalletCard({ wallet, loading, onRefresh }: WalletCardProps) {
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  return (
    <div className="bg-gradient-to-r from-paypal-sidebar to-paypal-primary rounded-xl shadow-lg p-6 text-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-white/80">PayPal Balance</span>
        <button
          onClick={onRefresh}
          className="text-xs text-white/60 hover:text-white/90 transition-colors"
        >
          Refresh
        </button>
      </div>
      <div className="text-3xl font-bold mb-4">
        {loading ? (
          <span className="animate-pulse">---.--</span>
        ) : (
          formatCurrency(wallet?.balanceCents || 0)
        )}
      </div>
      <div className="text-sm text-white/70">
        {wallet?.currency || 'USD'} available
      </div>
    </div>
  );
}
