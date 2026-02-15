interface StatusBadgeProps {
  status: string;
}

/** Renders a color-coded status badge for transaction or request states. */
export function StatusBadge({ status }: StatusBadgeProps) {
  const getStyle = () => {
    switch (status) {
      case 'completed':
      case 'paid':
        return 'bg-green-50 text-paypal-success';
      case 'pending':
        return 'bg-yellow-50 text-paypal-warning';
      case 'failed':
      case 'declined':
        return 'bg-red-50 text-paypal-danger';
      case 'cancelled':
        return 'bg-gray-50 text-paypal-secondary';
      default:
        return 'bg-gray-50 text-paypal-secondary';
    }
  };

  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getStyle()}`}>
      {status}
    </span>
  );
}
