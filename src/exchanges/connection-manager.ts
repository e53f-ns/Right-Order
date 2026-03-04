/**
 * WebSocket connection manager for exchange orderbook streams
 * Handles connection lifecycle, reconnection, and orderbook normalization
 */

// Import CCXT with Pro support for WebSocket
import ccxt, { type Exchange } from 'ccxt';

import { EXCHANGE_CONFIGS } from '../config/exchanges.js';
import type { ExchangeId } from '../config/schema.js';
import { createPrice, createAmount, createTimestampMs } from '../types/branded.js';
import type { NormalizedOrderbook, TradingSymbol } from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import { calculateDelay } from '../utils/retry.js';
import { nowMs } from '../utils/time.js';

import {
  getCircuitBreakerManager,
  type CircuitBreakerManager,
  CircuitBreakerOpenError,
} from './circuit-breaker.js';
import { getRateLimiterManager, type RateLimiterManager } from './rate-limiter.js';
import type {
  ConnectionState,
  ConnectionEvent,
  ConnectionEventCallback,
  OrderbookUpdateCallback,
  ExchangeConnectionStatus,
  ExchangeCredentials,
  ConnectionManagerOptions,
  CcxtOrderbook,
} from './types.js';

const logger = createLogger('connection-manager');

/**
 * Set of symbols that are known to be unsupported on specific exchanges
 * Key: `${exchangeId}:${symbol}`
 */
const UNSUPPORTED_SYMBOLS = new Set<string>();

/**
 * Track symbol error counts for per-symbol reconnect limits
 * Key: `${exchangeId}:${symbol}`, Value: { count, lastError }
 */
const SYMBOL_ERROR_COUNTS = new Map<string, { count: number; lastError: number }>();

/**
 * Track exchange-level cooldowns after repeated failures
 * Key: exchangeId, Value: cooldown end timestamp
 */
const EXCHANGE_COOLDOWNS = new Map<ExchangeId, number>();

/**
 * Max reconnect attempts per symbol before cooldown
 */
const MAX_SYMBOL_RECONNECTS = 5;

/**
 * Cooldown duration after max reconnects (60 seconds)
 */
const RECONNECT_COOLDOWN_MS = 60000;

/**
 * Error patterns that indicate a symbol is permanently unsupported
 */
const UNSUPPORTED_SYMBOL_PATTERNS = [
  /does not currently offer subscription/i,
  /does not offer subscription/i,
  /symbol not found/i,
  /invalid symbol/i,
  /market not found/i,
  /no market/i,
  /unsupported symbol/i,
  /pair not available/i,
  /trading pair.*not supported/i,
  /not available for subscription/i,
];

/**
 * Error patterns that indicate connection issues (should reconnect)
 */
const CONNECTION_ERROR_PATTERNS = [
  /closedByUser/i,
  /connection closed/i,
  /websocket.*closed/i,
  /disconnected/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
];

/**
 * Error patterns that indicate exchange-level config issues (skip exchange)
 */
const EXCHANGE_CONFIG_ERROR_PATTERNS = [
  /requires.*apiKey.*credential/i,
  /requires.*secret.*credential/i,
  /authentication required/i,
  /api key required/i,
];

/**
 * Check if protobufjs is available (required for MEXC)
 */
function isProtobufAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('protobufjs');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if error indicates an unsupported symbol
 */
function isUnsupportedSymbolError(errorMsg: string): boolean {
  return UNSUPPORTED_SYMBOL_PATTERNS.some((pattern) => pattern.test(errorMsg));
}

/**
 * Check if error indicates a connection issue
 */
function isConnectionError(errorMsg: string): boolean {
  return CONNECTION_ERROR_PATTERNS.some((pattern) => pattern.test(errorMsg));
}

/**
 * Check if error indicates exchange config issue (e.g., missing API key)
 */
function isExchangeConfigError(errorMsg: string): boolean {
  return EXCHANGE_CONFIG_ERROR_PATTERNS.some((pattern) => pattern.test(errorMsg));
}

/**
 * Mark a symbol as unsupported for an exchange
 */
function markSymbolUnsupported(exchangeId: ExchangeId, symbol: string): void {
  const key = `${exchangeId}:${symbol}`;
  if (!UNSUPPORTED_SYMBOLS.has(key)) {
    UNSUPPORTED_SYMBOLS.add(key);
    logger.warn(
      { exchangeId, symbol },
      `Unsupported symbol ${symbol} on ${exchangeId}, will skip future subscriptions`
    );
  }
}

/**
 * Check if a symbol is marked as unsupported
 */
function isSymbolUnsupported(exchangeId: ExchangeId, symbol: string): boolean {
  return UNSUPPORTED_SYMBOLS.has(`${exchangeId}:${symbol}`);
}

/**
 * Track symbol error and check if cooldown is needed
 * Returns true if should skip (in cooldown)
 */
function trackSymbolError(exchangeId: ExchangeId, symbol: string): boolean {
  const key = `${exchangeId}:${symbol}`;
  const now = nowMs();
  
  const existing = SYMBOL_ERROR_COUNTS.get(key);
  
  if (existing !== undefined) {
    // Check if in cooldown
    if (existing.count >= MAX_SYMBOL_RECONNECTS) {
      const cooldownEnd = existing.lastError + RECONNECT_COOLDOWN_MS;
      if (now < cooldownEnd) {
        return true; // Still in cooldown
      }
      // Cooldown expired, reset count
      existing.count = 1;
      existing.lastError = now;
    } else {
      existing.count++;
      existing.lastError = now;
    }
  } else {
    SYMBOL_ERROR_COUNTS.set(key, { count: 1, lastError: now });
  }
  
  return false;
}

