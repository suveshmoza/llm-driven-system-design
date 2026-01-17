/**
 * Card Display Component
 *
 * Visual representation of a payment card with brand icon and masked details.
 * Used throughout the dashboard to display stored payment methods and
 * payment method details on charges.
 *
 * @module components/CardDisplay
 */

/**
 * Props for the CardDisplay component.
 */
interface CardDisplayProps {
  /** Card brand identifier (e.g., 'visa', 'mastercard', 'amex') */
  brand: string;
  /** Last 4 digits of the card number */
  last4: string;
  /** Card expiration month (1-12), optional */
  expMonth?: number;
  /** Card expiration year (4 digits), optional */
  expYear?: number;
}

/**
 * Payment card display component.
 * Shows a colored brand icon, masked card number, and optional expiration date.
 * Card numbers are displayed as "****XXXX" for security.
 *
 * @param props - Component props
 * @param props.brand - The card brand for icon display
 * @param props.last4 - Last 4 digits of the card
 * @param props.expMonth - Optional expiration month
 * @param props.expYear - Optional expiration year
 * @returns A card display element with brand icon and details
 *
 * @example
 * <CardDisplay brand="visa" last4="4242" expMonth={12} expYear={2025} />
 */
export function CardDisplay({ brand, last4, expMonth, expYear }: CardDisplayProps) {
  return (
    <div className="flex items-center gap-2">
      <CardBrandIcon brand={brand} />
      <span className="font-mono">****{last4}</span>
      {expMonth && expYear && (
        <span className="text-stripe-gray-500 text-sm">
          {String(expMonth).padStart(2, '0')}/{String(expYear).slice(-2)}
        </span>
      )}
    </div>
  );
}

/**
 * Card brand icon component.
 * Displays a colored badge with abbreviated brand name.
 *
 * @param props - Component props
 * @param props.brand - The card brand identifier
 * @returns A colored icon element for the card brand
 */
function CardBrandIcon({ brand }: { brand: string }) {
  /** Color mapping for card brands */
  const colors: Record<string, string> = {
    visa: 'bg-blue-600',
    mastercard: 'bg-orange-500',
    amex: 'bg-blue-800',
    discover: 'bg-orange-400',
    unknown: 'bg-gray-400',
  };

  const bgColor = colors[brand] || colors.unknown;

  return (
    <div className={`w-8 h-5 ${bgColor} rounded text-white text-xs flex items-center justify-center font-bold`}>
      {brand === 'visa' ? 'V' : brand === 'mastercard' ? 'MC' : brand === 'amex' ? 'AX' : '?'}
    </div>
  );
}
