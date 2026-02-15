import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getWallet, deposit, withdraw } from '../services/walletService.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/wallet - Get current user's wallet balance
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const wallet = await getWallet(req.session.userId!);

    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }

    res.json({ wallet });
  } catch (err) {
    logger.error({ err }, 'Failed to get wallet');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wallet/deposit - Deposit funds into wallet
router.post('/deposit', requireAuth, async (req: Request, res: Response) => {
  try {
    const { amountCents, note } = req.body;

    if (!amountCents || amountCents <= 0) {
      res.status(400).json({ error: 'Amount must be positive' });
      return;
    }

    if (amountCents > 1000000) { // $10,000 limit
      res.status(400).json({ error: 'Deposit amount exceeds limit' });
      return;
    }

    const result = await deposit(req.session.userId!, amountCents, note);

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Deposit failed';
    logger.error({ err }, 'Deposit failed');
    res.status(400).json({ error: message });
  }
});

// POST /api/wallet/withdraw - Withdraw funds from wallet
router.post('/withdraw', requireAuth, async (req: Request, res: Response) => {
  try {
    const { amountCents, note } = req.body;

    if (!amountCents || amountCents <= 0) {
      res.status(400).json({ error: 'Amount must be positive' });
      return;
    }

    if (amountCents > 1000000) { // $10,000 limit
      res.status(400).json({ error: 'Withdrawal amount exceeds limit' });
      return;
    }

    const result = await withdraw(req.session.userId!, amountCents, note);

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Withdrawal failed';
    logger.error({ err }, 'Withdrawal failed');
    res.status(400).json({ error: message });
  }
});

/** Wallet router for balance queries, deposits, and withdrawals with validation. */
export default router;
