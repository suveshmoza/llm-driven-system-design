import { pool } from './db.js';
import { logger } from './logger.js';
import { transferTotal, transferDuration, walletOperations } from './metrics.js';
import { checkIdempotencyKey, storeIdempotencyKey } from './idempotencyService.js';

export interface TransferResult {
  transaction: {
    id: string;
    senderId: string;
    recipientId: string;
    amountCents: number;
    type: string;
    status: string;
    note: string | null;
    createdAt: string;
  };
  senderBalance: number;
}

/** Executes a P2P transfer with double-entry bookkeeping, optimistic locking, and deadlock prevention. */
export async function executeTransfer(
  senderId: string,
  recipientId: string,
  amountCents: number,
  note?: string,
  idempotencyKey?: string,
): Promise<TransferResult> {
  const startTime = Date.now();

  // Check idempotency key if provided
  if (idempotencyKey) {
    const cached = await checkIdempotencyKey(idempotencyKey);
    if (cached.found) {
      return cached.response as TransferResult;
    }
  }

  if (senderId === recipientId) {
    throw new Error('Cannot transfer to yourself');
  }

  if (amountCents <= 0) {
    throw new Error('Amount must be positive');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock both wallets in consistent order to prevent deadlocks
    const [firstId, secondId] = senderId < recipientId
      ? [senderId, recipientId]
      : [recipientId, senderId];

    const walletsResult = await client.query(
      `SELECT id, user_id, balance_cents, version FROM wallets
       WHERE user_id IN ($1, $2)
       ORDER BY user_id
       FOR UPDATE`,
      [firstId, secondId],
    );

    if (walletsResult.rows.length !== 2) {
      throw new Error('One or both wallets not found');
    }

    const senderWallet = walletsResult.rows.find((w: { user_id: string }) => w.user_id === senderId);
    const recipientWallet = walletsResult.rows.find((w: { user_id: string }) => w.user_id === recipientId);

    if (!senderWallet || !recipientWallet) {
      throw new Error('Wallet lookup failed');
    }

    const senderBalance = parseInt(senderWallet.balance_cents, 10);

    if (senderBalance < amountCents) {
      throw new Error('Insufficient funds');
    }

    const newSenderBalance = senderBalance - amountCents;
    const newRecipientBalance = parseInt(recipientWallet.balance_cents, 10) + amountCents;

    // Update sender wallet (debit)
    const senderUpdate = await client.query(
      `UPDATE wallets SET balance_cents = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND version = $3
       RETURNING version`,
      [newSenderBalance, senderWallet.id, senderWallet.version],
    );

    if (senderUpdate.rows.length === 0) {
      throw new Error('Concurrent modification detected on sender wallet');
    }

    // Update recipient wallet (credit)
    const recipientUpdate = await client.query(
      `UPDATE wallets SET balance_cents = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND version = $3
       RETURNING version`,
      [newRecipientBalance, recipientWallet.id, recipientWallet.version],
    );

    if (recipientUpdate.rows.length === 0) {
      throw new Error('Concurrent modification detected on recipient wallet');
    }

    // Create transaction record
    const txResult = await client.query(
      `INSERT INTO transactions (idempotency_key, sender_id, recipient_id, amount_cents, type, status, note)
       VALUES ($1, $2, $3, $4, 'transfer', 'completed', $5)
       RETURNING id, sender_id, recipient_id, amount_cents, type, status, note, created_at`,
      [idempotencyKey || null, senderId, recipientId, amountCents, note || null],
    );

    const transaction = txResult.rows[0];

    // Double-entry ledger: debit sender, credit recipient
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents)
       VALUES ($1, $2, 'debit', $3, $4)`,
      [transaction.id, senderWallet.id, amountCents, newSenderBalance],
    );

    await client.query(
      `INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents)
       VALUES ($1, $2, 'credit', $3, $4)`,
      [transaction.id, recipientWallet.id, amountCents, newRecipientBalance],
    );

    const result: TransferResult = {
      transaction: {
        id: transaction.id,
        senderId: transaction.sender_id,
        recipientId: transaction.recipient_id,
        amountCents: parseInt(transaction.amount_cents, 10),
        type: transaction.type,
        status: transaction.status,
        note: transaction.note,
        createdAt: transaction.created_at,
      },
      senderBalance: newSenderBalance,
    };

    // Store idempotency key within the same transaction
    if (idempotencyKey) {
      await storeIdempotencyKey(idempotencyKey, result, client);
    }

    await client.query('COMMIT');

    const duration = (Date.now() - startTime) / 1000;
    transferDuration.observe({ status: 'completed' }, duration);
    transferTotal.inc({ status: 'completed' });
    walletOperations.inc({ type: 'transfer' });

    logger.info(
      { senderId, recipientId, amountCents, transactionId: transaction.id },
      'Transfer completed',
    );

    return result;
  } catch (err) {
    await client.query('ROLLBACK');

    const duration = (Date.now() - startTime) / 1000;
    transferDuration.observe({ status: 'failed' }, duration);
    transferTotal.inc({ status: 'failed' });

    logger.error({ err, senderId, recipientId, amountCents }, 'Transfer failed');
    throw err;
  } finally {
    client.release();
  }
}
