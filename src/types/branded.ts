/**
 * Branded types for type-safe identifiers
 * Prevents mixing up strings that represent different things
 */

// Brand symbol for type safety
declare const brand: unique symbol;

/**
 * Create a branded type
 * Usage: type UserId = Brand<string, 'UserId'>
 */
export type Brand<T, B> = T & { readonly [brand]: B };

// ===========================================
// Branded ID Types
// ===========================================

/** Unique identifier for an arbitrage opportunity */
export type OpportunityId = Brand<string, 'OpportunityId'>;

/** Correlation ID for tracing related log entries */
export type CorrelationId = Brand<string, 'CorrelationId'>;

/** Exchange identifier (validated) */
export type ExchangeIdBranded = Brand<string, 'ExchangeId'>;

/** Trading symbol (e.g., "BTC/USDT") */
export type TradingSymbol = Brand<string, 'TradingSymbol'>;

/** Base currency (e.g., "BTC") */
export type BaseCurrency = Brand<string, 'BaseCurrency'>;

/** Quote currency (e.g., "USDT") */
export type QuoteCurrency = Brand<string, 'QuoteCurrency'>;

// ===========================================
// Branded Numeric Types (as strings for Decimal.js)
// ===========================================

/** Price value (string for Decimal.js precision) */
export type Price = Brand<string, 'Price'>;

/** Amount/quantity value (string for Decimal.js precision) */
export type Amount = Brand<string, 'Amount'>;

/** Percentage value (string, e.g., "0.5" for 0.5%) */
export type Percentage = Brand<string, 'Percentage'>;

/** USD value (string for Decimal.js precision) */
export type UsdValue = Brand<string, 'UsdValue'>;

/** Timestamp in milliseconds */
export type TimestampMs = Brand<number, 'TimestampMs'>;

// ===========================================
// Type Guards / Constructors
// ===========================================

/**
 * Create an OpportunityId from a string
 */
export function createOpportunityId(id: string): OpportunityId {
  return id as OpportunityId;
}

/**
 * Create a CorrelationId from a string
 */
export function createCorrelationId(id: string): CorrelationId {
  return id as CorrelationId;
}

/**
 * Create a TradingSymbol from base/quote
 */
export function createTradingSymbol(base: string, quote: string): TradingSymbol {
  return `${base}/${quote}` as TradingSymbol;
}

/**
 * Create a Price from a string or number
 */
export function createPrice(value: string | number): Price {
  return String(value) as Price;
}

/**
 * Create an Amount from a string or number
 */
export function createAmount(value: string | number): Amount {
  return String(value) as Amount;
}

/**
 * Create a Percentage from a string or number
 */
export function createPercentage(value: string | number): Percentage {
  return String(value) as Percentage;
}

/**
 * Create a UsdValue from a string or number
 */
export function createUsdValue(value: string | number): UsdValue {
  return String(value) as UsdValue;
}

/**
 * Create a TimestampMs (validates it's a positive number)
 */
export function createTimestampMs(value: number): TimestampMs {
  if (value < 0) {
    throw new Error('Timestamp must be a positive number');
  }
  return value as TimestampMs;
}

/**
 * Get current time as TimestampMs
 */
export function nowTimestampMs(): TimestampMs {
  return Date.now() as TimestampMs;
}
