import crypto from 'crypto';

/**
 * Generate a random string with prefix
 */
export function generateId(prefix: string = ''): string {
  const id = crypto.randomBytes(16).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Generate API key
 */
export function generateApiKey(type: string = 'sk_test'): string {
  const key = crypto.randomBytes(24).toString('base64url');
  return `${type}_${key}`;
}

/**
 * Hash API key for storage
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate webhook secret
 */
export function generateWebhookSecret(): string {
  const secret = crypto.randomBytes(24).toString('base64url');
  return `whsec_${secret}`;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate currency code
 */
export function isValidCurrency(currency: string): boolean {
  const validCurrencies = ['usd', 'eur', 'gbp', 'cad', 'aud', 'jpy'];
  return validCurrencies.includes(currency.toLowerCase());
}

/**
 * Format amount for display (cents to dollars)
 */
export function formatAmount(cents: number, currency: string = 'usd'): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

/**
 * Parse amount from string to cents
 */
export function parseAmount(amountString: string): number | null {
  const amount = parseFloat(amountString);
  if (isNaN(amount)) return null;
  return Math.round(amount * 100);
}

/**
 * Mask card number for display
 */
export function maskCardNumber(cardNumber: string): string {
  const cleaned = cardNumber.replace(/\s/g, '');
  const last4 = cleaned.slice(-4);
  return `****${last4}`;
}

/**
 * Generate a simulated card token
 */
export function generateCardToken(cardNumber: string): string {
  const last4 = cardNumber.slice(-4);
  const token = crypto.randomBytes(12).toString('hex');
  return `tok_${token}${last4}`;
}

/**
 * Validate Luhn algorithm for card numbers
 */
export function isValidCardNumber(cardNumber: string): boolean {
  const cleaned = cardNumber.replace(/\s/g, '');

  if (!/^\d{13,19}$/.test(cleaned)) return false;

  let sum = 0;
  let isEven = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned.charAt(i), 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Delay helper for async operations
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safe JSON parse
 */
export function safeJsonParse<T = unknown>(str: string, defaultValue: T | null = null): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return defaultValue;
  }
}
