import type { PaymentMethod } from '../types';

interface PaymentMethodCardProps {
  method: PaymentMethod;
  onRemove: (id: string) => void;
  onSetDefault: (id: string) => void;
}

/** Displays a payment method with type icon, label, and actions to remove or set as default. */
export function PaymentMethodCard({ method, onRemove, onSetDefault }: PaymentMethodCardProps) {
  const getIcon = () => {
    if (method.type === 'bank') return '🏦';
    return '💳';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-paypal-border p-5 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="w-12 h-12 rounded-lg bg-paypal-bg flex items-center justify-center text-2xl">
          {getIcon()}
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-medium text-paypal-text">{method.label}</span>
            {method.isDefault && (
              <span className="px-2 py-0.5 bg-paypal-primary/10 text-paypal-primary text-xs rounded-full font-medium">
                Default
              </span>
            )}
          </div>
          <div className="text-sm text-paypal-secondary">
            {method.type === 'bank' ? 'Bank account' : 'Card'}{' '}
            {method.lastFour && `ending in ${method.lastFour}`}
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        {!method.isDefault && (
          <button
            onClick={() => onSetDefault(method.id)}
            className="text-sm text-paypal-primary hover:underline"
          >
            Set Default
          </button>
        )}
        <button
          onClick={() => onRemove(method.id)}
          className="text-sm text-paypal-danger hover:underline"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