/**
 * Reset symbol error count (called on successful update)
 */
function resetSymbolErrors(exchangeId: ExchangeId, symbol: string): void {
  const key = `${exchangeId}:${symbol}`;
  SYMBOL_ERROR_COUNTS.delete(key);
}

/**
 * Set exchange-level cooldown
 */
function setExchangeCooldown(exchangeId: ExchangeId): void {
  const cooldownEnd = nowMs() + RECONNECT_COOLDOWN_MS;
  EXCHANGE_COOLDOWNS.set(exchangeId, cooldownEnd);
  logger.warn(
    { exchangeId, cooldownMs: RECONNECT_COOLDOWN_MS },
    `Exchange ${exchangeId} in cooldown for ${RECONNECT_COOLDOWN_MS / 1000}s after repeated failures`
  );
}

/**
 * Check if exchange is in cooldown
 */
function isExchangeInCooldown(exchangeId: ExchangeId): boolean {
  const cooldownEnd = EXCHANGE_COOLDOWNS.get(exchangeId);
  if (cooldownEnd === undefined) return false;
  
  if (nowMs() >= cooldownEnd) {
    EXCHANGE_COOLDOWNS.delete(exchangeId);
    return false;
  }
  return true;
}

/**
 * Supported CCXT Pro exchanges for WebSocket
 * Maps to ccxt.pro exchange classes
 */
const CCXT_PRO_EXCHANGES: Record<ExchangeId, string> = {
  // Original 11 exchanges
  binance: 'binance',
  bybit: 'bybit',
  okx: 'okx',
  kucoin: 'kucoin',
  gateio: 'gateio',
  mexc: 'mexc',
  htx: 'htx',
  bitget: 'bitget',
  coinbase: 'coinbaseexchange', // CCXT uses 'coinbaseexchange' for Coinbase Advanced/Pro
  kraken: 'kraken',
  bingx: 'bingx',
  // New exchanges (10 more)
  cryptocom: 'cryptocom',
  bitfinex: 'bitfinex',
  gemini: 'gemini',
  lbank: 'lbank',
  whitebit: 'whitebit',
  ascendex: 'ascendex',
  poloniex: 'poloniex',
  upbit: 'upbit',
  coinex: 'coinex',
  woo: 'woo',
  // Additional 6 exchanges → total 27
  bitmart: 'bitmart',
  phemex: 'phemex',
  p2b: 'p2b',
  exmo: 'exmo',
  bitstamp: 'bitstamp',
  bitrue: 'bitrue',
};

/**
 * Default WebSocket options for all exchanges
 * Using 15s ping interval, 30s pong timeout for stability
 */
const DEFAULT_WS_OPTIONS = {
  pingInterval: 15000,
  pongTimeout: 30000,
};

/**
 * Custom WS options for problematic exchanges
 * ascendex, bitget, bingx, kraken need faster ping to avoid timeout
 */
const FAST_PING_WS_OPTIONS = {
  pingInterval: 10000,
  pongTimeout: 20000,
};

/**
 * Reconnect delay after ping-pong timeout (15s)
 */
const PING_PONG_RECONNECT_DELAY_MS = 15000;

/**
 * Error patterns that indicate ping-pong timeout
 */
const PING_PONG_ERROR_PATTERNS = [
  /ping-pong keepalive missing/i,
  /ping.*timeout/i,
  /pong.*timeout/i,
  /keepalive.*timeout/i,
  /connection.*timed out/i,
];

/**
 * Check if error is a ping-pong timeout
 */
function isPingPongTimeout(errorMsg: string): boolean {
  return PING_PONG_ERROR_PATTERNS.some((pattern) => pattern.test(errorMsg));
}

/**
 * Exchange-specific configuration overrides
 * Fixes common issues with each exchange
 */
const EXCHANGE_SPECIFIC_CONFIG: Record<ExchangeId, Record<string, unknown>> = {
  binance: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true,
      recvWindow: 10000,
      ws: DEFAULT_WS_OPTIONS,
    },
  },
  bybit: {
    defaultType: 'spot',
    options: { 
      defaultType: 'spot',
      // Bybit needs longer ping to avoid closedByUser on many subscriptions
      ws: {
        pingInterval: 60000,
        pingTimeout: 45000,
      },
    },
  },
  okx: {
    defaultType: 'spot',
    options: { 
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },
  kucoin: {
    defaultType: 'spot',
    options: { 
      defaultType: 'spot',
      // KuCoin needs longer ping to avoid closedByUser
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },
  gateio: {
    defaultType: 'spot',
    options: { 
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },
  mexc: {
    defaultType: 'spot',
    options: { 
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },
  htx: {
    defaultType: 'spot',
    options: { 
      defaultType: 'spot',
      // HTX needs longer ping
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  bitget: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      broker: undefined,
      ws: FAST_PING_WS_OPTIONS, // Fast ping to avoid timeout
    },
  },

  coinbase: {
    // Coinbase Advanced Trade requires API keys for WS - skip if no credentials
    // Will be disabled if password credential error occurs
    apiKey: process.env['COINBASE_API_KEY'] ?? 'skip',
    secret: process.env['COINBASE_API_SECRET'] ?? 'skip',
    password: process.env['COINBASE_API_PASSWORD'] ?? 'skip',
    options: {
      ws: {
        pingInterval: 60000,
        pingTimeout: 45000,
      },
    },
  },

  kraken: {
    options: {
      ws: FAST_PING_WS_OPTIONS, // Fast ping to avoid timeout
    },
  },

  bingx: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: FAST_PING_WS_OPTIONS, // Fast ping to avoid timeout
    },
  },

  // =============================================
  // NEW EXCHANGES CONFIG
  // =============================================

  cryptocom: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true, // Crypto.com may have time sync issues
      ws: DEFAULT_WS_OPTIONS,
    },
  },

  bitfinex: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  gemini: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },

  lbank: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  whitebit: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },

  ascendex: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: FAST_PING_WS_OPTIONS, // Fast ping to avoid timeout
    },
  },

  poloniex: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  upbit: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      adjustForTimeDifference: true, // Upbit is Korean, may have time sync issues
      ws: {
        pingInterval: 45000, // Upbit may need longer intervals
        pingTimeout: 30000,
      },
    },
  },

  coinex: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },

  woo: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  // =============================================
  // ADDITIONAL 6 EXCHANGES CONFIG (total 27)
  // =============================================

  bitmart: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  phemex: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  p2b: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },

  exmo: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: {
        pingInterval: 30000,
        pingTimeout: 20000,
      },
    },
  },

  bitstamp: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },

  bitrue: {
    defaultType: 'spot',
    options: {
      defaultType: 'spot',
      ws: DEFAULT_WS_OPTIONS,
    },
  },
};

