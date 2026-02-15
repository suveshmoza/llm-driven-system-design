import type { Transaction } from '../types';
import { StatusBadge } from './StatusBadge';

interface TransactionItemProps {
  transaction: Transaction;
  currentUserId: string;
  showDate?: boolean;
}

/** Renders a single transaction row with direction icon, label, amount, and status badge. */
export function TransactionItem({ transaction, currentUserId, showDate }: TransactionItemProps) {
  const isSender = transaction.senderId === currentUserId;
  const isDeposit = transaction.type === 'deposit';
  const isWithdrawal = transaction.type === 'withdrawal';

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (showDate) {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getLabel = () => {
    if (isDeposit) return 'Deposit';
    if (isWithdrawal) return 'Withdrawal';
    if (isSender) {
      return `To ${transaction.recipientDisplayName || transaction.recipientUsername || 'Unknown'}`;
    }
    return `From ${transaction.senderDisplayName || transaction.senderUsername || 'Unknown'}`;
  };

  const getAmountColor = () => {
    if (isDeposit || (!isSender && transaction.type === 'transfer')) return 'text-paypal-success';
    return 'text-paypal-danger';
  };

  const getAmountPrefix = () => {
    if (isDeposit || (!isSender && transaction.type === 'transfer')) return '+';
    return '-';
  };

  const getIcon = () => {
    if (isDeposit) return '↓';
    if (isWithdrawal) return '↑';
    if (isSender) return '→';
    return '←';
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center space-x-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
          isDeposit || (!isSender && transaction.type === 'transfer')
            ? 'bg-green-50 text-paypal-success'
            : 'bg-red-50 text-paypal-danger'
        }`}>
          {getIcon()}
        </div>
        <div>
          <div className="font-medium text-paypal-text text-sm">{getLabel()}</div>
          <div className="text-xs text-paypal-secondary">
            {formatDate(transaction.createdAt)}
            {transaction.note && ` - ${transaction.note}`}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={`font-semibold text-sm ${getAmountColor()}`}>
          {getAmountPrefix()}{formatCurrency(transaction.amountCents)}
        </div>
        <StatusBadge status={transaction.status} />
      </div>
    </div>
  );
}
