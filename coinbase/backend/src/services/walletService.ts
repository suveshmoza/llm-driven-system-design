import { pool } from './db.js';

/** Returns all wallet balances for a user including available (balance minus reserved). */
export async function getBalances(
  userId: string
): Promise<
  { currencyId: string; balance: string; reservedBalance: string; available: string }[]
> {
  const result = await pool.query(
    `SELECT w.currency_id AS "currencyId",
            w.balance::text AS balance,
            w.reserved_balance::text AS "reservedBalance",
            (w.balance - w.reserved_balance)::text AS available
     FROM wallets w
     WHERE w.user_id = $1
     ORDER BY w.balance DESC`,
    [userId]
  );
  return result.rows;
}

/** Returns the balance details for a specific currency wallet. */
export async function getBalance(
  userId: string,
  currencyId: string
): Promise<{ balance: string; reservedBalance: string; available: string } | null> {
  const result = await pool.query(
    `SELECT balance::text, reserved_balance::text AS "reservedBalance",
            (balance - reserved_balance)::text AS available
     FROM wallets
     WHERE user_id = $1 AND currency_id = $2`,
    [userId, currencyId]
  );
  return result.rows[0] || null;
}

/** Deposits funds into a user's wallet and records the transaction. */
export async function deposit(
  userId: string,
  currencyId: string,
  amount: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert wallet
    await client.query(
      `INSERT INTO wallets (user_id, currency_id, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, currency_id)
       DO UPDATE SET balance = wallets.balance + $3, updated_at = NOW()`,
      [userId, currencyId, amount]
    );

    // Record transaction
    await client.query(
      `INSERT INTO transactions (user_id, type, currency_id, amount, status)
       VALUES ($1, 'deposit', $2, $3, 'completed')`,
      [userId, currencyId, amount]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Reserves balance for a pending order. Returns false if insufficient available funds. */
export async function reserveBalance(
  userId: string,
  currencyId: string,
  amount: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE wallets
     SET reserved_balance = reserved_balance + $3, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2
       AND (balance - reserved_balance) >= $3
     RETURNING id`,
    [userId, currencyId, amount]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/** Releases previously reserved balance when an order is cancelled. */
export async function releaseReserve(
  userId: string,
  currencyId: string,
  amount: string
): Promise<void> {
  await pool.query(
    `UPDATE wallets
     SET reserved_balance = GREATEST(reserved_balance - $3, 0), updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2`,
    [userId, currencyId, amount]
  );
}

/** Executes an atomic trade transfer between buyer and seller wallets with fee deduction. */
export async function executeTradeTransfer(
  buyerUserId: string,
  sellerUserId: string,
  baseCurrencyId: string,
  quoteCurrencyId: string,
  baseAmount: string,
  quoteAmount: string,
  buyerFee: string,
  sellerFee: string,
  tradeId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buyer: deduct quote currency (reserved), add base currency
    await client.query(
      `UPDATE wallets SET balance = balance - $3, reserved_balance = reserved_balance - $3, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2`,
      [buyerUserId, quoteCurrencyId, quoteAmount]
    );

    // Buyer: add base currency (minus fee)
    const buyerReceives = (parseFloat(baseAmount) - parseFloat(buyerFee)).toString();
    await client.query(
      `INSERT INTO wallets (user_id, currency_id, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, currency_id)
       DO UPDATE SET balance = wallets.balance + $3, updated_at = NOW()`,
      [buyerUserId, baseCurrencyId, buyerReceives]
    );

    // Seller: deduct base currency (reserved), add quote currency
    await client.query(
      `UPDATE wallets SET balance = balance - $3, reserved_balance = reserved_balance - $3, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2`,
      [sellerUserId, baseCurrencyId, baseAmount]
    );

    // Seller: add quote currency (minus fee)
    const sellerReceives = (parseFloat(quoteAmount) - parseFloat(sellerFee)).toString();
    await client.query(
      `INSERT INTO wallets (user_id, currency_id, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, currency_id)
       DO UPDATE SET balance = wallets.balance + $3, updated_at = NOW()`,
      [sellerUserId, quoteCurrencyId, sellerReceives]
    );

    // Record trade transactions
    await client.query(
      `INSERT INTO transactions (user_id, type, currency_id, amount, fee, reference_id, status) VALUES
       ($1, 'trade', $2, $3, $4, $5, 'completed'),
       ($6, 'trade', $7, $8, $9, $5, 'completed')`,
      [
        buyerUserId,
        baseCurrencyId,
        baseAmount,
        buyerFee,
        tradeId,
        sellerUserId,
        quoteCurrencyId,
        quoteAmount,
        sellerFee,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