/**
 * Single exchange connection handler
 */
class ExchangeConnection {
  private readonly exchangeId: ExchangeId;
  private readonly options: ConnectionManagerOptions;
  private readonly rateLimiter: RateLimiterManager;
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly onOrderbookUpdate: OrderbookUpdateCallback;
  private readonly onConnectionEvent: ConnectionEventCallback;

  private exchange: Exchange | null = null;
  private state: ConnectionState = 'disconnected';
  private lastConnected: number | null = null;
  private lastDisconnected: number | null = null;
  private lastError: string | null = null;
  private errorCount = 0;
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  private readonly subscribedSymbols: Set<TradingSymbol> = new Set();
  private readonly watchLoops: Map<TradingSymbol, boolean> = new Map();
  private latencyMs: number | null = null;

  constructor(
    exchangeId: ExchangeId,
    options: ConnectionManagerOptions,
    credentials: ExchangeCredentials,
    onOrderbookUpdate: OrderbookUpdateCallback,
    onConnectionEvent: ConnectionEventCallback,
    rateLimiter: RateLimiterManager,
    circuitBreaker: CircuitBreakerManager
  ) {
    this.exchangeId = exchangeId;
    this.options = options;
    this.onOrderbookUpdate = onOrderbookUpdate;
    this.onConnectionEvent = onConnectionEvent;
    this.rateLimiter = rateLimiter;
    this.circuitBreaker = circuitBreaker;

    this.initExchange(credentials);
  }

  /**
   * Initialize CCXT Pro exchange instance for WebSocket support
   */
  private initExchange(credentials: ExchangeCredentials): void {
    const exchangeClass = CCXT_PRO_EXCHANGES[this.exchangeId];

    if (exchangeClass === undefined) {
      throw new Error(`Unsupported exchange: ${this.exchangeId}`);
    }

    // Check protobuf for MEXC
    if (this.exchangeId === 'mexc' && !isProtobufAvailable()) {
      logger.warn(
        { exchangeId: this.exchangeId },
        'MEXC requires protobufjs to decode WebSocket messages. Install with: npm install protobufjs'
      );
      throw new Error('MEXC requires protobufjs package for WebSocket support');
    }

    logger.info(
      { exchangeId: this.exchangeId, ccxtClass: exchangeClass },
      `Initializing ${this.exchangeId} (spot mode)`
    );

    // Get exchange class from ccxt.pro
    const ExchangeClass = ccxt.pro[exchangeClass as keyof typeof ccxt.pro] as
      | (new (config: Record<string, unknown>) => Exchange)
      | undefined;

    if (ExchangeClass === undefined || typeof ExchangeClass !== 'function') {
      throw new Error(`CCXT Pro exchange not found: ${exchangeClass}`);
    }

    // Base configuration
    const config: Record<string, unknown> = {
      enableRateLimit: true, // Let ccxt handle basic rate limiting
      timeout: 90000, // 90s timeout for slower exchanges
    };

    // Apply exchange-specific configuration (spot mode, etc.)
    const specificConfig = EXCHANGE_SPECIFIC_CONFIG[this.exchangeId];
    if (specificConfig !== undefined) {
      Object.assign(config, specificConfig);
    }

    // Add credentials if provided
    if (credentials.apiKey !== undefined) {
      config['apiKey'] = credentials.apiKey;
    }
    if (credentials.secret !== undefined) {
      config['secret'] = credentials.secret;
    }
    if (credentials.passphrase !== undefined) {
      config['password'] = credentials.passphrase;
    }

    // Enable sandbox if configured
    if (this.options.sandbox) {
      config['sandbox'] = true;
    }

    this.exchange = new ExchangeClass(config);

    logger.info(
      {
        exchangeId: this.exchangeId,
        sandbox: this.options.sandbox,
        hasCredentials: credentials.apiKey !== undefined,
        defaultType: config['defaultType'] ?? 'spot',
      },
      `${this.exchangeId} Pro instance initialized (spot mode)`
    );
  }

