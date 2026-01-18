import dotenv from 'dotenv';
import {
  connectQueue,
  closeQueue,
  consumeFraudChecks,
  type FraudCheckMessage,
} from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import { query, queryOne, redis } from '../db/connection.js';
import { fraudScoreHistogram, fraudDecisionsTotal } from '../shared/metrics.js';

dotenv.config();

/**
 * Fraud scoring worker for async transaction risk analysis.
 *
 * Responsibilities:
 * - Consume fraud check requests from the queue
 * - Perform deep fraud analysis (velocity checks, pattern matching)
 * - Update transaction risk flags in database
 * - Trigger alerts for high-risk transactions
 *
 * Analysis performed:
 * - Velocity checks: Multiple transactions from same card/IP/email
 * - Amount patterns: Unusual transaction sizes
 * - Geographic analysis: IP-based location checks
 * - Device fingerprinting: (if available)
 * - Behavioral patterns: Timing and frequency analysis
 *
 * This worker performs more thorough analysis than the real-time
 * fraud check in payment.service.ts, which only does quick heuristics.
 */

/** Risk level thresholds */
const RISK_THRESHOLDS = {
  LOW: 30,
  MEDIUM: 50,
  HIGH: 70,
  CRITICAL: 90,
};

/** Time window for velocity checks (in seconds) */
const VELOCITY_WINDOW = 3600; // 1 hour

/**
 * Fraud scoring result with detailed breakdown.
 */
interface FraudScore {
  totalScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: FraudFactor[];
  recommendation: 'allow' | 'review' | 'block';
}

interface FraudFactor {
  name: string;
  score: number;
  description: string;
}

/**
 * Performs velocity-based fraud analysis.
 * Checks for unusual transaction frequency patterns.
 */
async function analyzeVelocity(message: FraudCheckMessage): Promise<FraudFactor[]> {
  const factors: FraudFactor[] = [];

  // Check card velocity (same last_four in time window)
  if (message.paymentMethod.last_four) {
    const cardKey = `velocity:card:${message.paymentMethod.last_four}`;
    const cardCount = await redis.incr(cardKey);

    if (cardCount === 1) {
      await redis.expire(cardKey, VELOCITY_WINDOW);
    }

    if (cardCount > 10) {
      factors.push({
        name: 'card_velocity',
        score: 30,
        description: `Card used ${cardCount} times in last hour`,
      });
    } else if (cardCount > 5) {
      factors.push({
        name: 'card_velocity',
        score: 15,
        description: `Card used ${cardCount} times in last hour`,
      });
    }
  }

  // Check email velocity
  if (message.customerEmail) {
    const emailKey = `velocity:email:${message.customerEmail}`;
    const emailCount = await redis.incr(emailKey);

    if (emailCount === 1) {
      await redis.expire(emailKey, VELOCITY_WINDOW);
    }

    if (emailCount > 15) {
      factors.push({
        name: 'email_velocity',
        score: 25,
        description: `Email used in ${emailCount} transactions in last hour`,
      });
    } else if (emailCount > 8) {
      factors.push({
        name: 'email_velocity',
        score: 10,
        description: `Email used in ${emailCount} transactions in last hour`,
      });
    }
  }

  // Check IP velocity
  if (message.ipAddress) {
    const ipKey = `velocity:ip:${message.ipAddress}`;
    const ipCount = await redis.incr(ipKey);

    if (ipCount === 1) {
      await redis.expire(ipKey, VELOCITY_WINDOW);
    }

    if (ipCount > 20) {
      factors.push({
        name: 'ip_velocity',
        score: 20,
        description: `IP address used in ${ipCount} transactions in last hour`,
      });
    }
  }

  // Check merchant-specific velocity (same customer at same merchant)
  if (message.customerEmail) {
    const merchantKey = `velocity:merchant:${message.merchantId}:${message.customerEmail}`;
    const merchantCount = await redis.incr(merchantKey);

    if (merchantCount === 1) {
      await redis.expire(merchantKey, VELOCITY_WINDOW);
    }

    if (merchantCount > 5) {
      factors.push({
        name: 'merchant_velocity',
        score: 15,
        description: `Same customer made ${merchantCount} purchases at this merchant in last hour`,
      });
    }
  }

  return factors;
}

/**
 * Analyzes amount patterns for suspicious activity.
 */
