/**
 * Orderbook Aggregator
 * Collects and aggregates orderbooks from multiple exchanges for each symbol
 * Maintains a real-time view of best prices across all exchanges
 */

import type { ExchangeId } from '../config/schema.js';
import {
  createTimestampMs,
  nowTimestampMs,
  type TimestampMs,
  type TradingSymbol,
} from '../types/branded.js';
import type { AggregatedOrderbook, BestPrices, NormalizedOrderbook } from '../types/orderbook.js';
import { toDecimal, isGreaterThan, divide, subtract, multiply, toFixed } from '../utils/decimal.js';
import { createLogger } from '../utils/logger.js';
import { nowMs } from '../utils/time.js';

const logger = createLogger('orderbook-aggregator');

/**
 * Configuration for the orderbook aggregator
 */
export interface OrderbookAggregatorConfig {
  /** Maximum orderbook age before marking as stale (ms) */
  maxOrderbookAgeMs: number;
  /** Callback when aggregated data changes */
  onUpdate?: (symbol: TradingSymbol, aggregated: AggregatedOrderbook) => void;
}

const DEFAULT_CONFIG: OrderbookAggregatorConfig = {
  maxOrderbookAgeMs: 2000,
};

/**
 * Orderbook Aggregator
 * Thread-safe aggregation of orderbooks from multiple exchanges
 */
export class OrderbookAggregator {
  private readonly config: OrderbookAggregatorConfig;
  private readonly aggregatedBooks: Map<TradingSymbol, AggregatedOrderbook> = new Map();
  private readonly updateCallbacks: Set<
    (symbol: TradingSymbol, aggregated: AggregatedOrderbook) => void
  > = new Set();

