import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as walletService from '../services/walletService.js';
import { marketService } from '../services/marketService.js';

const router = Router();

// GET /api/v1/wallets - Get all wallet balances
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const balances = await walletService.getBalances(userId);

    // Add USD value to each wallet
    const walletsWithValue = balances.map((w) => {
      let valueUsd = 0;
      if (w.currencyId === 'USD') {
        valueUsd = parseFloat(w.balance);
      } else {
        const priceData = marketService.getPriceData(`${w.currencyId}-USD`);
        if (priceData) {
          valueUsd = parseFloat(w.balance) * priceData.price;
        }
      }
      return {
        ...w,
        valueUsd: valueUsd.toFixed(2),
      };
    });

    res.json({ wallets: walletsWithValue });
  } catch (error) {
    console.error('Get wallets error:', error);
    res.status(500).json({ error: 'Failed to get wallets' });
  }
});

// POST /api/v1/wallets/deposit - Simulate deposit
router.post('/deposit', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { currencyId, amount } = req.body;

    if (!currencyId || !amount) {
      res.status(400).json({ error: 'Currency and amount are required' });
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number' });
      return;
    }

    if (parsedAmount > 1000000) {
      res.status(400).json({ error: 'Maximum deposit amount is 1,000,000' });
      return;
    }

    await walletService.deposit(userId, currencyId, parsedAmount.toString());

    res.json({ message: 'Deposit successful', currencyId, amount: parsedAmount.toString() });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Deposit failed' });
  }
});

export default router;