  /**
   * Connect to exchange
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    if (!this.circuitBreaker.isAllowed(this.exchangeId)) {
      throw new CircuitBreakerOpenError(
        `Circuit breaker open for ${this.exchangeId}`,
        this.exchangeId,
        this.circuitBreaker.getBreaker(this.exchangeId).getMetrics()
      );
    }

    this.setState('connecting');

    try {
      await this.rateLimiter.acquire(this.exchangeId);

      if (this.exchange === null) {
        throw new Error('Exchange not initialized');
      }

      // Load markets with retry (some exchanges need a second attempt)
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await this.exchange.loadMarkets();
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { exchangeId: this.exchangeId, attempt, error: msg },
            `loadMarkets attempt ${attempt}/2 failed for ${this.exchangeId}: ${msg}`
          );
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 5000)); // 5s before retry
          }
        }
      }
      if (lastErr) throw lastErr;

      this.setState('connected');
      this.lastConnected = nowMs();
      this.reconnectAttempts = 0;
      this.errorCount = 0;
      this.lastError = null;

      this.circuitBreaker.recordSuccess(this.exchangeId);

      this.emitEvent('connected');

      logger.info({ exchangeId: this.exchangeId }, `Exchange ${this.exchangeId} connected successfully`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { exchangeId: this.exchangeId, error: msg },
        `Exchange ${this.exchangeId} FAILED to connect: ${msg}`
      );
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Subscribe to orderbook updates for a symbol
   */
  subscribe(symbol: TradingSymbol): void {
    if (this.state !== 'connected') {
      throw new Error(`Cannot subscribe: ${this.exchangeId} not connected`);
    }

    // Check if symbol is known to be unsupported on this exchange
    if (isSymbolUnsupported(this.exchangeId, symbol)) {
      logger.debug(
        { exchangeId: this.exchangeId, symbol },
        'Skipping subscription: symbol marked as unsupported'
      );
      return;
    }

    if (this.subscribedSymbols.has(symbol)) {
      return; // Already subscribed
    }

    this.subscribedSymbols.add(symbol);
    this.watchLoops.set(symbol, true);

    this.emitEvent('subscription_added', { symbol });

    logger.info({ exchangeId: this.exchangeId, symbol }, 'Subscribed to orderbook');

    // Start watch loop for this symbol
    this.startWatchLoop(symbol);
  }

  /**
   * Unsubscribe from orderbook updates
   */
  unsubscribe(symbol: TradingSymbol): void {
    this.subscribedSymbols.delete(symbol);
    this.watchLoops.set(symbol, false);

    this.emitEvent('subscription_removed', { symbol });

    logger.info({ exchangeId: this.exchangeId, symbol }, 'Unsubscribed from orderbook');
  }

