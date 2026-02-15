/**
 * Format a price with appropriate precision
 */
export function formatPrice(price: number, precision: number = 2): string {
  if (price === 0) return '0.00';

  if (price >= 1) {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  // For small prices, show more decimals
  if (price < 0.01) {
    return price.toFixed(8);
  }

  return price.toFixed(Math.max(precision, 4));
}

/**
 * Format USD amount
 */
export function formatUsd(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format a large number with compact notation
 */
export function formatCompact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

/**
 * Format percentage change
 */
export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format crypto quantity
 */
export function formatQuantity(quantity: number | string, precision: number = 8): string {
  const num = typeof quantity === 'string' ? parseFloat(quantity) : quantity;
  if (isNaN(num)) return '0';
  if (num === 0) return '0';

  // Remove trailing zeros
  return parseFloat(num.toFixed(precision)).toString();
}

/**
 * Format a date string
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a relative time
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Get color class based on price change
 */
export function getPriceColorClass(change: number): string {
  if (change > 0) return 'text-cb-green';
  if (change < 0) return 'text-cb-red';
  return 'text-cb-text-secondary';
}

/**
 * Get background color class based on price change
 */
export function getPriceBgClass(change: number): string {
  if (change > 0) return 'bg-cb-green/10 text-cb-green';
  if (change < 0) return 'bg-cb-red/10 text-cb-red';
  return 'bg-cb-surface text-cb-text-secondary';
}

/**
 * Crypto currency icons (emoji representation)
 */
export function getCurrencyIcon(currencyId: string): string {
  const icons: Record<string, string> = {
    BTC: '₿',
    ETH: 'Ξ',
    SOL: 'S',
    DOGE: 'D',
    ADA: 'A',
    DOT: 'D',
    AVAX: 'A',
    LINK: 'L',
    MATIC: 'M',
    XRP: 'X',
    USD: '$',
    USDT: 'T',
    USDC: 'C',
  };
  return icons[currencyId] || currencyId.charAt(0);
}

/**
 * Get a color for each currency (for charts)
 */
export function getCurrencyColor(currencyId: string): string {
  const colors: Record<string, string> = {
    BTC: '#F7931A',
    ETH: '#627EEA',
    SOL: '#9945FF',
    DOGE: '#C3A634',
    ADA: '#0033AD',
    DOT: '#E6007A',
    AVAX: '#E84142',
    LINK: '#2A5ADA',
    MATIC: '#8247E5',
    XRP: '#23292F',
    USD: '#85BB65',
    USDT: '#26A17B',
    USDC: '#2775CA',
  };
  return colors[currencyId] || '#8A919E';
}
