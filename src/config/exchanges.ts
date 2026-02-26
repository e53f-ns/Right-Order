/**
 * Static exchange configuration data
 * Fees, rate limits, and WebSocket endpoints
 */

import type { ExchangeConfig, ExchangeId } from './schema.js';

/**
 * Default exchange configurations
 * Fees are in decimal (0.001 = 0.1%)
 * These are default/public tier fees - VIP tiers have lower fees
 */
export const EXCHANGE_CONFIGS: Record<ExchangeId, ExchangeConfig> = {
  binance: {
    id: 'binance',
    name: 'Binance',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 5,
      requestsPerMinute: 1200,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  bybit: {
    id: 'bybit',
    name: 'Bybit',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 20,
      requestsPerMinute: 600,
      ordersPerSecond: 20,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  okx: {
    id: 'okx',
    name: 'OKX',
    isEnabled: true,
    fees: {
      maker: 0.0008, // 0.08%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 3,
      requestsPerMinute: 300,
      ordersPerSecond: 60,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  kucoin: {
    id: 'kucoin',
    name: 'KuCoin',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 600,
      ordersPerSecond: 30,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  gateio: {
    id: 'gateio',
    name: 'Gate.io',
    isEnabled: true,
    fees: {
      maker: 0.0015, // 0.15% (with GT)
      taker: 0.0015, // 0.15% (with GT)
    },
    rateLimits: {
      maxWebSocketConnections: 20,
      requestsPerMinute: 900,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  mexc: {
    id: 'mexc',
    name: 'MEXC',
    isEnabled: true,
    fees: {
      maker: 0.0, // 0% maker
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 30,
      requestsPerMinute: 1200,
      ordersPerSecond: 20,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  htx: {
    id: 'htx',
    name: 'HTX (Huobi)',
    isEnabled: true,
    fees: {
      maker: 0.0015, // 0.15% (with point card)
      taker: 0.0015, // 0.15% (with point card)
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 800,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  bitget: {
    id: 'bitget',
    name: 'Bitget',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 20,
      requestsPerMinute: 600,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  coinbase: {
    id: 'coinbase',
    name: 'Coinbase Advanced',
    isEnabled: true,
    fees: {
      maker: 0.004, // 0.4% (default tier)
      taker: 0.006, // 0.6% (default tier)
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300, // Conservative
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  kraken: {
    id: 'kraken',
    name: 'Kraken',
    isEnabled: true,
    fees: {
      maker: 0.0016, // 0.16%
      taker: 0.0026, // 0.26%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 60, // Very conservative for Kraken
      ordersPerSecond: 5,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  bingx: {
    id: 'bingx',
    name: 'BingX',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 20,
      requestsPerMinute: 600,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  // =============================================
  // NEW EXCHANGES (8 additions → total 19)
  // =============================================

  cryptocom: {
    id: 'cryptocom',
    name: 'Crypto.com',
    isEnabled: true,
    fees: {
      maker: 0.004, // 0.4% (default tier)
      taker: 0.004, // 0.4%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  bitfinex: {
    id: 'bitfinex',
    name: 'Bitfinex',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.002, // 0.2%
    },
    rateLimits: {
      maxWebSocketConnections: 20,
      requestsPerMinute: 90, // Conservative
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  gemini: {
    id: 'gemini',
    name: 'Gemini',
    isEnabled: true,
    fees: {
      maker: 0.002, // 0.2%
      taker: 0.004, // 0.4% (default tier)
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 120,
      ordersPerSecond: 5,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  lbank: {
    id: 'lbank',
    name: 'LBank',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  whitebit: {
    id: 'whitebit',
    name: 'WhiteBIT',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 600,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  ascendex: {
    id: 'ascendex',
    name: 'AscendEX (BitMax)',
    isEnabled: true,
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.001, // 0.1%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  poloniex: {
    id: 'poloniex',
    name: 'Poloniex',
    isEnabled: true,
    fees: {
      maker: 0.00145, // 0.145%
      taker: 0.00155, // 0.155%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 200,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  upbit: {
    id: 'upbit',
    name: 'Upbit',
    isEnabled: true,
    fees: {
      maker: 0.0005, // 0.05%
      taker: 0.0005, // 0.05%
    },
    rateLimits: {
      maxWebSocketConnections: 5,
      requestsPerMinute: 60, // Very conservative, Korean exchange
      ordersPerSecond: 5,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  coinex: {
    id: 'coinex',
    name: 'CoinEx',
    isEnabled: true,
    fees: {
      maker: 0.002, // 0.2%
      taker: 0.002, // 0.2%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 400,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  woo: {
    id: 'woo',
    name: 'WOO X',
    isEnabled: true,
    fees: {
      maker: 0.0, // 0% maker (zero fees for makers)
      taker: 0.0003, // 0.03% (very low)
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  // =============================================
  // ADDITIONAL 6 EXCHANGES (total 27)
  // =============================================

  bitmart: {
    id: 'bitmart',
    name: 'BitMart',
    isEnabled: true,
    fees: {
      maker: 0.00075, // 0.075% VIP maker
      taker: 0.00075, // 0.075% VIP taker
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  phemex: {
    id: 'phemex',
    name: 'Phemex',
    isEnabled: true,
    fees: {
      maker: 0.00075, // 0.075% VIP maker
      taker: 0.00075, // 0.075% VIP taker
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 500,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  p2b: {
    id: 'p2b',
    name: 'P2B',
    isEnabled: true,
    fees: {
      maker: 0.002, // 0.2%
      taker: 0.002, // 0.2%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  exmo: {
    id: 'exmo',
    name: 'EXMO',
    isEnabled: true,
    fees: {
      maker: 0.002, // 0.2%
      taker: 0.002, // 0.2%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  bitstamp: {
    id: 'bitstamp',
    name: 'Bitstamp',
    isEnabled: true,
    fees: {
      maker: 0.003, // 0.3%
      taker: 0.004, // 0.4%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 600,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },

  bitrue: {
    id: 'bitrue',
    name: 'Bitrue',
    isEnabled: true,
    fees: {
      maker: 0.00098, // 0.098%
      taker: 0.00098, // 0.098%
    },
    rateLimits: {
      maxWebSocketConnections: 10,
      requestsPerMinute: 300,
      ordersPerSecond: 10,
    },
    hasWebSocket: true,
    supportedFeatures: {
      watchOrderBook: true,
      watchTicker: true,
      fetchOrderBook: true,
    },
  },
};

/**
 * Default trading pairs to scan
 * High liquidity pairs across most exchanges
 */
export const DEFAULT_TRADING_PAIRS = [
  { base: 'BTC', quote: 'USDT', symbol: 'BTC/USDT' },
  { base: 'ETH', quote: 'USDT', symbol: 'ETH/USDT' },
  { base: 'SOL', quote: 'USDT', symbol: 'SOL/USDT' },
  { base: 'XRP', quote: 'USDT', symbol: 'XRP/USDT' },
  { base: 'DOGE', quote: 'USDT', symbol: 'DOGE/USDT' },
  { base: 'ADA', quote: 'USDT', symbol: 'ADA/USDT' },
  { base: 'AVAX', quote: 'USDT', symbol: 'AVAX/USDT' },
  { base: 'LINK', quote: 'USDT', symbol: 'LINK/USDT' },
  { base: 'DOT', quote: 'USDT', symbol: 'DOT/USDT' },
  { base: 'MATIC', quote: 'USDT', symbol: 'MATIC/USDT' },
  { base: 'ETH', quote: 'BTC', symbol: 'ETH/BTC' },
  { base: 'SOL', quote: 'BTC', symbol: 'SOL/BTC' },
] as const;

/**
 * Triangular arbitrage paths for single-exchange scanning
 * Format: [pair1, pair2, pair3] where the cycle completes
 * 
 * Path directions are auto-detected by the PathFinder based on currency flow
 */
export const TRIANGULAR_PATHS = [
  // ===========================================
  // BTC-ETH triangles (high liquidity)
  // ===========================================
  // USDT -> BTC -> ETH -> USDT
  ['BTC/USDT', 'ETH/BTC', 'ETH/USDT'],
  // USDT -> ETH -> BTC -> USDT (reverse)
  ['ETH/USDT', 'ETH/BTC', 'BTC/USDT'],

  // ===========================================
  // BTC-SOL triangles
  // ===========================================
  // USDT -> BTC -> SOL -> USDT
  ['BTC/USDT', 'SOL/BTC', 'SOL/USDT'],
  // USDT -> SOL -> BTC -> USDT (reverse)
  ['SOL/USDT', 'SOL/BTC', 'BTC/USDT'],

  // ===========================================
  // ETH-SOL triangles
  // ===========================================
  // USDT -> ETH -> SOL -> USDT (if SOL/ETH exists)
  // Note: SOL/ETH is less common, most exchanges use SOL/USDT and ETH/USDT

  // ===========================================
  // BTC-XRP triangles
  // ===========================================
  // USDT -> BTC -> XRP -> USDT
  ['BTC/USDT', 'XRP/BTC', 'XRP/USDT'],
  // USDT -> XRP -> BTC -> USDT (reverse)
  ['XRP/USDT', 'XRP/BTC', 'BTC/USDT'],

  // ===========================================
  // BTC-DOGE triangles
  // ===========================================
  // USDT -> BTC -> DOGE -> USDT
  ['BTC/USDT', 'DOGE/BTC', 'DOGE/USDT'],
  // USDT -> DOGE -> BTC -> USDT (reverse)
  ['DOGE/USDT', 'DOGE/BTC', 'BTC/USDT'],

  // ===========================================
  // ETH-based triangles (ETH as intermediate)
  // ===========================================
  // USDT -> ETH -> LINK -> USDT
  ['ETH/USDT', 'LINK/ETH', 'LINK/USDT'],
  // USDT -> LINK -> ETH -> USDT (reverse)
  ['LINK/USDT', 'LINK/ETH', 'ETH/USDT'],
] as const;

/**
 * Get exchange config by ID
 */
export function getExchangeConfig(exchangeId: ExchangeId): ExchangeConfig {
  return EXCHANGE_CONFIGS[exchangeId];
}

/**
 * Get all enabled exchanges
 */
export function getEnabledExchanges(): ExchangeConfig[] {
  return Object.values(EXCHANGE_CONFIGS).filter((config) => config.isEnabled);
}

/**
 * Get taker fee for exchange (most common for market orders)
 */
export function getTakerFee(exchangeId: ExchangeId): number {
  return EXCHANGE_CONFIGS[exchangeId].fees.taker;
}

/**
 * Get total round-trip fees for simple arbitrage
 * buyExchange taker fee + sellExchange taker fee
 */
export function getRoundTripFees(buyExchange: ExchangeId, sellExchange: ExchangeId): number {
  return getTakerFee(buyExchange) + getTakerFee(sellExchange);
}