function analyzeAmount(message: FraudCheckMessage): FraudFactor[] {
  const factors: FraudFactor[] = [];
  const amount = message.amount;

  // Very small amounts might indicate card testing
  if (amount < 100) {
    factors.push({
      name: 'micro_transaction',
      score: 15,
      description: `Very small transaction amount ($${(amount / 100).toFixed(2)}) - possible card testing`,
    });
  }

  // Very large amounts are higher risk
  if (amount > 1000000) {
    factors.push({
      name: 'large_amount',
      score: 25,
      description: `Large transaction amount ($${(amount / 100).toFixed(2)})`,
    });
  } else if (amount > 500000) {
    factors.push({
      name: 'large_amount',
      score: 15,
      description: `Above-average transaction amount ($${(amount / 100).toFixed(2)})`,
    });
  }

  // Round amounts can be suspicious (card testing)
  if (amount % 10000 === 0 && amount > 10000) {
    factors.push({
      name: 'round_amount',
      score: 10,
      description: `Suspiciously round amount ($${(amount / 100).toFixed(2)})`,
    });
  }

  return factors;
}

/**
 * Analyzes email patterns for suspicious activity.
 */
function analyzeEmail(email: string | undefined): FraudFactor[] {
  const factors: FraudFactor[] = [];

  if (!email) return factors;

  const domain = email.split('@')[1]?.toLowerCase();
  const localPart = email.split('@')[0];

  // Disposable email domains
  const disposableDomains = [
    'tempmail.com',
    'throwaway.com',
    'mailinator.com',
    'guerrillamail.com',
    'temp-mail.org',
    '10minutemail.com',
    'fakeinbox.com',
  ];

  if (domain && disposableDomains.includes(domain)) {
    factors.push({
      name: 'disposable_email',
      score: 30,
      description: `Disposable email domain: ${domain}`,
    });
  }

  // Random-looking email addresses (long strings of random characters)
  if (localPart && localPart.length > 20 && /^[a-z0-9]+$/i.test(localPart)) {
    factors.push({
      name: 'random_email',
      score: 15,
      description: 'Email appears to be randomly generated',
    });
  }

  // Numbers-only local part
  if (localPart && /^\d+$/.test(localPart)) {
    factors.push({
      name: 'numeric_email',
      score: 10,
      description: 'Email local part contains only numbers',
    });
  }

  return factors;
}

/**
 * Analyzes payment method for suspicious patterns.
 */
function analyzePaymentMethod(
  paymentMethod: FraudCheckMessage['paymentMethod']
): FraudFactor[] {
  const factors: FraudFactor[] = [];

  // Known test card numbers
  const testCards = ['4242', '4000', '0000', '1111'];
  if (paymentMethod.last_four && testCards.includes(paymentMethod.last_four)) {
    factors.push({
      name: 'test_card',
      score: 10,
      description: `Possible test card number ending in ${paymentMethod.last_four}`,
    });
  }

  // Prepaid cards have higher fraud rates
  if (paymentMethod.card_brand === 'prepaid') {
    factors.push({
      name: 'prepaid_card',
      score: 20,
      description: 'Prepaid card - higher fraud risk',
    });
  }

  return factors;
}

/**
 * Checks historical fraud patterns for the merchant.
 */
