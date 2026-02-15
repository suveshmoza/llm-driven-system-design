import { pool } from './db.js';
import { logger } from './logger.js';
import { walletOperations } from './metrics.js';

export interface WalletInfo {
  id: string;
  userId: string;
  balanceCents: number;
  currency: string;
  version: number;
}

/** Retrieves the wallet balance and metadata for a given user. */
export async function getWallet(userId: string): Promise<WalletInfo | null> {
  const result = await pool.query(
    `SELECT id, user_id, balance_cents, currency, version
     FROM wallets WHERE user_id = $1`,
    [userId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    balanceCents: parseInt(row.balance_cents, 10),
    currency: row.currency,
    version: row.version,
  };
}

/** Deposits funds into a user's wallet with transactional ledger entry. */
export async function deposit(
  userId: string,
  amountCents: number,
  note?: string,
): Promise<{ transaction: unknown; wallet: WalletInfo }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get wallet with lock
    const walletResult = await client.query(
      `SELECT id, balance_cents, version FROM wallets
       WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    if (walletResult.rows.length === 0) {
      throw new Error('Wallet not found');
    }

    const wallet = walletResult.rows[0];
    const currentBalance = parseInt(wallet.balance_cents, 10);
    const newBalance = currentBalance + amountCents;

    // Update wallet balance
    await client.query(
      `UPDATE wallets SET balance_cents = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2`,
      [newBalance, wallet.id],
    );

    // Create transaction record
    const txResult = await client.query(
      `INSERT INTO transactions (recipient_id, amount_cents, type, status, note)
       VALUES ($1, $2, 'deposit', 'completed', $3)
       RETURNING id, amount_cents, type, status, note, created_at`,
      [userId, amountCents, note || 'Deposit'],
    );

    const transaction = txResult.rows[0];

    // Create ledger entry (credit to user wallet)
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents)
       VALUES ($1, $2, 'credit', $3, $4)`,
      [transaction.id, wallet.id, amountCents, newBalance],
    );

    await client.query('COMMIT');
    walletOperations.inc({ type: 'deposit' });

    logger.info({ userId, amountCents, newBalance }, 'Deposit completed');

    return {
      transaction: {
        id: transaction.id,
        amountCents: parseInt(transaction.amount_cents, 10),
        type: transaction.type,
        status: transaction.status,
        note: transaction.note,
        createdAt: transaction.created_at,
      },
      wallet: {
        id: wallet.id,
        userId,
        balanceCents: newBalance,
        currency: 'USD',
        version: wallet.version + 1,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Withdraws funds from a user's wallet with balance check and ledger entry. */
export async function withdraw(
  userId: string,
  amountCents: number,
  note?: string,
): Promise<{ transaction: unknown; wallet: WalletInfo }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get wallet with lock
    const walletResult = await client.query(
      `SELECT id, balance_cents, version FROM wallets
       WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    if (walletResult.rows.length === 0) {
      throw new Error('Wallet not found');
    }

    const wallet = walletResult.rows[0];
    const currentBalance = parseInt(wallet.balance_cents, 10);

    if (currentBalance < amountCents) {
      throw new Error('Insufficient funds');
    }

    const newBalance = currentBalance - amountCents;

    // Update wallet balance
    await client.query(
      `UPDATE wallets SET balance_cents = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2`,
      [newBalance, wallet.id],
    );

    // Create transaction record
    const txResult = await client.query(
      `INSERT INTO transactions (sender_id, recipient_id, amount_cents, type, status, note)
       VALUES ($1, $1, $2, 'withdrawal', 'completed', $3)
       RETURNING id, amount_cents, type, status, note, created_at`,
      [userId, amountCents, note || 'Withdrawal'],
    );

    const transaction = txResult.rows[0];

    // Create ledger entry (debit from user wallet)
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents)
       VALUES ($1, $2, 'debit', $3, $4)`,
      [transaction.id, wallet.id, amountCents, newBalance],
    );

    await client.query('COMMIT');
    walletOperations.inc({ type: 'withdrawal' });

    logger.info({ userId, amountCents, newBalance }, 'Withdrawal completed');

    return {
      transaction: {
        id: transaction.id,
        amountCents: parseInt(transaction.amount_cents, 10),
        type: transaction.type,
        status: transaction.status,
        note: transaction.note,
        createdAt: transaction.created_at,
      },
      wallet: {
        id: wallet.id,
        userId,
        balanceCents: newBalance,
        currency: 'USD',
        version: wallet.version + 1,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
