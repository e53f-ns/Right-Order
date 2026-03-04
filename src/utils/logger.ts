/**
 * Pino logger setup with automatic secret redaction
 * Structured logging with correlation IDs for tracing
 */

import pino, { stdTimeFunctions, transport } from 'pino';

// Patterns for automatic redaction
const REDACT_PATHS = [
  'apiKey',
  'secret',
  'passphrase',
  'password',
  'token',
  'authorization',
  'credentials',
  'credentials.*',
  '*.apiKey',
  '*.secret',
  '*.passphrase',
  '*.password',
  '*.token',
  'config.env.BINANCE_API_KEY',
  'config.env.BINANCE_SECRET',
  'config.env.BYBIT_API_KEY',
  'config.env.BYBIT_SECRET',
  'config.env.OKX_API_KEY',
  'config.env.OKX_SECRET',
  'config.env.OKX_PASSPHRASE',
  'config.env.KUCOIN_API_KEY',
  'config.env.KUCOIN_SECRET',
  'config.env.KUCOIN_PASSPHRASE',
  'config.env.GATEIO_API_KEY',
  'config.env.GATEIO_SECRET',
  'config.env.MEXC_API_KEY',
  'config.env.MEXC_SECRET',
  'config.env.HTX_API_KEY',
  'config.env.HTX_SECRET',
  'config.env.BITGET_API_KEY',
  'config.env.BITGET_SECRET',
  'config.env.BITGET_PASSPHRASE',
  'config.env.COINBASE_API_KEY',
  'config.env.COINBASE_SECRET',
  'config.env.KRAKEN_API_KEY',
  'config.env.KRAKEN_SECRET',
  'config.env.BINGX_API_KEY',
  'config.env.BINGX_SECRET',
  'config.env.TELEGRAM_BOT_TOKEN',
  'config.env.DATABASE_URL',
  'config.env.JWT_ACCESS_SECRET',
  'config.env.JWT_REFRESH_SECRET',
  'config.env.COOKIE_SECRET',
  'config.env.RESEND_API_KEY',
  'config.env.SMTP_PASS',
  'config.env.STRIPE_SECRET_KEY',
  'config.env.STRIPE_WEBHOOK_SECRET',
  'config.env.CRYPTO_WEBHOOK_SECRET',
  'config.env.TRONGRID_API_KEY',
];

// Get log level from environment
function getLogLevel(): pino.Level {
  const level = process.env['LOG_LEVEL'];
  const validLevels: pino.Level[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

  if (level !== undefined && validLevels.includes(level as pino.Level)) {
    return level as pino.Level;
  }

  return 'info';
}

// Check if running in development mode
function isDevelopment(): boolean {
  return process.env['NODE_ENV'] !== 'production';
}

// Create base logger configuration
function createBaseConfig(): pino.LoggerOptions {
  return {
    level: getLogLevel(),
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label: string): { level: string } => ({ level: label }),
      bindings: (bindings: pino.Bindings): Record<string, unknown> => {
        const rawPid: unknown = bindings['pid'];
        const rawHostname: unknown = bindings['hostname'];
        const result: Record<string, unknown> = {};
        if (typeof rawPid === 'number') {
          result['pid'] = rawPid;
        }
        if (typeof rawHostname === 'string') {
          result['hostname'] = rawHostname;
        }
        return result;
      },
    },
    timestamp: stdTimeFunctions.isoTime,
  };
}

// Root logger instance
let rootLogger: pino.Logger | null = null;

/**
 * Get or create the root logger
 */
function getRootLogger(): pino.Logger {
  if (rootLogger === null) {
    const config = createBaseConfig();

    if (isDevelopment()) {
      // Pretty print in development
      const devTransport = transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }) as pino.DestinationStream;
      rootLogger = pino(config, devTransport);
    } else {
      // JSON output in production
      rootLogger = pino(config);
    }
  }

  return rootLogger;
}

/**
 * Create a child logger with a specific module name
 * @param module - Module name for context (e.g., 'scanner', 'exchange:binance')
 */
export function createLogger(module: string): pino.Logger {
  return getRootLogger().child({ module });
}

/**
 * Create a child logger with correlation ID for request tracing
 * @param module - Module name
 * @param correlationId - Unique ID for tracing related log entries
 */
export function createCorrelatedLogger(module: string, correlationId: string): pino.Logger {
  return getRootLogger().child({ module, correlationId });
}

/**
 * Generate a correlation ID for tracing
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Redact sensitive data from an object (for manual redaction when needed)
 */
export function redactSensitiveData<T extends Record<string, unknown>>(obj: T): T {
  const sensitiveKeys = new Set([
    'apiKey',
    'secret',
    'passphrase',
    'password',
    'token',
    'authorization',
    'credentials',
  ]);

  const redacted = { ...obj };

  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      (redacted as Record<string, unknown>)[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      (redacted as Record<string, unknown>)[key] = redactSensitiveData(
        redacted[key] as Record<string, unknown>
      );
    }
  }

  return redacted;
}

// Export types
export type Logger = pino.Logger;
