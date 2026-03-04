/**
 * Zod schemas for configuration validation
 * All environment variables and config structures are validated here
 */

import { z } from 'zod';

// ===========================================
// Environment Variables Schema
// ===========================================

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),

  // Exchange API keys (optional for scan-only mode)
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_SECRET: z.string().optional(),

  BYBIT_API_KEY: z.string().optional(),
  BYBIT_SECRET: z.string().optional(),

  OKX_API_KEY: z.string().optional(),
  OKX_SECRET: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),

  KUCOIN_API_KEY: z.string().optional(),
  KUCOIN_SECRET: z.string().optional(),
  KUCOIN_PASSPHRASE: z.string().optional(),

  GATEIO_API_KEY: z.string().optional(),
  GATEIO_SECRET: z.string().optional(),

  MEXC_API_KEY: z.string().optional(),
  MEXC_SECRET: z.string().optional(),

  HTX_API_KEY: z.string().optional(),
  HTX_SECRET: z.string().optional(),

  BITGET_API_KEY: z.string().optional(),
  BITGET_SECRET: z.string().optional(),
  BITGET_PASSPHRASE: z.string().optional(),

  COINBASE_API_KEY: z.string().optional(),
  COINBASE_SECRET: z.string().optional(),

  KRAKEN_API_KEY: z.string().optional(),
  KRAKEN_SECRET: z.string().optional(),

  BINGX_API_KEY: z.string().optional(),
  BINGX_SECRET: z.string().optional(),

  // New exchanges (8 more)
  CRYPTOCOM_API_KEY: z.string().optional(),
  CRYPTOCOM_SECRET: z.string().optional(),

  BITFINEX_API_KEY: z.string().optional(),
  BITFINEX_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_SECRET: z.string().optional(),

  LBANK_API_KEY: z.string().optional(),
  LBANK_SECRET: z.string().optional(),

  WHITEBIT_API_KEY: z.string().optional(),
  WHITEBIT_SECRET: z.string().optional(),

  ASCENDEX_API_KEY: z.string().optional(),
  ASCENDEX_SECRET: z.string().optional(),

  POLONIEX_API_KEY: z.string().optional(),
  POLONIEX_SECRET: z.string().optional(),

  UPBIT_API_KEY: z.string().optional(),
  UPBIT_SECRET: z.string().optional(),

  COINEX_API_KEY: z.string().optional(),
  COINEX_SECRET: z.string().optional(),

  WOO_API_KEY: z.string().optional(),
  WOO_SECRET: z.string().optional(),

  // New exchanges (6 more → total 27)
  BITMART_API_KEY: z.string().optional(),
  BITMART_SECRET: z.string().optional(),

  PHEMEX_API_KEY: z.string().optional(),
  PHEMEX_SECRET: z.string().optional(),

  P2B_API_KEY: z.string().optional(),
  P2B_SECRET: z.string().optional(),

  EXMO_API_KEY: z.string().optional(),
  EXMO_SECRET: z.string().optional(),

  BITSTAMP_API_KEY: z.string().optional(),
  BITSTAMP_SECRET: z.string().optional(),

  BITRUE_API_KEY: z.string().optional(),
  BITRUE_SECRET: z.string().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Trading parameters
  MIN_PROFIT_THRESHOLD: z
    .string()
    .transform((v) => parseFloat(v))
    .pipe(z.number().min(-1).max(10))
    .default('0.05'),

  TRADE_SIZE_USD: z
    .string()
    .transform((v) => parseFloat(v))
    .pipe(z.number().min(1).max(1000000))
    .default('1000'),

  MAX_ORDERBOOK_AGE_MS: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().min(100).max(30000))
    .default('15000'),

  SLIPPAGE_MULTIPLIER: z
    .string()
    .transform((v) => parseFloat(v))
    .pipe(z.number().min(0.5).max(5))
    .default('1.0'),

  MAX_EXECUTION_TIMEOUT_MS: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().min(100).max(5000))
    .default('800'),

  // VIP fee settings for realistic profit calculations
  VIP_FEE_PERCENT: z
    .string()
    .transform((v) => parseFloat(v))
    .pipe(z.number().min(0).max(1))
    .default('0.075'),

  // Minimum depth in USD to consider opportunity executable
  MIN_DEPTH_USD: z
    .string()
    .transform((v) => parseFloat(v))
    .pipe(z.number().min(0).max(1000000))
    .default('50000'),

  // Use VIP fees instead of default exchange fees
  USE_VIP_FEES: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('true'),
});

export type EnvConfig = z.infer<typeof envSchema>;

// ===========================================
// Exchange Configuration Schema
// ===========================================

export const exchangeIdSchema = z.enum([
  // Original 11 exchanges
  'binance',
  'bybit',
  'okx',
  'kucoin',
  'gateio',
  'mexc',
  'htx',
  'bitget',
  'coinbase',
  'kraken',
  'bingx',
  // New exchanges (10 more)
  'cryptocom',
  'bitfinex',
  'gemini',
  'lbank',
  'whitebit',
  'ascendex',
  'poloniex',
  'upbit',
  'coinex',
  'woo',
  // Additional 6 exchanges → total 27
  'bitmart',
  'phemex',
  'p2b',
  'exmo',
  'bitstamp',
  'bitrue',
]);

export type ExchangeId = z.infer<typeof exchangeIdSchema>;

export const feeStructureSchema = z.object({
  maker: z.number().min(0).max(1), // 0-100%
  taker: z.number().min(0).max(1),
});

