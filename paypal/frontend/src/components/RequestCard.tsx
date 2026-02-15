import { useState } from 'react';
import type { TransferRequest } from '../types';
import { requestsApi } from '../services/api';

interface RequestCardProps {
  request: TransferRequest;
  currentUserId: string;
  onAction: () => void;
}

/** Displays a pending transfer request with pay/decline actions for the payer or cancel for the requester. */
export function RequestCard({ request, currentUserId, onAction }: RequestCardProps) {
  const [loading, setLoading] = useState(false);

  const isPayer = request.payerId === currentUserId;

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const handlePay = async () => {
    setLoading(true);
    try {
      await requestsApi.pay(request.id);
      onAction();
    } catch {
      // handle error
    }
    setLoading(false);
  };

  const handleDecline = async () => {
    setLoading(true);
    try {
      await requestsApi.decline(request.id);
      onAction();
    } catch {
      // handle error
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-between p-4 bg-paypal-bg rounded-lg">
      <div>
        <div className="font-medium text-paypal-text text-sm">
          {isPayer
            ? `${request.requesterDisplayName || request.requesterUsername} requested`
            : `You requested from ${request.payerDisplayName || request.payerUsername}`
          }
        </div>
        <div className="text-lg font-bold text-paypal-text">
          {formatCurrency(request.amountCents)}
        </div>
        {request.note && (
          <div className="text-xs text-paypal-secondary mt-1">{request.note}</div>
        )}
      </div>

      {request.status === 'pending' && isPayer && (
        <div className="flex space-x-2">
          <button
            onClick={handlePay}
            disabled={loading}
            className="px-4 py-1.5 bg-paypal-primary text-white rounded-lg hover:bg-paypal-hover text-sm font-medium disabled:opacity-50"
          >
            Pay
          </button>
          <button
            onClick={handleDecline}
            disabled={loading}
            className="px-4 py-1.5 border border-paypal-border text-paypal-text rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}

      {request.status === 'pending' && !isPayer && (
        <button
          onClick={handleDecline}
          disabled={loading}
          className="px-4 py-1.5 border border-paypal-border text-paypal-secondary rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
