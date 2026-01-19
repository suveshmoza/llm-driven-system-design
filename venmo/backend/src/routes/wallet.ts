import express, { type Request, type Response } from 'express';
import { pool } from '../db/pool.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { getCachedBalance, setCachedBalance } from '../db/redis.js';

const router = express.Router();

interface WalletRow {
  balance: number;
  pending_balance: number;
  created_at?: Date;
}

interface PaymentMethodRow {
  id: string;
  type: string;
  is_default: boolean;
  name: string;
  last4: string;
  bank_name: string | null;
  verified: boolean;
  created_at: Date;
}

interface TransferRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  note: string;
  visibility: string;
  status: string;
  created_at: Date;
  sender_username: string;
  sender_name: string | null;
  sender_avatar: string | null;
  receiver_username: string;
  receiver_name: string | null;
  receiver_avatar: string | null;
  direction: string;
}

// Get wallet balance
router.get('/balance', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Try cache first
    let balance = await getCachedBalance(authReq.user.id);

    if (balance === null) {
      const result = await pool.query<WalletRow>(
        'SELECT balance, pending_balance FROM wallets WHERE user_id = $1',
        [authReq.user.id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }

      balance = result.rows[0].balance;
      await setCachedBalance(authReq.user.id, balance);
    }

    res.json({ balance });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// Get wallet details with payment methods
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const walletResult = await pool.query<WalletRow>(
      'SELECT balance, pending_balance, created_at FROM wallets WHERE user_id = $1',
      [authReq.user.id]
    );

    const paymentMethodsResult = await pool.query<PaymentMethodRow>(
      `SELECT id, type, is_default, name, last4, bank_name, verified, created_at
       FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [authReq.user.id]
    );

    const wallet = walletResult.rows[0] || { balance: 0, pending_balance: 0 };

    res.json({
      balance: wallet.balance,
      pendingBalance: wallet.pending_balance,
      createdAt: wallet.created_at,
      paymentMethods: paymentMethodsResult.rows,
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ error: 'Failed to get wallet details' });
  }
});

// Get transaction history
router.get('/history', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { limit = '50', offset = '0' } = req.query;

    const result = await pool.query<TransferRow>(
      `SELECT t.*,
              sender.username as sender_username, sender.name as sender_name, sender.avatar_url as sender_avatar,
              receiver.username as receiver_username, receiver.name as receiver_name, receiver.avatar_url as receiver_avatar,
              CASE WHEN t.sender_id = $1 THEN 'sent' ELSE 'received' END as direction
       FROM transfers t
       JOIN users sender ON t.sender_id = sender.id
       JOIN users receiver ON t.receiver_id = receiver.id
       WHERE t.sender_id = $1 OR t.receiver_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [authReq.user.id, parseInt(limit as string), parseInt(offset as string)]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Failed to get transaction history' });
  }
});

// Add deposit (simulated - for testing)
router.post('/deposit', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { amount } = req.body as { amount?: number };

    if (!amount || amount <= 0 || amount > 1000000) {
      res.status(400).json({ error: 'Invalid amount (max $10,000)' });
      return;
    }

    const amountCents = Math.round(amount * 100);

    const result = await pool.query<{ balance: number }>(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING balance`,
      [amountCents, authReq.user.id]
    );

    res.json({
      message: 'Deposit successful',
      newBalance: result.rows[0].balance,
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Deposit failed' });
  }
});

export default router;