export type FeeStructure = z.infer<typeof feeStructureSchema>;

export const rateLimitConfigSchema = z.object({
  maxWebSocketConnections: z.number().int().min(1),
  requestsPerMinute: z.number().int().min(1),
  ordersPerSecond: z.number().int().min(1).optional(),
});

export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;

export const exchangeConfigSchema = z.object({
  id: exchangeIdSchema,
  name: z.string(),
  isEnabled: z.boolean().default(true),
  fees: feeStructureSchema,
  rateLimits: rateLimitConfigSchema,
  hasWebSocket: z.boolean().default(true),
  supportedFeatures: z.object({
    watchOrderBook: z.boolean().default(true),
    watchTicker: z.boolean().default(true),
    fetchOrderBook: z.boolean().default(true),
  }),
  minOrderSize: z.record(z.string(), z.number()).optional(), // symbol -> min size
});

export type ExchangeConfig = z.infer<typeof exchangeConfigSchema>;

// ===========================================
// Trading Parameters Schema
// ===========================================

export const tradingPairSchema = z.object({
  base: z.string().min(1).max(10), // e.g., "BTC"
  quote: z.string().min(1).max(10), // e.g., "USDT"
  symbol: z.string(), // e.g., "BTC/USDT"
});

export type TradingPair = z.infer<typeof tradingPairSchema>;

export const tradingParametersSchema = z.object({
  minProfitThreshold: z.number().min(0).max(10), // percentage
  tradeSizeUsd: z.number().min(1).max(1000000),
  maxOrderbookAgeMs: z.number().min(100).max(10000),
  slippageMultiplier: z.number().min(1).max(5),
  maxExecutionTimeoutMs: z.number().min(100).max(5000),
  enabledPairs: z.array(tradingPairSchema),
  enabledExchanges: z.array(exchangeIdSchema),
});

export type TradingParameters = z.infer<typeof tradingParametersSchema>;

// ===========================================
// Arbitrage Opportunity Schema
// ===========================================

export const arbitrageTypeSchema = z.enum(['simple', 'triangular', 'cross_triangular']);

export type ArbitrageType = z.infer<typeof arbitrageTypeSchema>;

export const orderSideSchema = z.enum(['buy', 'sell']);

export type OrderSide = z.infer<typeof orderSideSchema>;

export const arbitrageOpportunitySchema = z.object({
  id: z.string().uuid(),
  type: arbitrageTypeSchema,
  symbol: z.string(),
  buyExchange: exchangeIdSchema,
  sellExchange: exchangeIdSchema,
  buyPrice: z.string(), // Using string for Decimal.js compatibility
  sellPrice: z.string(),
  grossSpread: z.string(), // percentage as string
  netProfit: z.string(), // percentage as string
  estimatedProfitUsd: z.string(),
  fees: z.object({
    buyFee: z.string(),
    sellFee: z.string(),
    totalFee: z.string(),
  }),
  slippage: z.object({
    estimated: z.string(),
    withMultiplier: z.string(),
  }),
  volume: z.object({
    available: z.string(),
    tradeSizeUsd: z.string(),
  }),
  timestamp: z.number(), // Unix timestamp ms
  orderbookAges: z.object({
    buy: z.number(), // ms
    sell: z.number(),
  }),
  isStale: z.boolean(),
});

export type ArbitrageOpportunity = z.infer<typeof arbitrageOpportunitySchema>;

// ===========================================
// Triangular Arbitrage Path Schema
// ===========================================

export const triangularPathStepSchema = z.object({
  pair: tradingPairSchema,
  side: orderSideSchema,
  exchange: exchangeIdSchema,
  price: z.string(),
  fee: z.string(),
});

export type TriangularPathStep = z.infer<typeof triangularPathStepSchema>;

export const triangularOpportunitySchema = z.object({
  id: z.string().uuid(),
  type: z.literal('triangular'),
  exchange: exchangeIdSchema,
  path: z.array(triangularPathStepSchema).length(3),
  startAmount: z.string(),
  endAmount: z.string(),
  netProfit: z.string(),
  estimatedProfitUsd: z.string(),
  totalFees: z.string(),
  timestamp: z.number(),
  isStale: z.boolean(),
});

export type TriangularOpportunity = z.infer<typeof triangularOpportunitySchema>;

// ===========================================
// Orderbook Schema
// ===========================================

export const orderbookLevelSchema = z.tuple([
  z.string(), // price
  z.string(), // amount
]);

export type OrderbookLevel = z.infer<typeof orderbookLevelSchema>;

export const orderbookSchema = z.object({
  exchange: exchangeIdSchema,
  symbol: z.string(),
  timestamp: z.number(),
  receivedAt: z.number(),
  bids: z.array(orderbookLevelSchema), // sorted desc by price
  asks: z.array(orderbookLevelSchema), // sorted asc by price
  nonce: z.number().optional(),
});

export type Orderbook = z.infer<typeof orderbookSchema>;

// ===========================================
// Circuit Breaker State Schema
// ===========================================

export const circuitBreakerStateSchema = z.enum(['closed', 'open', 'half_open']);

export type CircuitBreakerState = z.infer<typeof circuitBreakerStateSchema>;

export const circuitBreakerConfigSchema = z.object({
  failureThreshold: z.number().int().min(1).default(5),
  resetTimeoutMs: z.number().int().min(1000).default(30000),
  halfOpenMaxAttempts: z.number().int().min(1).default(3),
});

export type CircuitBreakerConfig = z.infer<typeof circuitBreakerConfigSchema>;
