import type { PaymentMethod } from '../types/index.js';

/**
 * Input data used for fraud risk evaluation.
 */
interface FraudEvaluationInput {
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  merchantId: string;
  customerEmail?: string;
  ipAddress?: string;
}

/**
 * Rule-based fraud detection service for payment risk assessment.
 * Evaluates transactions against configurable rules for amount, payment method,
 * email patterns, and transaction velocity. In production, this would integrate
 * with machine learning models and external fraud prevention services.
 */
export class FraudService {
  /** Score threshold at or above which transactions are automatically blocked */
  private blockThreshold = parseInt(process.env.FRAUD_BLOCK_THRESHOLD || '90', 10);
  /** Score threshold at or above which transactions require manual review */
  private reviewThreshold = parseInt(process.env.FRAUD_REVIEW_THRESHOLD || '70', 10);

  /**
   * Evaluates a transaction and returns a risk score from 0-100.
   * Combines multiple rule-based checks for comprehensive risk assessment.
   * Higher scores indicate higher fraud risk.
   * @param input - Transaction details for evaluation
   * @returns Risk score from 0 (low risk) to 100 (high risk)
   */
  async evaluate(input: FraudEvaluationInput): Promise<number> {
    let score = 0;

    // Amount-based rules
    score += this.evaluateAmount(input.amount);

    // Payment method rules
    score += this.evaluatePaymentMethod(input.payment_method);

    // Email-based rules
    if (input.customerEmail) {
      score += this.evaluateEmail(input.customerEmail);
    }

    // Velocity checks (simplified - in production would check Redis/DB)
    score += await this.evaluateVelocity(input.merchantId, input.customerEmail);

    // Cap at 100
    return Math.min(score, 100);
  }

  /**
   * Determines if a risk score warrants automatic transaction blocking.
   * @param score - Risk score from 0-100
   * @returns True if score meets or exceeds block threshold
   */
  shouldBlock(score: number): boolean {
    return score >= this.blockThreshold;
  }

  /**
   * Determines if a risk score requires manual review before processing.
   * @param score - Risk score from 0-100
   * @returns True if score is in review range (between review and block thresholds)
   */
  requiresReview(score: number): boolean {
    return score >= this.reviewThreshold && score < this.blockThreshold;
  }

  /**
   * Evaluates risk based on transaction amount.
   * Very small amounts may indicate card testing; large amounts increase risk.
   * @param amount - Transaction amount in cents
   * @returns Risk score contribution (0-30)
   */
  private evaluateAmount(amount: number): number {
    // Amount in cents
    if (amount > 1000000) {
      // Over $10,000
      return 30;
    } else if (amount > 500000) {
      // Over $5,000
      return 20;
    } else if (amount > 100000) {
      // Over $1,000
      return 10;
    } else if (amount < 100) {
      // Under $1 - could be card testing
      return 15;
    }
    return 0;
  }

  /**
   * Evaluates risk based on payment method characteristics.
   * Checks for test card numbers, prepaid cards, and expiring cards.
   * @param method - Payment method details
   * @returns Risk score contribution (0-35)
   */
  private evaluatePaymentMethod(method: PaymentMethod): number {
    let score = 0;

    // Test card numbers
    if (method.last_four === '4242' || method.last_four === '0000') {
      score += 10;
    }

    // Certain card brands have higher fraud rates (simplified)
    if (method.card_brand === 'prepaid') {
      score += 15;
    }

    // Cards expiring soon might be stolen
    if (method.exp_month && method.exp_year) {
      const now = new Date();
      const expiry = new Date(method.exp_year, method.exp_month - 1);
      const monthsUntilExpiry =
        (expiry.getFullYear() - now.getFullYear()) * 12 +
        (expiry.getMonth() - now.getMonth());

      if (monthsUntilExpiry <= 1) {
        score += 10;
      }
    }

    return score;
  }

  /**
   * Evaluates risk based on customer email patterns.
   * Checks for disposable email domains and random-looking addresses.
   * @param email - Customer email address
   * @returns Risk score contribution (0-35)
   */
  private evaluateEmail(email: string): number {
    let score = 0;

    // Disposable email domains
    const disposableDomains = [
      'tempmail.com',
      'throwaway.com',
      'mailinator.com',
      'guerrillamail.com',
    ];
    const domain = email.split('@')[1]?.toLowerCase();

    if (domain && disposableDomains.includes(domain)) {
      score += 25;
    }

    // Random-looking emails
    const localPart = email.split('@')[0];
    if (localPart && localPart.length > 20 && /^[a-z0-9]+$/i.test(localPart)) {
      score += 10;
    }

    return score;
  }

  /**
   * Evaluates risk based on transaction velocity and frequency patterns.
   * Checks for unusual patterns like multiple transactions from same card/IP/email.
   * Note: Simplified implementation; production would query Redis/DB for actual history.
   * @param merchantId - UUID of the merchant
   * @param customerEmail - Optional customer email for lookup
   * @returns Risk score contribution (0-10)
   */
  private async evaluateVelocity(
    _merchantId: string,
    _customerEmail?: string
  ): Promise<number> {
    // Simplified - in production would query Redis for recent transaction counts
    // For demo purposes, we'll return a random low score

    // This would typically check:
    // - Transactions from same card in last hour
    // - Transactions from same IP in last hour
    // - Transactions from same email in last hour
    // - Transactions to same merchant from different cards

    return Math.floor(Math.random() * 10);
  }

  /**
   * Converts a numeric risk score to a human-readable risk level.
   * @param score - Risk score from 0-100
   * @returns Risk level classification
   */
  getRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score < 30) return 'low';
    if (score < 50) return 'medium';
    if (score < 70) return 'high';
    return 'critical';
  }
}
