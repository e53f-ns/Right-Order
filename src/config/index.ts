/**
 * Configuration module
 * Loads and validates all configuration from environment
 */

import { config } from 'dotenv';

import { DEFAULT_TRADING_PAIRS, EXCHANGE_CONFIGS, getEnabledExchanges } from './exchanges.js';
import type { EnvConfig, ExchangeId, TradingParameters } from './schema.js';
import { envSchema, exchangeIdSchema } from './schema.js';

// Load .env file
config();

export interface AppConfig {
  env: EnvConfig;
  trading: TradingParameters;
  exchanges: typeof EXCHANGE_CONFIGS;
}

let cachedConfig: AppConfig | null = null;

/**
 * Load and validate configuration from environment
 * Throws on validation errors
 */
export function loadConfig(): AppConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  // Parse and validate environment variables
  const envResult = envSchema.safeParse(process.env);

  if (!envResult.success) {
    const errors = envResult.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  const env = envResult.data;

  // Build trading parameters from env
  const trading: TradingParameters = {
    minProfitThreshold: env.MIN_PROFIT_THRESHOLD,
    tradeSizeUsd: env.TRADE_SIZE_USD,
    maxOrderbookAgeMs: env.MAX_ORDERBOOK_AGE_MS,
    slippageMultiplier: env.SLIPPAGE_MULTIPLIER,
    maxExecutionTimeoutMs: env.MAX_EXECUTION_TIMEOUT_MS,
    enabledPairs: [...DEFAULT_TRADING_PAIRS],
    enabledExchanges: getEnabledExchanges().map((e) => e.id),
  };

  cachedConfig = {
    env,
    trading,
    exchanges: EXCHANGE_CONFIGS,
  };

  return cachedConfig;
}

/**
 * Get exchange credentials from environment
 * Returns undefined if not configured
 */
