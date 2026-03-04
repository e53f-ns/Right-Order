/**
 * Orderbook types and interfaces
 */

import type { ExchangeId } from '../config/schema.js';

import type { Amount, Price, TimestampMs, TradingSymbol } from './branded.js';

/**
 * Single orderbook level (price, amount)
 */
export interface OrderbookLevel {
  price: Price;
  amount: Amount;
}

/**
 * Normalized orderbook data from an exchange
 */
export interface NormalizedOrderbook {
  exchange: ExchangeId;
  symbol: TradingSymbol;
  timestamp: TimestampMs; // Exchange timestamp
  receivedAt: TimestampMs; // Local receive timestamp
  bids: OrderbookLevel[]; // Sorted desc by price (best first)
  asks: OrderbookLevel[]; // Sorted asc by price (best first)
  nonce?: number; // Sequence number for updates
}

/**
 * Best bid/ask snapshot
 */
export interface BestPrices {
  exchange: ExchangeId;
  symbol: TradingSymbol;
  bestBid: Price;
  bestBidAmount: Amount;
  bestAsk: Price;
  bestAskAmount: Amount;
  timestamp: TimestampMs;
  spread: string; // Percentage spread
}

/**
 * Aggregated orderbook across multiple exchanges
 */
export interface AggregatedOrderbook {
  symbol: TradingSymbol;
  exchanges: Map<ExchangeId, NormalizedOrderbook>;
  bestBids: Map<ExchangeId, BestPrices>;
  bestAsks: Map<ExchangeId, BestPrices>;
  lastUpdate: TimestampMs;
}

/**
 * Orderbook update event
 */
export interface OrderbookUpdate {
  type: 'snapshot' | 'delta';
  exchange: ExchangeId;
  symbol: TradingSymbol;
  data: NormalizedOrderbook;
}

/**
 * Orderbook subscription status
 */
export interface SubscriptionStatus {
  exchange: ExchangeId;
  symbol: TradingSymbol;
  isSubscribed: boolean;
  lastUpdate: TimestampMs | null;
  errorCount: number;
  lastError: string | null;
}
