/**
 * Exchange layer types and interfaces
 */

import type { ExchangeId } from '../config/schema.js';
import type { NormalizedOrderbook, TradingSymbol } from '../types/index.js';

/**
 * WebSocket connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Connection event types
 */
export type ConnectionEventType =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'orderbook_update'
  | 'subscription_added'
  | 'subscription_removed';

/**
 * Connection event payload
 */
export interface ConnectionEvent {
  type: ConnectionEventType;
  exchangeId: ExchangeId;
  timestamp: number;
  data?: unknown;
  error?: Error;
}

/**
 * Orderbook update callback
 */
export type OrderbookUpdateCallback = (orderbook: NormalizedOrderbook) => void;

/**
 * Connection event callback
 */
export type ConnectionEventCallback = (event: ConnectionEvent) => void;

/**
 * Exchange connection status
 */
export interface ExchangeConnectionStatus {
  exchangeId: ExchangeId;
  state: ConnectionState;
  isHealthy: boolean;
  lastConnected: number | null;
  lastDisconnected: number | null;
  lastError: string | null;
  errorCount: number;
  reconnectAttempts: number;
  subscribedSymbols: TradingSymbol[];
  latencyMs: number | null;
}

/**
 * Subscription request
 */
export interface SubscriptionRequest {
  exchangeId: ExchangeId;
  symbol: TradingSymbol;
  type: 'orderbook';
}

/**
 * Rate limiter token request
 */
export interface TokenRequest {
  exchangeId: ExchangeId;
  tokens: number;
  priority?: 'high' | 'normal' | 'low';
}

/**
 * Rate limiter status
 */
export interface RateLimiterStatus {
  exchangeId: ExchangeId;
  availableTokens: number;
  maxTokens: number;
  refillRate: number; // tokens per second
  lastRefill: number;
  queuedRequests: number;
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  exchangeId: ExchangeId;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  successCount: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  lastStateChange: number;
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * Connection manager options
 */
export interface ConnectionManagerOptions {
  /** Enable sandbox/testnet mode */
  sandbox: boolean;
  /** Maximum reconnection attempts per exchange */
  maxReconnectAttempts: number;
  /** Base delay for reconnection (ms) */
  reconnectBaseDelayMs: number;
  /** Maximum delay for reconnection (ms) */
  reconnectMaxDelayMs: number;
  /** Ping interval to check connection health (ms) */
  pingIntervalMs: number;
  /** Maximum orderbook age before considering stale (ms) */
  maxOrderbookAgeMs: number;
  /** Default orderbook depth to request */
  orderbookDepth: number;
}

/**
 * Default connection manager options
 */
export const DEFAULT_CONNECTION_OPTIONS: ConnectionManagerOptions = {
  sandbox: false,
  maxReconnectAttempts: 10,
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  pingIntervalMs: 30000,
  maxOrderbookAgeMs: 2000,
  orderbookDepth: 10,
};

/**
 * Exchange API credentials
 */
export interface ExchangeCredentials {
  apiKey?: string;
  secret?: string;
  passphrase?: string; // For OKX, KuCoin
}

/**
 * CCXT exchange instance type (minimal interface)
 */
export interface CcxtExchange {
  id: string;
  name: string;
  has: Record<string, boolean | string>;
  loadMarkets: () => Promise<unknown>;
  watchOrderBook: (symbol: string, limit?: number) => Promise<CcxtOrderbook>;
  close: () => Promise<void>;
}

/**
 * CCXT orderbook structure
 */
export interface CcxtOrderbook {
  symbol: string;
  timestamp: number | undefined;
  datetime: string | undefined;
  nonce: number | undefined;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}
