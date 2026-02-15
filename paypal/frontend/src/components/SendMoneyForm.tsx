import { useState } from 'react';
import { transfersApi } from '../services/api';
import { UserSearch } from './UserSearch';
import type { User } from '../types';

interface SendMoneyFormProps {
  onSuccess: () => void;
}

/** Form for sending money to another user with recipient search, amount, note, and idempotency key generation. */
export function SendMoneyForm({ onSuccess }: SendMoneyFormProps) {
  const [recipient, setRecipient] = useState<User | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!recipient) {
      setError('Please select a recipient');
      return;
    }

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setSubmitting(true);
    try {
      // Generate idempotency key
      const idempotencyKey = `send-${recipient.id}-${amountCents}-${Date.now()}`;
      await transfersApi.send(recipient.id, amountCents, note || undefined, idempotencyKey);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    }
    setSubmitting(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-paypal-border p-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-paypal-text mb-2">Send to</label>
          <UserSearch onSelect={setRecipient} selected={recipient} />
        </div>

        <div>
          <label className="block text-sm font-medium text-paypal-text mb-2">Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-paypal-secondary text-lg">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="amount-input w-full pl-8 pr-4 py-3 border border-paypal-border rounded-lg focus:outline-none focus:ring-2 focus:ring-paypal-primary text-2xl font-semibold text-center"
              placeholder="0.00"
              step="0.01"
              min="0.01"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-paypal-text mb-2">
            Note <span className="text-paypal-secondary font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 border border-paypal-border rounded-lg focus:outline-none focus:ring-2 focus:ring-paypal-primary"
            placeholder="What's it for?"
            maxLength={200}
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !recipient || !amount}
          className="w-full py-3 bg-paypal-primary text-white rounded-lg hover:bg-paypal-hover font-medium disabled:opacity-50 text-lg"
        >
          {submitting ? 'Sending...' : `Send ${amount ? `$${parseFloat(amount).toFixed(2)}` : 'Money'}`}
        </button>
      </form>
    </div>
  );
}