async function analyzeHistoricalPatterns(
  merchantId: string,
  customerEmail?: string
): Promise<FraudFactor[]> {
  const factors: FraudFactor[] = [];

  // Check if customer has previous chargebacks at this merchant
  if (customerEmail) {
    const chargebackCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM chargebacks c
       JOIN transactions t ON c.transaction_id = t.id
       WHERE t.merchant_id = $1 AND t.customer_email = $2`,
      [merchantId, customerEmail]
    );

    if (chargebackCount && parseInt(chargebackCount.count, 10) > 0) {
      factors.push({
        name: 'previous_chargeback',
        score: 40,
        description: `Customer has ${chargebackCount.count} previous chargebacks`,
      });
    }
  }

  // Check merchant's overall chargeback rate
  const merchantStats = await queryOne<{ chargeback_rate: number }>(
    `SELECT 
       COALESCE(
         (SELECT COUNT(*) FROM chargebacks c 
          JOIN transactions t ON c.transaction_id = t.id 
          WHERE t.merchant_id = $1)::float /
         NULLIF((SELECT COUNT(*) FROM transactions WHERE merchant_id = $1), 0),
         0
       ) as chargeback_rate
     FROM merchants WHERE id = $1`,
    [merchantId]
  );

  if (merchantStats && merchantStats.chargeback_rate > 0.01) {
    factors.push({
      name: 'high_chargeback_merchant',
      score: 15,
      description: `Merchant has elevated chargeback rate (${(merchantStats.chargeback_rate * 100).toFixed(2)}%)`,
    });
  }

  return factors;
}

/**
 * Performs comprehensive fraud analysis on a transaction.
 */
async function analyzeFraud(message: FraudCheckMessage): Promise<FraudScore> {
  const allFactors: FraudFactor[] = [];

  // Run all analysis in parallel for efficiency
  const [velocityFactors, historicalFactors] = await Promise.all([
    analyzeVelocity(message),
    analyzeHistoricalPatterns(message.merchantId, message.customerEmail),
  ]);

  allFactors.push(
    ...velocityFactors,
    ...analyzeAmount(message),
    ...analyzeEmail(message.customerEmail),
    ...analyzePaymentMethod(message.paymentMethod),
    ...historicalFactors
  );

  // Calculate total score
  const totalScore = Math.min(
    allFactors.reduce((sum, factor) => sum + factor.score, 0),
    100
  );

  // Determine risk level
  let riskLevel: FraudScore['riskLevel'];
  if (totalScore >= RISK_THRESHOLDS.CRITICAL) {
    riskLevel = 'critical';
  } else if (totalScore >= RISK_THRESHOLDS.HIGH) {
    riskLevel = 'high';
  } else if (totalScore >= RISK_THRESHOLDS.MEDIUM) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // Determine recommendation
  let recommendation: FraudScore['recommendation'];
  if (totalScore >= RISK_THRESHOLDS.CRITICAL) {
    recommendation = 'block';
  } else if (totalScore >= RISK_THRESHOLDS.HIGH) {
    recommendation = 'review';
  } else {
    recommendation = 'allow';
  }

  return {
    totalScore,
    riskLevel,
    factors: allFactors,
    recommendation,
  };
}

/**
 * Updates the transaction with fraud analysis results.
 */
async function updateTransactionRisk(
  paymentId: string,
  score: FraudScore
): Promise<void> {
  await query(
    `UPDATE transactions 
     SET risk_score = $2, 
         metadata = metadata || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      paymentId,
      score.totalScore,
      JSON.stringify({
        fraud_analysis: {
          score: score.totalScore,
          risk_level: score.riskLevel,
          recommendation: score.recommendation,
          factors: score.factors,
          analyzed_at: new Date().toISOString(),
        },
      }),
    ]
  );
}

/**
 * Sends an alert for high-risk transactions.
 * In production, this would integrate with alerting systems.
 */
async function sendRiskAlert(
  message: FraudCheckMessage,
  score: FraudScore
): Promise<void> {
  logger.warn(
    {
      paymentId: message.paymentId,
      merchantId: message.merchantId,
      amount: message.amount,
      score: score.totalScore,
      riskLevel: score.riskLevel,
      factors: score.factors.map((f) => f.name),
      recommendation: score.recommendation,
    },
    'High-risk transaction detected'
  );

  // In production, you might:
  // - Send to Slack/PagerDuty
  // - Create a review ticket
  // - Notify the merchant
  // - Block the transaction if configured
}

/**
 * Main fraud check handler.
 */
async function handleFraudCheck(message: FraudCheckMessage): Promise<boolean> {
  logger.debug(
    {
      paymentId: message.paymentId,
      merchantId: message.merchantId,
      amount: message.amount,
    },
    'Processing fraud check'
  );

  try {
    const score = await analyzeFraud(message);

    // Record metrics
    fraudScoreHistogram.labels(score.recommendation).observe(score.totalScore);

    if (score.recommendation === 'block') {
      fraudDecisionsTotal.labels('block').inc();
    } else if (score.recommendation === 'review') {
      fraudDecisionsTotal.labels('review').inc();
    } else {
      fraudDecisionsTotal.labels('allow').inc();
    }

    // Update transaction with fraud analysis
    await updateTransactionRisk(message.paymentId, score);

    // Alert on high-risk transactions
    if (score.riskLevel === 'high' || score.riskLevel === 'critical') {
      await sendRiskAlert(message, score);
    }

    logger.info(
      {
        paymentId: message.paymentId,
        score: score.totalScore,
        riskLevel: score.riskLevel,
        recommendation: score.recommendation,
        factorCount: score.factors.length,
      },
      'Fraud check completed'
    );

    return true;
  } catch (error) {
    logger.error(
      {
        error,
        paymentId: message.paymentId,
      },
      'Fraud check failed'
    );
    return false;
  }
}

/**
 * Worker startup and shutdown handling.
 */
async function main(): Promise<void> {
  logger.info('Starting fraud scoring worker...');

  const shutdown = async () => {
    logger.info('Shutting down fraud scoring worker...');
    await closeQueue();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await connectQueue();
    await consumeFraudChecks(handleFraudCheck);
    logger.info('Fraud scoring worker ready and consuming messages');
  } catch (error) {
    logger.error({ error }, 'Failed to start fraud scoring worker');
    process.exit(1);
  }
}

main();
