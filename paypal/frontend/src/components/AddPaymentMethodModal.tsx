import { useState } from 'react';
import { paymentMethodsApi } from '../services/api';

interface AddPaymentMethodModalProps {
  onClose: () => void;
  onAdded: () => void;
}

/** Modal form for adding a bank account or card payment method with default toggle. */
export function AddPaymentMethodModal({ onClose, onAdded }: AddPaymentMethodModalProps) {
  const [type, setType] = useState<'bank' | 'card'>('bank');
  const [label, setLabel] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await paymentMethodsApi.add(type, label, lastFour || undefined, isDefault);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add payment method');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-paypal-text">Add Payment Method</h2>
          <button onClick={onClose} className="text-paypal-secondary hover:text-paypal-text text-xl">
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-paypal-text mb-2">Type</label>
            <div className="flex space-x-4">
              <label className={`flex-1 p-3 border rounded-lg cursor-pointer text-center ${
                type === 'bank' ? 'border-paypal-primary bg-paypal-primary/5' : 'border-paypal-border'
              }`}>
                <input
                  type="radio"
                  name="type"
                  value="bank"
                  checked={type === 'bank'}
                  onChange={() => setType('bank')}
                  className="sr-only"
                />
                <div className="text-2xl mb-1">🏦</div>
                <div className="text-sm font-medium">Bank Account</div>
              </label>
              <label className={`flex-1 p-3 border rounded-lg cursor-pointer text-center ${
                type === 'card' ? 'border-paypal-primary bg-paypal-primary/5' : 'border-paypal-border'
              }`}>
                <input
                  type="radio"
                  name="type"
                  value="card"
                  checked={type === 'card'}
                  onChange={() => setType('card')}
                  className="sr-only"
                />
                <div className="text-2xl mb-1">💳</div>
                <div className="text-sm font-medium">Card</div>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-paypal-text mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 border border-paypal-border rounded-lg focus:outline-none focus:ring-2 focus:ring-paypal-primary"
              placeholder={type === 'bank' ? 'e.g., Chase Checking' : 'e.g., Visa ending 4242'}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-paypal-text mb-1">
              Last 4 digits <span className="text-paypal-secondary font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={lastFour}
              onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full px-3 py-2 border border-paypal-border rounded-lg focus:outline-none focus:ring-2 focus:ring-paypal-primary"
              placeholder="1234"
              maxLength={4}
            />
          </div>

          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-paypal-border text-paypal-primary focus:ring-paypal-primary"
            />
            <span className="text-sm text-paypal-text">Set as default payment method</span>
          </label>

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-paypal-border text-paypal-text rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !label}
              className="flex-1 py-2 bg-paypal-primary text-white rounded-lg hover:bg-paypal-hover disabled:opacity-50"
            >
              {submitting ? 'Adding...' : 'Add Method'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