  /**
   * Start the watch loop for a symbol
   * Uses ccxt pro's streaming orderbook - watchOrderBook returns on each update
   */
  private startWatchLoop(symbol: TradingSymbol): void {
    logger.debug(
      { exchangeId: this.exchangeId, symbol },
      'Starting watch loop'
    );

    let updateCount = 0;
    let consecutiveErrors = 0;
    // Bitget needs reconnect after just 1 error due to closedByUser issues
    const MAX_CONSECUTIVE_ERRORS = this.exchangeId === 'bitget' ? 1 : 2;

    const watchLoop = async (): Promise<void> => {
      while (
        this.watchLoops.get(symbol) === true &&
        !this.isShuttingDown
      ) {
        // Check if symbol became unsupported
        if (isSymbolUnsupported(this.exchangeId, symbol)) {
          logger.debug(
            { exchangeId: this.exchangeId, symbol },
            'Watch loop stopping: symbol marked as unsupported'
          );
          this.subscribedSymbols.delete(symbol);
          this.watchLoops.set(symbol, false);
          break;
        }

        // Check if exchange is in cooldown after repeated failures
        if (isExchangeInCooldown(this.exchangeId)) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        // Check if we're still connected or reconnecting
        if (this.state !== 'connected' && this.state !== 'reconnecting') {
          logger.debug(
            { exchangeId: this.exchangeId, symbol, state: this.state },
            'Watch loop pausing: not connected'
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        try {
          if (this.exchange === null) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }

          // Don't use rate limiter for WebSocket streams - ccxt handles it internally
          const startTime = nowMs();
          // Some exchanges require specific orderbook depth values
          let depth: number | undefined = this.options.orderbookDepth;
          if (this.exchangeId === 'bitfinex') {
            depth = 25; // bitfinex only accepts undefined, 25, or 100
          } else if (this.exchangeId === 'bybit') {
            depth = 50; // bybit only accepts 1, 50, 200, or 1000
          }
          const orderbook = (await this.exchange.watchOrderBook(
            symbol,
            depth
          )) as CcxtOrderbook;
          this.latencyMs = nowMs() - startTime;

          updateCount++;
          consecutiveErrors = 0; // Reset on success
          resetSymbolErrors(this.exchangeId, symbol); // Reset per-symbol error tracking

          const normalized = this.normalizeOrderbook(symbol, orderbook);

          // Log first update and then periodically
          if (updateCount === 1 || updateCount % 500 === 0) {
            const bestBid = orderbook.bids[0];
            const bestAsk = orderbook.asks[0];
            logger.debug(
              {
                exchangeId: this.exchangeId,
                symbol,
                updateCount,
                latencyMs: this.latencyMs,
                bestBid: bestBid ? bestBid[0] : null,
                bestAsk: bestAsk ? bestAsk[0] : null,
                bidLevels: orderbook.bids.length,
                askLevels: orderbook.asks.length,
              },
              'Orderbook update'
            );
          }

          this.onOrderbookUpdate(normalized);

          // Record success but don't let it affect circuit breaker too much
          if (updateCount % 10 === 0) {
            this.circuitBreaker.recordSuccess(this.exchangeId);
          }
        } catch (error) {
          if (this.isShuttingDown) break;

          const errorMsg = error instanceof Error ? error.message : String(error);

          // Check if this symbol is permanently unsupported on this exchange
          if (isUnsupportedSymbolError(errorMsg)) {
            markSymbolUnsupported(this.exchangeId, symbol);
            logger.info(
              { exchangeId: this.exchangeId, symbol },
              `Unsupported symbol ${symbol} on ${this.exchangeId}`
            );
            this.subscribedSymbols.delete(symbol);
            this.watchLoops.set(symbol, false);
            break;
          }

          // Check for exchange config errors (e.g., missing API key for coinbase)
          if (isExchangeConfigError(errorMsg)) {
            logger.warn(
              { exchangeId: this.exchangeId, error: errorMsg },
              `Exchange ${this.exchangeId} requires configuration (API key?), skipping`
            );
            // Mark all symbols as unsupported for this exchange
            for (const sym of this.subscribedSymbols) {
              markSymbolUnsupported(this.exchangeId, sym);
            }
            setExchangeCooldown(this.exchangeId);
            this.subscribedSymbols.clear();
            this.watchLoops.clear();
            break;
          }

          consecutiveErrors++;

          // Track per-symbol errors with cooldown
          const inCooldown = trackSymbolError(this.exchangeId, symbol);
          if (inCooldown) {
            logger.debug(
              { exchangeId: this.exchangeId, symbol },
              'Symbol in cooldown after repeated errors'
            );
            await new Promise((resolve) => setTimeout(resolve, 10000));
            continue;
          }

          // Check for known error types
          const isRateLimit = errorMsg.includes('rate limit') || errorMsg.includes('429');
          const isConnError = isConnectionError(errorMsg);
          const isPingPong = isPingPongTimeout(errorMsg);

          // Log errors sparingly to avoid spam
          if (consecutiveErrors === 1) {
            logger.warn(
              {
                exchangeId: this.exchangeId,
                symbol,
                error: errorMsg.slice(0, 100), // Truncate long errors
                isConnectionError: isConnError,
                isPingPongTimeout: isPingPong,
              },
              isPingPong 
                ? `Ping-pong timeout on ${this.exchangeId}, reconnecting...`
                : 'Watch loop error'
            );
          }

          // Ping-pong timeout -> delayed reconnect with longer delay
          if (isPingPong) {
            logger.info(
              { exchangeId: this.exchangeId, symbol, delayMs: PING_PONG_RECONNECT_DELAY_MS },
              `Ping-pong timeout on ${this.exchangeId}, reconnecting after ${PING_PONG_RECONNECT_DELAY_MS / 1000}s...`
            );
            
            setTimeout(() => {
              if (!this.isShuttingDown && !isExchangeInCooldown(this.exchangeId)) {
                this.reconnect().catch(() => {
                  // Error logged in reconnect
                });
              }
            }, PING_PONG_RECONNECT_DELAY_MS);
            
            break;
          }

          // Connection errors (closedByUser, etc.) -> immediate reconnect
          if (isConnError && consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            // Check if we should set exchange-level cooldown
            if (this.reconnectAttempts >= MAX_SYMBOL_RECONNECTS) {
              setExchangeCooldown(this.exchangeId);
              break;
            }

            logger.debug(
              { exchangeId: this.exchangeId, symbol },
              'Connection error, triggering reconnect'
            );
            
            // Minimal delay for connection errors
            setTimeout(() => {
              if (!this.isShuttingDown && !isExchangeInCooldown(this.exchangeId)) {
                this.reconnect().catch(() => {
                  // Error logged in reconnect
                });
              }
            }, 500);
            
            break;
          }

          // Only record failure for serious errors, not rate limits
          if (!isRateLimit && consecutiveErrors >= 3) {
            this.circuitBreaker.recordFailure(
              this.exchangeId,
              error instanceof Error ? error : new Error(errorMsg)
            );
          }

          // If too many consecutive errors, try to reconnect
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            // Check for exchange-level cooldown
            if (this.reconnectAttempts >= MAX_SYMBOL_RECONNECTS) {
              setExchangeCooldown(this.exchangeId);
              break;
            }

            // Longer delay for problematic exchanges (15s for worst offenders)
            const veryProblematic = ['kraken', 'upbit', 'ascendex', 'poloniex'];
            const problematicExchanges = ['bingx', 'bitget', 'coinbase', 'bybit'];
            const baseDelay = veryProblematic.includes(this.exchangeId) ? 15000 
              : problematicExchanges.includes(this.exchangeId) ? 10000 : 3000;
            const reconnectDelay = baseDelay + Math.random() * 2000;
            
            setTimeout(() => {
              if (!this.isShuttingDown && !isExchangeInCooldown(this.exchangeId)) {
                this.reconnect().catch(() => {
                  // Error logged in reconnect
                });
              }
            }, reconnectDelay);
            
            break;
          }

          // If circuit breaker opened, exit
          if (!this.circuitBreaker.isAllowed(this.exchangeId)) {
            logger.debug(
              { exchangeId: this.exchangeId, symbol },
              'Watch loop stopped: circuit breaker open'
            );
            break;
          }

          // Short backoff on errors (faster recovery)
          const backoffMs = Math.min(500 * Math.pow(2, consecutiveErrors - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }

      logger.debug(
        { exchangeId: this.exchangeId, symbol, updateCount },
        'Watch loop ended'
      );
    };

    // Fire and forget - loop runs in background
    watchLoop().catch((error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        { exchangeId: this.exchangeId, symbol, error: errorMsg.slice(0, 100) },
        'Watch loop fatal error'
      );
    });
  }

  /**
   * Normalize CCXT orderbook to our format
   */
  private normalizeOrderbook(symbol: TradingSymbol, orderbook: CcxtOrderbook): NormalizedOrderbook {
    const now = nowMs();
    const timestamp = orderbook.timestamp ?? now;

    const normalized: NormalizedOrderbook = {
      exchange: this.exchangeId,
      symbol,
      timestamp: createTimestampMs(timestamp),
      receivedAt: createTimestampMs(now),
      bids: orderbook.bids.slice(0, this.options.orderbookDepth).map(([price, amount]) => ({
        price: createPrice(price),
        amount: createAmount(amount),
      })),
      asks: orderbook.asks.slice(0, this.options.orderbookDepth).map(([price, amount]) => ({
        price: createPrice(price),
        amount: createAmount(amount),
      })),
    };

    if (orderbook.nonce !== undefined) {
      normalized.nonce = orderbook.nonce;
    }

    return normalized;
  }

  /**
   * Handle connection errors
   */
  private handleError(error: unknown): void {
    this.errorCount++;
    this.lastError = error instanceof Error ? error.message : String(error);

    this.circuitBreaker.recordFailure(
      this.exchangeId,
      error instanceof Error ? error : new Error(String(error))
    );

    this.emitEvent('error', { error: this.lastError });

    // Attempt reconnection if not shutting down
    if (!this.isShuttingDown && this.state !== 'disconnected') {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      logger.error(
        {
          exchangeId: this.exchangeId,
          attempts: this.reconnectAttempts,
        },
        'Max reconnection attempts reached'
      );
      this.setState('error');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    const delay = calculateDelay(
      this.reconnectAttempts - 1,
      this.options.reconnectBaseDelayMs,
      this.options.reconnectMaxDelayMs,
      2,
      0.1
    );

    logger.info(
      {
        exchangeId: this.exchangeId,
        attempt: this.reconnectAttempts,
        delayMs: delay,
      },
      'Scheduling reconnection'
    );

    this.emitEvent('reconnecting', { attempt: this.reconnectAttempts, delayMs: delay });

    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.reconnect().catch((error) => {
          logger.error(
            {
              exchangeId: this.exchangeId,
              error: error instanceof Error ? error.message : String(error),
            },
            'Reconnection failed'
          );
        });
      }
    }, delay);
  }