export function getExchangeCredentials(
  exchangeId: ExchangeId
): { apiKey: string; secret: string; passphrase?: string } | undefined {
  const env = loadConfig().env;

  switch (exchangeId) {
    case 'binance':
      if (env.BINANCE_API_KEY !== undefined && env.BINANCE_SECRET !== undefined) {
        return { apiKey: env.BINANCE_API_KEY, secret: env.BINANCE_SECRET };
      }
      break;
    case 'bybit':
      if (env.BYBIT_API_KEY !== undefined && env.BYBIT_SECRET !== undefined) {
        return { apiKey: env.BYBIT_API_KEY, secret: env.BYBIT_SECRET };
      }
      break;
    case 'okx':
      if (env.OKX_API_KEY !== undefined && env.OKX_SECRET !== undefined) {
        const result: { apiKey: string; secret: string; passphrase?: string } = {
          apiKey: env.OKX_API_KEY,
          secret: env.OKX_SECRET,
        };
        if (env.OKX_PASSPHRASE !== undefined) {
          result.passphrase = env.OKX_PASSPHRASE;
        }
        return result;
      }
      break;
    case 'kucoin':
      if (env.KUCOIN_API_KEY !== undefined && env.KUCOIN_SECRET !== undefined) {
        const result: { apiKey: string; secret: string; passphrase?: string } = {
          apiKey: env.KUCOIN_API_KEY,
          secret: env.KUCOIN_SECRET,
        };
        if (env.KUCOIN_PASSPHRASE !== undefined) {
          result.passphrase = env.KUCOIN_PASSPHRASE;
        }
        return result;
      }
      break;
    case 'gateio':
      if (env.GATEIO_API_KEY !== undefined && env.GATEIO_SECRET !== undefined) {
        return { apiKey: env.GATEIO_API_KEY, secret: env.GATEIO_SECRET };
      }
      break;
    case 'mexc':
      if (env.MEXC_API_KEY !== undefined && env.MEXC_SECRET !== undefined) {
        return { apiKey: env.MEXC_API_KEY, secret: env.MEXC_SECRET };
      }
      break;
    case 'htx':
      if (env.HTX_API_KEY !== undefined && env.HTX_SECRET !== undefined) {
        return { apiKey: env.HTX_API_KEY, secret: env.HTX_SECRET };
      }
      break;
    case 'bitget':
      if (env.BITGET_API_KEY !== undefined && env.BITGET_SECRET !== undefined) {
        const result: { apiKey: string; secret: string; passphrase?: string } = {
          apiKey: env.BITGET_API_KEY,
          secret: env.BITGET_SECRET,
        };
        if (env.BITGET_PASSPHRASE !== undefined) {
          result.passphrase = env.BITGET_PASSPHRASE;
        }
        return result;
      }
      break;
    case 'coinbase':
      if (env.COINBASE_API_KEY !== undefined && env.COINBASE_SECRET !== undefined) {
        return { apiKey: env.COINBASE_API_KEY, secret: env.COINBASE_SECRET };
      }
      break;
    case 'kraken':
      if (env.KRAKEN_API_KEY !== undefined && env.KRAKEN_SECRET !== undefined) {
        return { apiKey: env.KRAKEN_API_KEY, secret: env.KRAKEN_SECRET };
      }
      break;
    case 'bingx':
      if (env.BINGX_API_KEY !== undefined && env.BINGX_SECRET !== undefined) {
        return { apiKey: env.BINGX_API_KEY, secret: env.BINGX_SECRET };
      }
      break;

    // New exchanges
    case 'cryptocom':
      if (env.CRYPTOCOM_API_KEY !== undefined && env.CRYPTOCOM_SECRET !== undefined) {
        return { apiKey: env.CRYPTOCOM_API_KEY, secret: env.CRYPTOCOM_SECRET };
      }
      break;
    case 'bitfinex':
      if (env.BITFINEX_API_KEY !== undefined && env.BITFINEX_SECRET !== undefined) {
        return { apiKey: env.BITFINEX_API_KEY, secret: env.BITFINEX_SECRET };
      }
      break;
    case 'gemini':
      if (env.GEMINI_API_KEY !== undefined && env.GEMINI_SECRET !== undefined) {
        return { apiKey: env.GEMINI_API_KEY, secret: env.GEMINI_SECRET };
      }
      break;
    case 'lbank':
      if (env.LBANK_API_KEY !== undefined && env.LBANK_SECRET !== undefined) {
        return { apiKey: env.LBANK_API_KEY, secret: env.LBANK_SECRET };
      }
      break;
    case 'whitebit':
      if (env.WHITEBIT_API_KEY !== undefined && env.WHITEBIT_SECRET !== undefined) {
        return { apiKey: env.WHITEBIT_API_KEY, secret: env.WHITEBIT_SECRET };
      }
      break;
    case 'ascendex':
      if (env.ASCENDEX_API_KEY !== undefined && env.ASCENDEX_SECRET !== undefined) {
        return { apiKey: env.ASCENDEX_API_KEY, secret: env.ASCENDEX_SECRET };
      }
      break;
    case 'poloniex':
      if (env.POLONIEX_API_KEY !== undefined && env.POLONIEX_SECRET !== undefined) {
        return { apiKey: env.POLONIEX_API_KEY, secret: env.POLONIEX_SECRET };
      }
      break;
    case 'upbit':
      if (env.UPBIT_API_KEY !== undefined && env.UPBIT_SECRET !== undefined) {
        return { apiKey: env.UPBIT_API_KEY, secret: env.UPBIT_SECRET };
      }
      break;
    case 'coinex':
      if (env.COINEX_API_KEY !== undefined && env.COINEX_SECRET !== undefined) {
        return { apiKey: env.COINEX_API_KEY, secret: env.COINEX_SECRET };
      }
      break;
    case 'woo':
      if (env.WOO_API_KEY !== undefined && env.WOO_SECRET !== undefined) {
        return { apiKey: env.WOO_API_KEY, secret: env.WOO_SECRET };
      }
      break;
  }

  return undefined;
}

/**
 * Check if Telegram notifications are configured
 */
export function isTelegramConfigured(): boolean {
  const env = loadConfig().env;
  return env.TELEGRAM_BOT_TOKEN !== undefined && env.TELEGRAM_CHAT_ID !== undefined;
}

/**
 * Validate exchange ID
 */
export function isValidExchangeId(id: string): id is ExchangeId {
  return exchangeIdSchema.safeParse(id).success;
}

/**
 * Reset config cache (useful for testing)
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

// Re-export schemas and types
export * from './schema.js';
export * from './exchanges.js';
