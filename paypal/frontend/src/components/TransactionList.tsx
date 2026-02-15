import type { Transaction } from '../types';
import { TransactionItem } from './TransactionItem';

interface TransactionListProps {
  transactions: Transaction[];
  currentUserId: string;
  loading: boolean;
  showDate?: boolean;
}

/** Renders a list of transactions with loading and empty state handling. */
export function TransactionList({ transactions, currentUserId, loading, showDate }: TransactionListProps) {
  if (loading) {
    return (
      <div className="py-8 text-center text-paypal-secondary">Loading transactions...</div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="py-8 text-center text-paypal-secondary">No transactions yet.</div>
    );
  }

  return (
    <div className="divide-y divide-paypal-border">
      {transactions.map((tx) => (
        <TransactionItem
          key={tx.id}
          transaction={tx}
          currentUserId={currentUserId}
          showDate={showDate}
        />
      ))}
    </div>
  );
}