  /**
   * Reconnect to exchange
   */
  private async reconnect(): Promise<void> {
    const symbolsToResubscribe = Array.from(this.subscribedSymbols);

    // Close existing connection safely
    try {
      await this.closeExchange();
    } catch (closeError) {
      logger.warn(
        {
          exchangeId: this.exchangeId,
          error: closeError instanceof Error ? closeError.message : String(closeError),
        },
        'Error during closeExchange in reconnect (ignored)'
      );
    }

    try {
      await this.connect();

      // Resubscribe to all symbols
      for (const symbol of symbolsToResubscribe) {
        this.subscribe(symbol);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Close exchange connection
   */
  private async closeExchange(): Promise<void> {
    if (this.exchange !== null) {
      try {
        await this.exchange.close();
      } catch (error) {
        logger.warn(
          {
            exchangeId: this.exchangeId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Error closing exchange'
        );
      }
    }
  }

  /**
   * Disconnect from exchange
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    // Stop all watch loops
    for (const symbol of this.watchLoops.keys()) {
      this.watchLoops.set(symbol, false);
    }

    await this.closeExchange();

    this.setState('disconnected');
    this.lastDisconnected = nowMs();
    this.subscribedSymbols.clear();

    this.emitEvent('disconnected');

    logger.info({ exchangeId: this.exchangeId }, 'Exchange disconnected');
  }

  /**
   * Set connection state
   */
  private setState(state: ConnectionState): void {
    this.state = state;
  }

  /**
   * Emit connection event
   */
  private emitEvent(type: ConnectionEvent['type'], data?: unknown): void {
    const event: ConnectionEvent = {
      type,
      exchangeId: this.exchangeId,
      timestamp: nowMs(),
    };

    if (data !== undefined) {
      event.data = data;
    }

    if (type === 'error' && data !== undefined) {
      const errorData = typeof data === 'object' && data !== null && 'error' in data
        ? (data as { error: unknown }).error
        : data;
      event.error = new Error(typeof errorData === 'string' ? errorData : JSON.stringify(errorData));
    }

    this.onConnectionEvent(event);
  }

  /**
   * Get the underlying ccxt Exchange instance (for symbol fetching etc.)
   */
  getExchangeInstance(): Exchange | null {
    return this.exchange;
  }

  /**
   * Get connection status
   */
  getStatus(): ExchangeConnectionStatus {
    return {
      exchangeId: this.exchangeId,
      state: this.state,
      isHealthy:
        this.state === 'connected' && this.circuitBreaker.isAllowed(this.exchangeId),
      lastConnected: this.lastConnected,
      lastDisconnected: this.lastDisconnected,
      lastError: this.lastError,
      errorCount: this.errorCount,
      reconnectAttempts: this.reconnectAttempts,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      latencyMs: this.latencyMs,
    };
  }
}

/**
 * Connection manager for all exchanges
 */
export class ConnectionManager {
  private readonly options: ConnectionManagerOptions;
  private readonly connections: Map<ExchangeId, ExchangeConnection> = new Map();
  private readonly rateLimiter: RateLimiterManager;
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly orderbookCallbacks: Set<OrderbookUpdateCallback> = new Set();
  private readonly eventCallbacks: Set<ConnectionEventCallback> = new Set();

  constructor(options: Partial<ConnectionManagerOptions> = {}) {
    const defaultOpts: ConnectionManagerOptions = {
      sandbox: false,
      maxReconnectAttempts: 5, // Reduced to avoid reconnect spam
      reconnectBaseDelayMs: 5000, // 5s base delay for stability
      reconnectMaxDelayMs: 60000, // 60s max delay
      pingIntervalMs: 60000, // 60s ping interval for stability
      maxOrderbookAgeMs: 2000,
      orderbookDepth: 20, // Increased depth for better slippage estimation
    };

    this.options = { ...defaultOpts, ...options };
    this.rateLimiter = getRateLimiterManager();
    this.circuitBreaker = getCircuitBreakerManager();
  }

  /**
   * Add orderbook update callback
   */
  onOrderbookUpdate(callback: OrderbookUpdateCallback): void {
    this.orderbookCallbacks.add(callback);
  }

  /**
   * Remove orderbook update callback
   */
  offOrderbookUpdate(callback: OrderbookUpdateCallback): void {
    this.orderbookCallbacks.delete(callback);
  }

  /**
   * Add connection event callback
   */
  onConnectionEvent(callback: ConnectionEventCallback): void {
    this.eventCallbacks.add(callback);
  }

  /**
   * Remove connection event callback
   */
  offConnectionEvent(callback: ConnectionEventCallback): void {
    this.eventCallbacks.delete(callback);
  }

  /**
   * Handle orderbook update from any connection
   */
  private handleOrderbookUpdate = (orderbook: NormalizedOrderbook): void => {
    for (const callback of this.orderbookCallbacks) {
      try {
        callback(orderbook);
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          'Error in orderbook callback'
        );
      }
    }
  };

  /**
   * Handle connection event from any connection
   */
  private handleConnectionEvent = (event: ConnectionEvent): void => {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          'Error in connection event callback'
        );
      }
    }
  };

