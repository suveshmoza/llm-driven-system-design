export interface OrderBookEntry {
  orderId: string;
  userId: string;
  price: number;
  quantity: number;
  remainingQuantity: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface MatchResult {
  buyOrderId: string;
  sellOrderId: string;
  buyUserId: string;
  sellUserId: string;
  price: number;
  quantity: number;
}

/** In-memory order book with price-time priority matching for a single trading pair. */
class OrderBook {
  private bids: OrderBookEntry[] = []; // sorted by price DESC, then time ASC
  private asks: OrderBookEntry[] = []; // sorted by price ASC, then time ASC

  /** Adds an order to the appropriate side of the book in sorted position. */
  addOrder(entry: OrderBookEntry): void {
    if (entry.side === 'buy') {
      this.insertBid(entry);
    } else {
      this.insertAsk(entry);
    }
  }

  private insertBid(entry: OrderBookEntry): void {
    let insertIndex = this.bids.length;
    for (let i = 0; i < this.bids.length; i++) {
      if (
        entry.price > this.bids[i].price ||
        (entry.price === this.bids[i].price && entry.timestamp < this.bids[i].timestamp)
      ) {
        insertIndex = i;
        break;
      }
    }
    this.bids.splice(insertIndex, 0, entry);
  }

  private insertAsk(entry: OrderBookEntry): void {
    let insertIndex = this.asks.length;
    for (let i = 0; i < this.asks.length; i++) {
      if (
        entry.price < this.asks[i].price ||
        (entry.price === this.asks[i].price && entry.timestamp < this.asks[i].timestamp)
      ) {
        insertIndex = i;
        break;
      }
    }
    this.asks.splice(insertIndex, 0, entry);
  }

  /** Removes an order from the book by ID. Returns true if found and removed. */
  removeOrder(orderId: string): boolean {
    let idx = this.bids.findIndex((o) => o.orderId === orderId);
    if (idx !== -1) {
      this.bids.splice(idx, 1);
      return true;
    }
    idx = this.asks.findIndex((o) => o.orderId === orderId);
    if (idx !== -1) {
      this.asks.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Matches crossing orders using price-time priority and returns executed matches. */
  matchOrders(): MatchResult[] {
    const matches: MatchResult[] = [];

    while (this.bids.length > 0 && this.asks.length > 0) {
      const bestBid = this.bids[0];
      const bestAsk = this.asks[0];

      if (bestBid.price < bestAsk.price) {
        break; // No match possible
      }

      // Match at the earlier order's price (price-time priority)
      const matchPrice =
        bestBid.timestamp <= bestAsk.timestamp ? bestBid.price : bestAsk.price;
      const matchQty = Math.min(bestBid.remainingQuantity, bestAsk.remainingQuantity);

      matches.push({
        buyOrderId: bestBid.orderId,
        sellOrderId: bestAsk.orderId,
        buyUserId: bestBid.userId,
        sellUserId: bestAsk.userId,
        price: matchPrice,
        quantity: matchQty,
      });

      bestBid.remainingQuantity -= matchQty;
      bestAsk.remainingQuantity -= matchQty;

      if (bestBid.remainingQuantity <= 0) {
        this.bids.shift();
      }
      if (bestAsk.remainingQuantity <= 0) {
        this.asks.shift();
      }
    }

    return matches;
  }

  /** Returns aggregated bid and ask price levels for order book visualization. */
  getDepth(levels: number = 20): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
    return {
      bids: this.aggregateLevels(this.bids, levels),
      asks: this.aggregateLevels(this.asks, levels),
    };
  }

  private aggregateLevels(orders: OrderBookEntry[], maxLevels: number): OrderBookLevel[] {
    const levelMap = new Map<number, { quantity: number; orderCount: number }>();

    for (const order of orders) {
      const existing = levelMap.get(order.price);
      if (existing) {
        existing.quantity += order.remainingQuantity;
        existing.orderCount += 1;
      } else {
        levelMap.set(order.price, {
          quantity: order.remainingQuantity,
          orderCount: 1,
        });
      }
    }

    const levels: OrderBookLevel[] = [];
    for (const [price, data] of levelMap) {
      levels.push({
        price,
        quantity: data.quantity,
        orderCount: data.orderCount,
      });
      if (levels.length >= maxLevels) break;
    }

    return levels;
  }

  /** Returns the highest bid price, or null if no bids. */
  getBestBid(): number | null {
    return this.bids.length > 0 ? this.bids[0].price : null;
  }

  /** Returns the lowest ask price, or null if no asks. */
  getBestAsk(): number | null {
    return this.asks.length > 0 ? this.asks[0].price : null;
  }

  /** Returns the spread between best ask and best bid, or null if either side is empty. */
  getSpread(): number | null {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    if (bestBid !== null && bestAsk !== null) {
      return bestAsk - bestBid;
    }
    return null;
  }

  getBidCount(): number {
    return this.bids.length;
  }

  getAskCount(): number {
    return this.asks.length;
  }
}

/** Manages order books for all trading pairs. */
class OrderBookManager {
  private books: Map<string, OrderBook> = new Map();

  getBook(tradingPairSymbol: string): OrderBook {
    let book = this.books.get(tradingPairSymbol);
    if (!book) {
      book = new OrderBook();
      this.books.set(tradingPairSymbol, book);
    }
    return book;
  }

  getAllBooks(): Map<string, OrderBook> {
    return this.books;
  }
}

/** Singleton order book manager shared across the application. */
export const orderBookManager = new OrderBookManager();
