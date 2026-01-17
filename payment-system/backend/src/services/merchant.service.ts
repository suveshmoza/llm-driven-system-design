import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { query, queryOne, withTransaction } from '../db/connection.js';
import type { Merchant, Account, DashboardStats } from '../types/index.js';
import type { PoolClient } from 'pg';

/**
 * Service for managing merchant accounts and retrieving business analytics.
 * Handles merchant creation, authentication, API key management, and dashboard statistics.
 */
export class MerchantService {
  /** Number of bcrypt hashing rounds for API key storage */
  private saltRounds = parseInt(process.env.API_KEY_SALT_ROUNDS || '10', 10);

  /**
   * Creates a new merchant account with an associated ledger account.
   * Generates a unique API key and webhook secret for the merchant.
   * @param name - Business name of the merchant
   * @param email - Contact email for the merchant account
   * @param defaultCurrency - Default currency for transactions (default: USD)
   * @returns Object containing the created merchant and the plaintext API key (only returned once)
   */
  async createMerchant(
    name: string,
    email: string,
    defaultCurrency = 'USD'
  ): Promise<{ merchant: Merchant; apiKey: string }> {
    // Generate API key
    const apiKey = `pk_${uuidv4().replace(/-/g, '')}`;
    const apiKeyHash = await bcrypt.hash(apiKey, this.saltRounds);

    // Generate webhook secret
    const webhookSecret = `whsec_${uuidv4().replace(/-/g, '')}`;

    const merchant = await withTransaction(async (client: PoolClient) => {
      // Create merchant account for balance tracking
      const accountResult = await client.query<Account>(
        `INSERT INTO accounts (name, account_type, currency)
         VALUES ($1, 'merchant', $2)
         RETURNING *`,
        [`merchant_${email}`, defaultCurrency]
      );

      const account = accountResult.rows[0];

      // Create merchant
      const merchantResult = await client.query<Merchant>(
        `INSERT INTO merchants (account_id, name, email, api_key_hash, webhook_secret, default_currency)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [account.id, name, email, apiKeyHash, webhookSecret, defaultCurrency]
      );

      return merchantResult.rows[0];
    });

    return { merchant, apiKey };
  }

  /**
   * Authenticates a merchant by verifying their API key.
   * Compares the provided key against all active merchant hashes.
   * Note: Production implementation should use a more efficient lookup mechanism.
   * @param apiKey - Plaintext API key to verify
   * @returns Authenticated merchant if valid, null otherwise
   */
  async authenticateByApiKey(apiKey: string): Promise<Merchant | null> {
    // Get all merchants (in production, would use a more efficient lookup)
    const merchants = await query<Merchant>('SELECT * FROM merchants WHERE status = $1', [
      'active',
    ]);

    for (const merchant of merchants) {
      const matches = await bcrypt.compare(apiKey, merchant.api_key_hash);
      if (matches) {
        return merchant;
      }
    }

    return null;
  }

  /**
   * Retrieves a merchant by their unique identifier.
   * @param id - UUID of the merchant
   * @returns Merchant if found, null otherwise
   */
  async getMerchant(id: string): Promise<Merchant | null> {
    return queryOne<Merchant>('SELECT * FROM merchants WHERE id = $1', [id]);
  }

  /**
   * Retrieves a merchant by their email address.
   * Used for checking existing registrations during signup.
   * @param email - Email address to look up
   * @returns Merchant if found, null otherwise
   */
  async getMerchantByEmail(email: string): Promise<Merchant | null> {
    return queryOne<Merchant>('SELECT * FROM merchants WHERE email = $1', [email]);
  }

  /**
   * Updates the webhook URL for receiving payment event notifications.
   * @param merchantId - UUID of the merchant
   * @param webhookUrl - HTTPS URL to receive webhook POSTs
   * @returns Updated merchant record
   */
  async updateWebhookUrl(merchantId: string, webhookUrl: string): Promise<Merchant> {
    await query(
      `UPDATE merchants SET webhook_url = $1, updated_at = NOW() WHERE id = $2`,
      [webhookUrl, merchantId]
    );

    return (await this.getMerchant(merchantId))!;
  }

  /**
   * Generates a new API key, invalidating the previous one.
   * Should be used when the current key is compromised or for periodic rotation.
   * @param merchantId - UUID of the merchant
   * @returns Object containing updated merchant and new plaintext API key
   */
  async rotateApiKey(merchantId: string): Promise<{ merchant: Merchant; apiKey: string }> {
    const apiKey = `pk_${uuidv4().replace(/-/g, '')}`;
    const apiKeyHash = await bcrypt.hash(apiKey, this.saltRounds);

    await query(
      `UPDATE merchants SET api_key_hash = $1, updated_at = NOW() WHERE id = $2`,
      [apiKeyHash, merchantId]
    );

    const merchant = await this.getMerchant(merchantId);
    return { merchant: merchant!, apiKey };
  }

  /**
   * Retrieves the current balance from the merchant's ledger account.
   * Balance represents funds available for payout.
   * @param merchantId - UUID of the merchant
   * @returns Current balance in cents
   * @throws Error if merchant not found
   */
  async getMerchantBalance(merchantId: string): Promise<number> {
    const merchant = await this.getMerchant(merchantId);
    if (!merchant) {
      throw new Error('Merchant not found');
    }

    const account = await queryOne<Account>(
      'SELECT balance FROM accounts WHERE id = $1',
      [merchant.account_id]
    );

    return account?.balance ?? 0;
  }

  /**
   * Calculates aggregated statistics for the merchant dashboard.
   * Includes total volume, transaction counts, fees, and success/refund rates.
   * @param merchantId - UUID of the merchant
   * @param startDate - Beginning of the reporting period
   * @param endDate - End of the reporting period
   * @returns Dashboard statistics for the specified period
   */
  async getDashboardStats(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<DashboardStats> {
    // Get transaction stats
    const stats = await queryOne<{
      total_volume: string;
      total_transactions: string;
      total_fees: string;
      successful_count: string;
      refunded_count: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('captured', 'partially_refunded', 'refunded') THEN amount ELSE 0 END), 0) as total_volume,
         COUNT(*) as total_transactions,
         COALESCE(SUM(CASE WHEN status IN ('captured', 'partially_refunded', 'refunded') THEN fee_amount ELSE 0 END), 0) as total_fees,
         COALESCE(SUM(CASE WHEN status IN ('captured', 'partially_refunded', 'refunded') THEN 1 ELSE 0 END), 0) as successful_count,
         COALESCE(SUM(CASE WHEN status IN ('refunded', 'partially_refunded') THEN 1 ELSE 0 END), 0) as refunded_count
       FROM transactions
       WHERE merchant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [merchantId, startDate, endDate]
    );

    const totalVolume = parseInt(stats?.total_volume || '0', 10);
    const totalTransactions = parseInt(stats?.total_transactions || '0', 10);
    const totalFees = parseInt(stats?.total_fees || '0', 10);
    const successfulCount = parseInt(stats?.successful_count || '0', 10);
    const refundedCount = parseInt(stats?.refunded_count || '0', 10);

    return {
      total_volume: totalVolume,
      total_transactions: totalTransactions,
      total_fees: totalFees,
      successful_rate: totalTransactions > 0 ? (successfulCount / totalTransactions) * 100 : 0,
      refund_rate: successfulCount > 0 ? (refundedCount / successfulCount) * 100 : 0,
      average_transaction: totalTransactions > 0 ? Math.round(totalVolume / totalTransactions) : 0,
    };
  }

  /**
   * Retrieves time-series data of transaction volume for chart visualization.
   * Groups transactions by the specified time granularity.
   * @param merchantId - UUID of the merchant
   * @param startDate - Beginning of the reporting period
   * @param endDate - End of the reporting period
   * @param granularity - Time bucket size: 'hour', 'day', or 'week'
   * @returns Array of data points with period, volume, and transaction count
   */
  async getVolumeOverTime(
    merchantId: string,
    startDate: Date,
    endDate: Date,
    granularity: 'hour' | 'day' | 'week' = 'day'
  ): Promise<Array<{ period: string; volume: number; count: number }>> {
    const truncFunc = granularity === 'hour' ? 'hour' : granularity === 'week' ? 'week' : 'day';

    return query<{ period: string; volume: number; count: number }>(
      `SELECT
         DATE_TRUNC($1, created_at) as period,
         COALESCE(SUM(CASE WHEN status IN ('captured', 'partially_refunded', 'refunded') THEN amount ELSE 0 END), 0) as volume,
         COUNT(*) as count
       FROM transactions
       WHERE merchant_id = $2 AND created_at >= $3 AND created_at < $4
       GROUP BY DATE_TRUNC($1, created_at)
       ORDER BY period`,
      [truncFunc, merchantId, startDate, endDate]
    );
  }

  /**
   * Retrieves a paginated list of all merchants (admin function).
   * Used for platform administration and oversight.
   * @param limit - Maximum number of merchants to return
   * @param offset - Number of merchants to skip for pagination
   * @returns Object containing merchants array and total count
   */
  async listMerchants(
    limit = 50,
    offset = 0
  ): Promise<{ merchants: Merchant[]; total: number }> {
    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM merchants'
    );

    const merchants = await query<Merchant>(
      'SELECT * FROM merchants ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    return {
      merchants,
      total: parseInt(countResult?.count || '0', 10),
    };
  }
}