  /**
   * Connect to an exchange
   */
  async connect(exchangeId: ExchangeId, credentials: ExchangeCredentials = {}): Promise<void> {
    const config = EXCHANGE_CONFIGS[exchangeId];

    if (!config.isEnabled) {
      throw new Error(`Exchange ${exchangeId} is not enabled`);
    }

    if (!config.hasWebSocket || !config.supportedFeatures.watchOrderBook) {
      throw new Error(`Exchange ${exchangeId} does not support WebSocket orderbook`);
    }

    let connection = this.connections.get(exchangeId);

    if (connection === undefined) {
      connection = new ExchangeConnection(
        exchangeId,
        this.options,
        credentials,
        this.handleOrderbookUpdate,
        this.handleConnectionEvent,
        this.rateLimiter,
        this.circuitBreaker
      );
      this.connections.set(exchangeId, connection);
    }

    await connection.connect();
  }

  /**
   * Connect to multiple exchanges with staggered initialization
   * Connects 3 exchanges at a time with 3000ms delay between batches
   */
  async connectAll(
    exchanges: ExchangeId[],
    credentials: Partial<Record<ExchangeId, ExchangeCredentials>> = {},
    options: { batchSize?: number; batchDelayMs?: number } = {}
  ): Promise<PromiseSettledResult<void>[]> {
    const { batchSize = 3, batchDelayMs = 5000 } = options;
    const results: PromiseSettledResult<void>[] = [];

    // New exchanges added beyond original 11 (16 total new exchanges)
    const newExchangesList = [
      'cryptocom', 'bitfinex', 'gemini', 'lbank', 'whitebit', 'ascendex', 'poloniex', 'upbit', 'coinex', 'woo',
      'bitmart', 'phemex', 'p2b', 'exmo', 'bitstamp', 'bitrue',
    ];

    logger.info(
      { 
        totalExchanges: exchanges.length, 
        batchSize, 
        batchDelayMs,
        newExchanges: exchanges.filter(e => newExchangesList.includes(e)),
      },
      `Starting staggered connection for ${exchanges.length} exchanges`
    );

    // Process exchanges in batches
    for (let i = 0; i < exchanges.length; i += batchSize) {
      const batch = exchanges.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(exchanges.length / batchSize);

      logger.debug(
        { batch, batchNum, totalBatches },
        `Connecting batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`
      );

      // Connect this batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map((exchangeId) =>
          this.connect(exchangeId, credentials[exchangeId] ?? {})
        )
      );

      results.push(...batchResults);

      // Log batch results
      const batchSuccess = batchResults.filter(r => r.status === 'fulfilled').length;
      logger.debug(
        { batchNum, success: batchSuccess, total: batch.length },
        `Batch ${batchNum} completed: ${batchSuccess}/${batch.length}`
      );

      // Delay before next batch (skip if last batch)
      if (i + batchSize < exchanges.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }

    const failedExchanges = exchanges.filter((_, i) => results[i]?.status === 'rejected');
    
    if (failedExchanges.length > 0) {
      logger.warn(
        {
          totalExchanges: exchanges.length,
          failedCount: failedExchanges.length,
          failedExchanges,
        },
        'Some exchanges failed to connect'
      );
    }

    // Identify new exchanges that connected successfully
    const connectedNewExchanges = exchanges.filter((e, i) => 
      newExchangesList.includes(e) && results[i]?.status === 'fulfilled'
    );

    if (connectedNewExchanges.length > 0) {
      logger.info(
        { newExchanges: connectedNewExchanges },
        `New exchanges added: ${connectedNewExchanges.join(', ')}`
      );
    }

