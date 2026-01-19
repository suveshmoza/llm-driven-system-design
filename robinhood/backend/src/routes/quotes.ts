import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { quoteService } from '../services/quoteService.js';

/**
 * Express router for stock quote endpoints.
 * Provides real-time and batch quote data.
 * Most endpoints are public; detailed stock info requires authentication.
 */
const router = Router();

/**
 * GET /api/quotes/stocks
 * Returns list of all available stock symbols and names.
 */
router.get('/stocks', (_req, res: Response) => {
  const stocks = quoteService.getAllStocks();
  res.json(stocks);
});

/**
 * GET /api/quotes
 * Returns current quotes for all available stocks.
 */
router.get('/', (_req, res: Response) => {
  const quotes = quoteService.getAllQuotes();
  res.json(quotes);
});

/**
 * GET /api/quotes/batch
 * Returns quotes for multiple symbols specified in query parameter.
 * Query: ?symbols=AAPL,GOOGL,MSFT (comma-separated)
 */
router.get('/batch', (req, res: Response) => {
  const symbols = req.query.symbols as string;

  if (!symbols) {
    res.status(400).json({ error: 'symbols query parameter required' });
    return;
  }

  const symbolList = symbols.split(',').map((s) => s.trim().toUpperCase());
  const quotes = quoteService.getQuotes(symbolList);
  res.json(quotes);
});

/**
 * GET /api/quotes/:symbol
 * Returns the current quote for a single stock symbol.
 * Includes stock name in response.
 */
router.get('/:symbol', (req, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  const quote = quoteService.getQuote(symbol);

  if (!quote) {
    res.status(404).json({ error: `Quote not found for ${symbol}` });
    return;
  }

  const stockInfo = quoteService.getStockInfo(symbol);

  res.json({
    ...quote,
    name: stockInfo?.name,
  });
});

/**
 * GET /api/quotes/:symbol/details
 * Returns extended stock details including quote and company information.
 * Requires authentication. In production, would fetch from financial API.
 */
router.get('/:symbol/details', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const symbol = (req.params.symbol as string).toUpperCase();
  const quote = quoteService.getQuote(symbol);
  const stockInfo = quoteService.getStockInfo(symbol);

  if (!quote || !stockInfo) {
    res.status(404).json({ error: `Stock not found: ${symbol}` });
    return;
  }

  // In a real app, this would fetch more data from a financial API
  res.json({
    symbol,
    name: stockInfo.name,
    quote,
    // Mock additional data
    marketCap: Math.round(quote.last * 1000000000 * Math.random() * 10),
    peRatio: 15 + Math.random() * 30,
    week52High: quote.last * (1 + Math.random() * 0.3),
    week52Low: quote.last * (1 - Math.random() * 0.3),
    avgVolume: quote.volume * 0.8,
    dividend: Math.random() > 0.5 ? (Math.random() * 3).toFixed(2) : null,
    description: `${stockInfo.name} is a publicly traded company.`,
  });
});

export default router;
