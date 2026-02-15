import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../services/db.js';
import { marketService } from '../services/marketService.js';

const router = Router();

// GET /api/v1/portfolio - Get portfolio summary
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    // Get all wallet balances
    const walletsResult = await pool.query(
      `SELECT w.currency_id AS "currencyId", c.name AS "currencyName",
              w.balance::text, w.reserved_balance::text AS "reservedBalance",
              (w.balance - w.reserved_balance)::text AS available,
              c.is_fiat AS "isFiat"
       FROM wallets w
       JOIN currencies c ON c.id = w.currency_id
       WHERE w.user_id = $1 AND w.balance > 0
       ORDER BY w.balance DESC`,
      [userId]
    );

    let totalValueUsd = 0;
    const holdings = walletsResult.rows.map((wallet) => {
      const balance = parseFloat(wallet.balance);
      let valueUsd = 0;

      if (wallet.currencyId === 'USD') {
        valueUsd = balance;
      } else {
        const priceData = marketService.getPriceData(`${wallet.currencyId}-USD`);
        if (priceData) {
          valueUsd = balance * priceData.price;
        }
      }

      totalValueUsd += valueUsd;

      return {
        currencyId: wallet.currencyId,
        currencyName: wallet.currencyName,
        balance: wallet.balance,
        reservedBalance: wallet.reservedBalance,
        available: wallet.available,
        valueUsd: valueUsd.toFixed(2),
        isFiat: wallet.isFiat,
      };
    });

    // Add allocation percentages
    const holdingsWithAllocation = holdings.map((h) => ({
      ...h,
      allocation:
        totalValueUsd > 0
          ? ((parseFloat(h.valueUsd) / totalValueUsd) * 100).toFixed(2)
          : '0',
    }));

    res.json({
      totalValueUsd: totalValueUsd.toFixed(2),
      holdings: holdingsWithAllocation,
    });
  } catch (error) {
    console.error('Get portfolio error:', error);
    res.status(500).json({ error: 'Failed to get portfolio' });
  }
});

// GET /api/v1/portfolio/history - Get portfolio snapshots
router.get('/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const limit = parseInt(req.query.limit as string) || 100;

    const result = await pool.query(
      `SELECT total_value_usd::text AS "totalValueUsd", breakdown, created_at AS "createdAt"
       FROM portfolio_snapshots
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({ snapshots: result.rows });
  } catch (error) {
    console.error('Get portfolio history error:', error);
    res.status(500).json({ error: 'Failed to get portfolio history' });
  }
});

export default router;