    // Retry failed exchanges once after a delay
    if (failedExchanges.length > 0 && failedExchanges.length < exchanges.length) {
      logger.info(
        { retrying: failedExchanges },
        `Retrying ${failedExchanges.length} failed exchanges after 10s delay...`
      );
      await new Promise(resolve => setTimeout(resolve, 10000));

      for (const exchangeId of failedExchanges) {
        try {
          // Reset circuit breaker for retry
          this.circuitBreaker.getBreaker(exchangeId).reset();
          await this.connect(exchangeId, credentials[exchangeId] ?? {});
          logger.info({ exchangeId }, `Exchange ${exchangeId} connected on retry`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ exchangeId, error: msg }, `Exchange ${exchangeId} retry also failed: ${msg}`);
        }
        // Small delay between retries
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Recount after retries
    const finalConnected = this.getConnectedExchanges();
    const finalHealthy = this.getHealthyExchanges();

    // Log healthy status
    logger.info(
      {
        healthy: finalHealthy.length,
        connected: finalConnected.length,
        total: exchanges.length,
        healthyExchanges: finalHealthy,
        failed: exchanges.filter(e => !finalConnected.includes(e)),
      },
      `WS healthy: ${finalHealthy.length}/${exchanges.length} exchanges (connected: ${finalConnected.length})`
    );

    return results;
  }

  /**
   * Subscribe to orderbook for a symbol on an exchange
   */
  subscribe(exchangeId: ExchangeId, symbol: TradingSymbol): void {
    const connection = this.connections.get(exchangeId);

    if (connection === undefined) {
      throw new Error(`Exchange ${exchangeId} not connected`);
    }

    connection.subscribe(symbol);
  }

  /**
   * Subscribe to orderbook for a symbol on all connected exchanges
   */
  subscribeAll(symbol: TradingSymbol): void {
    for (const exchangeId of this.connections.keys()) {
      try {
        this.subscribe(exchangeId, symbol);
      } catch (error) {
        logger.warn(
          {
            exchangeId,
            symbol,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to subscribe on exchange'
        );
      }
    }
  }

  /**
   * Unsubscribe from orderbook
   */
  unsubscribe(exchangeId: ExchangeId, symbol: TradingSymbol): void {
    const connection = this.connections.get(exchangeId);

    if (connection !== undefined) {
      connection.unsubscribe(symbol);
    }
  }

  /**
   * Disconnect from an exchange
   */
  async disconnect(exchangeId: ExchangeId): Promise<void> {
    const connection = this.connections.get(exchangeId);

    if (connection !== undefined) {
      await connection.disconnect();
      this.connections.delete(exchangeId);
    }
  }

  /**
   * Disconnect from all exchanges
   */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.connections.keys()).map((exchangeId) => this.disconnect(exchangeId))
    );

    this.connections.clear();

    logger.info('All exchanges disconnected');
  }

  /**
   * Get connection status for an exchange
   */
  getStatus(exchangeId: ExchangeId): ExchangeConnectionStatus | undefined {
    return this.connections.get(exchangeId)?.getStatus();
  }

  /**
   * Get status for all connections
   */
  getAllStatus(): ExchangeConnectionStatus[] {
    return Array.from(this.connections.values()).map((conn) => conn.getStatus());
  }

  /**
   * Get list of healthy (connected) exchanges
   */
  getHealthyExchanges(): ExchangeId[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.getStatus().isHealthy)
      .map(([exchangeId]) => exchangeId);
  }

  /**
   * Get list of all connected exchanges (regardless of health)
   */
  getConnectedExchanges(): ExchangeId[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.getStatus().state === 'connected')
      .map(([exchangeId]) => exchangeId);
  }

  /**
   * Get total configured exchanges count
   */
  getTotalExchanges(): number {
    return this.connections.size;
  }

  /**
   * Log healthy exchanges status in requested format
   */
  logHealthyStatus(): void {
    const healthy = this.getHealthyExchanges();
    const connected = this.getConnectedExchanges();
    const total = this.getTotalExchanges();
    logger.info(
      { healthy: healthy.length, connected: connected.length, total, exchanges: healthy },
      `Healthy exchanges: ${healthy.length}/${total} (connected: ${connected.length})`
    );
  }

  /**
   * Get ccxt Exchange instances for all connected exchanges
   * Used to pass to symbol manager for dynamic symbol fetching
   */
  getExchangeInstances(): Map<ExchangeId, Exchange> {
    const instances = new Map<ExchangeId, Exchange>();
    for (const [exchangeId, conn] of this.connections) {
      const instance = conn.getExchangeInstance();
      if (instance !== null) {
        instances.set(exchangeId, instance);
      }
    }
    return instances;
  }

  /**
   * Check if an exchange is connected and healthy
   */
  isHealthy(exchangeId: ExchangeId): boolean {
    const status = this.getStatus(exchangeId);
    return status?.isHealthy ?? false;
  }
}

// Singleton instance
let connectionManager: ConnectionManager | null = null;

/**
 * Get the global connection manager
 */
export function getConnectionManager(
  options?: Partial<ConnectionManagerOptions>
): ConnectionManager {
  connectionManager ??= new ConnectionManager(options);
  return connectionManager;
}

/**
 * Get list of unsupported symbols for an exchange
 */
export function getUnsupportedSymbols(exchangeId?: ExchangeId): string[] {
  const result: string[] = [];
  for (const key of UNSUPPORTED_SYMBOLS) {
    if (exchangeId === undefined) {
      result.push(key);
    } else if (key.startsWith(`${exchangeId}:`)) {
      result.push(key.split(':')[1] ?? key);
    }
  }
  return result;
}

/**
 * Clear unsupported symbols cache (useful for testing)
 */
export function clearUnsupportedSymbols(): void {
  UNSUPPORTED_SYMBOLS.clear();
  logger.info('Cleared unsupported symbols cache');
}
