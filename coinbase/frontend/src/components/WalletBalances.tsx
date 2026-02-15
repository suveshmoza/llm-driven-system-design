import { formatUsd, formatQuantity, getCurrencyColor, getCurrencyIcon } from '../utils/format';

interface WalletBalance {
  currencyId: string;
  balance: string;
  reservedBalance: string;
  available: string;
  valueUsd: string;
}

interface WalletBalancesProps {
  wallets: WalletBalance[];
}

export function WalletBalances({ wallets }: WalletBalancesProps) {
  const nonZeroWallets = wallets.filter((w) => parseFloat(w.balance) > 0);

  return (
    <div className="bg-cb-card rounded-xl border border-cb-border">
      <div className="p-4 border-b border-cb-border">
        <h2 className="text-sm font-semibold text-cb-text-secondary">Wallet Balances</h2>
      </div>

      {nonZeroWallets.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-cb-text-secondary text-sm">No balances</p>
        </div>
      ) : (
        <div className="divide-y divide-cb-border">
          {nonZeroWallets.map((wallet) => (
            <div key={wallet.currencyId} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
                  style={{ backgroundColor: getCurrencyColor(wallet.currencyId) }}
                >
                  {getCurrencyIcon(wallet.currencyId)}
                </div>
                <div>
                  <div className="text-sm font-medium">{wallet.currencyId}</div>
                  <div className="text-xs text-cb-text-secondary">
                    Available: {formatQuantity(wallet.available)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">
                  {formatQuantity(wallet.balance)}
                </div>
                <div className="text-xs text-cb-text-secondary">
                  {formatUsd(wallet.valueUsd)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
