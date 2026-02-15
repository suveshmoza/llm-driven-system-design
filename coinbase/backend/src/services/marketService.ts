interface PriceData {
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

interface CandleState {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: Date;
}

const BASE_PRICES: Record<string, number> = {
  'BTC-USD': 65000,
  'ETH-USD': 3500,
  'SOL-USD': 150,
  'DOGE-USD': 0.15,
  'ADA-USD': 0.65,
  'DOT-USD': 8.5,
  'AVAX-USD': 38,
  'LINK-USD': 15,
  'MATIC-USD': 0.85,
  'XRP-USD': 0.62,
  'ETH-BTC': 0.054,
  'SOL-ETH': 0.043,
};

const VOLATILITY: Record<string, number> = {
  'BTC-USD': 0.015,
  'ETH-USD': 0.02,
  'SOL-USD': 0.035,
  'DOGE-USD': 0.05,
  'ADA-USD': 0.03,
  'DOT-USD': 0.03,
  'AVAX-USD': 0.03,
  'LINK-USD': 0.025,
  'MATIC-USD': 0.035,
  'XRP-USD': 0.025,
  'ETH-BTC': 0.015,
  'SOL-ETH': 0.03,
};

/** Simulated market price engine using Geometric Brownian Motion with per-pair volatility. */
class MarketService {
  private prices: Map<string, number> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  private candles: Map<string, CandleState> = new Map();
  private volumes: Map<string, number> = new Map();
  private highs24h: Map<string, number> = new Map();
  private lows24h: Map<string, number> = new Map();
  private openPrices24h: Map<string, number> = new Map();

  constructor() {
    for (const [symbol, basePrice] of Object.entries(BASE_PRICES)) {
      // Add some random offset so prices aren't always exact base
      const offset = basePrice * (Math.random() * 0.04 - 0.02);
      const price = basePrice + offset;
      this.prices.set(symbol, price);
      this.priceHistory.set(symbol, [price]);
      this.volumes.set(symbol, Math.random() * 1000000);
      this.highs24h.set(symbol, price * 1.02);
      this.lows24h.set(symbol, price * 0.98);
      this.openPrices24h.set(symbol, price * (1 + (Math.random() * 0.04 - 0.02)));

      // Initialize current candle
      this.candles.set(symbol, {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        openTime: this.getCurrentMinuteStart(),
      });
    }
  }

  private getCurrentMinuteStart(): Date {
    const now = new Date();
    now.setSeconds(0, 0);
    return now;
  }

  private gaussianRandom(): number {
    // Box-Muller transform
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /** Simulates a price tick using Geometric Brownian Motion and updates candle data. */
  simulatePriceTick(symbol: string): PriceData | null {
    const currentPrice = this.prices.get(symbol);
    if (currentPrice === undefined) return null;

    const sigma = VOLATILITY[symbol] || 0.02;
    const mu = 0.0001; // Slight upward drift
    const dt = 2 / 86400; // 2 seconds in days
    const Z = this.gaussianRandom();

    // Geometric Brownian Motion
    const newPrice =
      currentPrice * Math.exp((mu - (sigma * sigma) / 2) * dt + sigma * Math.sqrt(dt) * Z);

    // Clamp to prevent extreme values
    const minPrice = (BASE_PRICES[symbol] || currentPrice) * 0.5;
    const maxPrice = (BASE_PRICES[symbol] || currentPrice) * 2.0;
    const clampedPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));

    this.prices.set(symbol, clampedPrice);

    // Update history (keep last 1000 ticks)
    const history = this.priceHistory.get(symbol) || [];
    history.push(clampedPrice);
    if (history.length > 1000) history.shift();
    this.priceHistory.set(symbol, history);

    // Update volume
    const vol = this.volumes.get(symbol) || 0;
    const tradeVol = Math.random() * currentPrice * 10;
    this.volumes.set(symbol, vol + tradeVol);

    // Update 24h high/low
    const high = this.highs24h.get(symbol) || clampedPrice;
    const low = this.lows24h.get(symbol) || clampedPrice;
    if (clampedPrice > high) this.highs24h.set(symbol, clampedPrice);
    if (clampedPrice < low) this.lows24h.set(symbol, clampedPrice);

    // Update candle
    const candle = this.candles.get(symbol);
    const currentMinute = this.getCurrentMinuteStart();
    if (candle && candle.openTime.getTime() === currentMinute.getTime()) {
      candle.close = clampedPrice;
      if (clampedPrice > candle.high) candle.high = clampedPrice;
      if (clampedPrice < candle.low) candle.low = clampedPrice;
      candle.volume += tradeVol;
    } else {
      // New candle
      this.candles.set(symbol, {
        open: clampedPrice,
        high: clampedPrice,
        low: clampedPrice,
        close: clampedPrice,
        volume: tradeVol,
        openTime: currentMinute,
      });
    }

    const openPrice24h = this.openPrices24h.get(symbol) || clampedPrice;
    const change24h = clampedPrice - openPrice24h;
    const changePercent24h = (change24h / openPrice24h) * 100;

    return {
      price: clampedPrice,
      change24h,
      changePercent24h,
      volume24h: this.volumes.get(symbol) || 0,
      high24h: this.highs24h.get(symbol) || clampedPrice,
      low24h: this.lows24h.get(symbol) || clampedPrice,
    };
  }

  /** Returns the current price for a symbol, or undefined if not tracked. */
  getCurrentPrice(symbol: string): number | undefined {
    return this.prices.get(symbol);
  }

  /** Returns full price data including 24h change and volume for a symbol. */
  getPriceData(symbol: string): PriceData | null {
    const price = this.prices.get(symbol);
    if (price === undefined) return null;

    const openPrice24h = this.openPrices24h.get(symbol) || price;
    const change24h = price - openPrice24h;
    const changePercent24h = (change24h / openPrice24h) * 100;

    return {
      price,
      change24h,
      changePercent24h,
      volume24h: this.volumes.get(symbol) || 0,
      high24h: this.highs24h.get(symbol) || price,
      low24h: this.lows24h.get(symbol) || price,
    };
  }

  /** Returns price data for all tracked trading pairs. */
  getAllPrices(): Map<string, PriceData> {
    const result = new Map<string, PriceData>();
    for (const symbol of this.prices.keys()) {
      const data = this.getPriceData(symbol);
      if (data) result.set(symbol, data);
    }
    return result;
  }

  /** Returns the current in-progress candle for a symbol. */
  getCurrentCandle(symbol: string): CandleState | undefined {
    return this.candles.get(symbol);
  }

  /** Returns the most recently completed candle, or null if current candle is still open. */
  getCompletedCandle(symbol: string): CandleState | null {
    const candle = this.candles.get(symbol);
    if (!candle) return null;

    const currentMinute = this.getCurrentMinuteStart();
    if (candle.openTime.getTime() < currentMinute.getTime()) {
      return candle;
    }
    return null;
  }

  /** Returns all tracked trading pair symbols. */
  getAllSymbols(): string[] {
    return Array.from(this.prices.keys());
  }

  /** Updates the market price from an executed trade and adjusts 24h high/low. */
  updatePriceFromTrade(symbol: string, price: number, volume: number): void {
    this.prices.set(symbol, price);

    const vol = this.volumes.get(symbol) || 0;
    this.volumes.set(symbol, vol + volume);

    const high = this.highs24h.get(symbol) || price;
    const low = this.lows24h.get(symbol) || price;
    if (price > high) this.highs24h.set(symbol, price);
    if (price < low) this.lows24h.set(symbol, price);
  }
}

/** Singleton market service instance shared across the application. */
export const marketService = new MarketService();