  constructor(config: Partial<OrderbookAggregatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.onUpdate !== undefined) {
      this.updateCallbacks.add(this.config.onUpdate);
    }
  }

  /**
   * Process incoming orderbook update
   * Called by connection manager when new orderbook data arrives
   */
  processOrderbookUpdate(orderbook: NormalizedOrderbook): void {
    const { symbol, exchange } = orderbook;

    // Check orderbook freshness
    const now = nowMs();
    const orderbookTimestamp = Number(orderbook.timestamp);
    const receivedTimestamp = Number(orderbook.receivedAt);
    const ageMs = now - receivedTimestamp;
    const isFresh = ageMs <= this.config.maxOrderbookAgeMs;

    // Log freshness check (sample logging - every 100th update)
    this.updateCounter++;
    const shouldLog = this.updateCounter <= 10 || this.updateCounter % 500 === 0;

    if (shouldLog || !isFresh) {
      logger.debug(
        {
          symbol,
          exchange,
          ageMs,
          maxAge: this.config.maxOrderbookAgeMs,
          isFresh,
          orderbookTimestamp,
          receivedTimestamp,
          now,
        },
        isFresh 
          ? `Aggregator received fresh update for ${exchange} ${symbol}, age: ${ageMs}ms`
          : `⚠️ Aggregator received STALE update for ${exchange} ${symbol}, age: ${ageMs}ms`
      );
    }

    // Skip stale orderbooks completely - don't add them to aggregation
    if (!isFresh) {
      logger.warn(
        {
          symbol,
          exchange,
          ageMs,
          maxAge: this.config.maxOrderbookAgeMs,
        },
        `Skipping stale orderbook: ${exchange} ${symbol} age ${ageMs}ms > ${this.config.maxOrderbookAgeMs}ms`
      );
      return;
    }

    // Get or create aggregated orderbook for this symbol
    let aggregated = this.aggregatedBooks.get(symbol);

    if (aggregated === undefined) {
      aggregated = this.createEmptyAggregated(symbol);
      this.aggregatedBooks.set(symbol, aggregated);
    }

    // Update the exchange's orderbook
    aggregated.exchanges.set(exchange, orderbook);

    // Recalculate best prices for this exchange
    const bestPrices = this.calculateBestPrices(orderbook);

    if (bestPrices !== null) {
      aggregated.bestBids.set(exchange, bestPrices);
      aggregated.bestAsks.set(exchange, bestPrices);
    } else {
      // Remove stale/empty orderbook
      aggregated.bestBids.delete(exchange);
      aggregated.bestAsks.delete(exchange);
    }

    // Update last update timestamp
    aggregated.lastUpdate = nowTimestampMs();

    // Emit update event
    this.emitUpdate(symbol, aggregated);

    if (shouldLog) {
      logger.debug(
        {
          symbol,
          exchange,
          bidCount: orderbook.bids.length,
          askCount: orderbook.asks.length,
          bestBid: bestPrices?.bestBid,
          bestAsk: bestPrices?.bestAsk,
          totalExchanges: aggregated.exchanges.size,
        },
        'Orderbook updated and aggregated'
      );
    }
  }

  // Counter for sampling logs
  private updateCounter = 0;

  /**
   * Calculate best prices from an orderbook
   */
  private calculateBestPrices(orderbook: NormalizedOrderbook): BestPrices | null {
    if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
      return null;
    }

    const bestBidLevel = orderbook.bids[0];
    const bestAskLevel = orderbook.asks[0];

    if (bestBidLevel === undefined || bestAskLevel === undefined) {
      return null;
    }

    const bestBid = toDecimal(bestBidLevel.price);
    const bestAsk = toDecimal(bestAskLevel.price);

    // Calculate spread percentage
    const spread = divide(subtract(bestAsk, bestBid), bestBid);
    const spreadPercent = multiply(spread, 100);

    return {
      exchange: orderbook.exchange,
      symbol: orderbook.symbol,
      bestBid: bestBidLevel.price,
      bestBidAmount: bestBidLevel.amount,
      bestAsk: bestAskLevel.price,
      bestAskAmount: bestAskLevel.amount,
      timestamp: orderbook.timestamp,
      spread: toFixed(spreadPercent, 4),
    };
  }

  /**
   * Create empty aggregated orderbook structure
   */
  private createEmptyAggregated(symbol: TradingSymbol): AggregatedOrderbook {
    return {
      symbol,
      exchanges: new Map(),
      bestBids: new Map(),
      bestAsks: new Map(),
      lastUpdate: nowTimestampMs(),
    };
  }

  /**
   * Emit update to all registered callbacks
   */
  private emitUpdate(symbol: TradingSymbol, aggregated: AggregatedOrderbook): void {
    for (const callback of this.updateCallbacks) {
      try {
        callback(symbol, aggregated);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Error in orderbook update callback'
        );
      }
    }
  }

  /**
   * Add update callback
   */
  onUpdate(callback: (symbol: TradingSymbol, aggregated: AggregatedOrderbook) => void): void {
    this.updateCallbacks.add(callback);
  }

  /**
   * Remove update callback
   */
  offUpdate(callback: (symbol: TradingSymbol, aggregated: AggregatedOrderbook) => void): void {
    this.updateCallbacks.delete(callback);
  }

  /**
   * Get aggregated orderbook for a symbol
   */
  getAggregated(symbol: TradingSymbol): AggregatedOrderbook | undefined {
    return this.aggregatedBooks.get(symbol);
  }

  /**
   * Get all aggregated orderbooks
   */
  getAllAggregated(): Map<TradingSymbol, AggregatedOrderbook> {
    return this.aggregatedBooks;
  }

  /**
   * Get best bid across all exchanges for a symbol
   */
  getBestBid(symbol: TradingSymbol): { exchange: ExchangeId; prices: BestPrices } | null {
    const aggregated = this.aggregatedBooks.get(symbol);

    if (aggregated === undefined) {
      return null;
    }

    let bestExchange: ExchangeId | null = null;
    let bestPrices: BestPrices | null = null;

    for (const [exchange, prices] of aggregated.bestBids) {
      if (!this.isStale(prices.timestamp)) {
        if (bestPrices === null || isGreaterThan(prices.bestBid, bestPrices.bestBid)) {
          bestExchange = exchange;
          bestPrices = prices;
        }
      }
    }

    if (bestExchange === null || bestPrices === null) {
      return null;
    }

    return { exchange: bestExchange, prices: bestPrices };
  }

  /**
   * Get best ask (lowest) across all exchanges for a symbol
   */
  getBestAsk(symbol: TradingSymbol): { exchange: ExchangeId; prices: BestPrices } | null {
    const aggregated = this.aggregatedBooks.get(symbol);

    if (aggregated === undefined) {
      return null;
    }

    let bestExchange: ExchangeId | null = null;
    let bestPrices: BestPrices | null = null;

    for (const [exchange, prices] of aggregated.bestAsks) {
      if (!this.isStale(prices.timestamp)) {
        // Best ask = lowest ask
        if (bestPrices === null || isGreaterThan(bestPrices.bestAsk, prices.bestAsk)) {
          bestExchange = exchange;
          bestPrices = prices;
        }
      }
    }

    if (bestExchange === null || bestPrices === null) {
      return null;
    }

    return { exchange: bestExchange, prices: bestPrices };
  }

  /**
   * Get fresh orderbooks for a symbol (non-stale)
   */
  getFreshOrderbooks(
    symbol: TradingSymbol
  ): { exchange: ExchangeId; orderbook: NormalizedOrderbook; age: number }[] {
    const aggregated = this.aggregatedBooks.get(symbol);

    if (aggregated === undefined) {
      return [];
    }

    const now = nowMs();
    const fresh: { exchange: ExchangeId; orderbook: NormalizedOrderbook; age: number }[] = [];

    for (const [exchange, orderbook] of aggregated.exchanges) {
      const age = now - orderbook.receivedAt;

      if (age <= this.config.maxOrderbookAgeMs) {
        fresh.push({ exchange, orderbook, age });
      }
    }

    return fresh;
  }

  /**
   * Check if a timestamp is stale
   */
  isStale(timestamp: TimestampMs): boolean {
    const age = nowMs() - timestamp;
    return age > this.config.maxOrderbookAgeMs;
  }

  /**
   * Get orderbook age in milliseconds
   */
  getOrderbookAge(orderbook: NormalizedOrderbook): number {
    return nowMs() - orderbook.receivedAt;
  }

  /**
   * Remove stale orderbooks from aggregation
   * Call periodically to clean up
   */
  cleanupStaleOrderbooks(): number {
    let cleanedCount = 0;
    const now = nowMs();

    for (const [symbol, aggregated] of this.aggregatedBooks) {
      for (const [exchange, orderbook] of aggregated.exchanges) {
        if (now - orderbook.receivedAt > this.config.maxOrderbookAgeMs) {
          aggregated.exchanges.delete(exchange);
          aggregated.bestBids.delete(exchange);
          aggregated.bestAsks.delete(exchange);
          cleanedCount++;

          logger.debug(
            {
              symbol,
              exchange,
              age: now - orderbook.receivedAt,
            },
            'Removed stale orderbook'
          );
        }
      }

      // Remove empty aggregated entries
      if (aggregated.exchanges.size === 0) {
        this.aggregatedBooks.delete(symbol);
      }
    }

    return cleanedCount;
  }

  /**
   * Get active exchanges for a symbol (have fresh orderbook)
   */
  getActiveExchanges(symbol: TradingSymbol): ExchangeId[] {
    const aggregated = this.aggregatedBooks.get(symbol);

    if (aggregated === undefined) {
      return [];
    }

    const activeExchanges: ExchangeId[] = [];

    for (const [exchange, orderbook] of aggregated.exchanges) {
      if (!this.isStale(createTimestampMs(orderbook.receivedAt))) {
        activeExchanges.push(exchange);
      }
    }

    return activeExchanges;
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    totalSymbols: number;
    totalExchangeOrderbooks: number;
    staleOrderbooks: number;
    symbolStats: Array<{
      symbol: TradingSymbol;
      exchangeCount: number;
      freshCount: number;
    }>;
  } {
    let totalExchangeOrderbooks = 0;
    let staleOrderbooks = 0;
    const symbolStats: Array<{
      symbol: TradingSymbol;
      exchangeCount: number;
      freshCount: number;
    }> = [];

    for (const [symbol, aggregated] of this.aggregatedBooks) {
      let freshCount = 0;

      for (const orderbook of aggregated.exchanges.values()) {
        totalExchangeOrderbooks++;

        if (!this.isStale(createTimestampMs(orderbook.receivedAt))) {
          freshCount++;
        } else {
          staleOrderbooks++;
        }
      }

      symbolStats.push({
        symbol,
        exchangeCount: aggregated.exchanges.size,
        freshCount,
      });
    }

    return {
      totalSymbols: this.aggregatedBooks.size,
      totalExchangeOrderbooks,
      staleOrderbooks,
      symbolStats,
    };
  }

  /**
   * Clear all aggregated data
   */
  clear(): void {
    this.aggregatedBooks.clear();
    logger.info('All aggregated orderbooks cleared');
  }
}

// Singleton instance
let aggregatorInstance: OrderbookAggregator | null = null;

/**
 * Get the global orderbook aggregator
 */
export function getOrderbookAggregator(
  config?: Partial<OrderbookAggregatorConfig>
): OrderbookAggregator {
  aggregatorInstance ??= new OrderbookAggregator(config);
  return aggregatorInstance;
}

/**
 * Reset the global orderbook aggregator (mainly for testing)
 */
export function resetOrderbookAggregator(): void {
  aggregatorInstance = null;
}
