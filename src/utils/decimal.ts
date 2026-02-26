/**
 * Decimal.js wrappers for precise financial calculations
 * Never use native JS numbers for money - floating point errors kill arbitrage
 */

import DecimalJS from 'decimal.js';

// Access the Decimal constructor (handles ESM/CJS interop)
const Decimal = DecimalJS.default ?? DecimalJS;
type DecimalType = InstanceType<typeof Decimal>;

// Configure Decimal.js for financial calculations
Decimal.set({
  precision: 20, // High precision for crypto calculations
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9, // Use exponential notation for very small numbers
  toExpPos: 20, // Use exponential notation for very large numbers
});

// Type alias for clarity
export type DecimalValue = DecimalType | string | number;

/**
 * Create a Decimal from any valid input
 * Prefer using string inputs to avoid floating point errors
 */
export function toDecimal(value: DecimalValue): DecimalType {
  return new Decimal(value);
}

/**
 * Safe conversion to string with fixed decimal places
 */
export function toFixed(value: DecimalValue, decimalPlaces: number): string {
  return toDecimal(value).toFixed(decimalPlaces);
}

/**
 * Convert to number (use sparingly, prefer strings)
 */
export function toNumber(value: DecimalValue): number {
  return toDecimal(value).toNumber();
}

// ===========================================
// Basic Arithmetic Operations
// ===========================================

export function add(a: DecimalValue, b: DecimalValue): DecimalType {
  return toDecimal(a).plus(b);
}

export function subtract(a: DecimalValue, b: DecimalValue): DecimalType {
  return toDecimal(a).minus(b);
}

export function multiply(a: DecimalValue, b: DecimalValue): DecimalType {
  return toDecimal(a).times(b);
}

export function divide(a: DecimalValue, b: DecimalValue): DecimalType {
  return toDecimal(a).dividedBy(b);
}

// ===========================================
// Comparison Operations
// ===========================================

export function isGreaterThan(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).greaterThan(b);
}

export function isLessThan(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).lessThan(b);
}

export function isEqual(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).equals(b);
}

export function isGreaterThanOrEqual(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).greaterThanOrEqualTo(b);
}

export function isLessThanOrEqual(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).lessThanOrEqualTo(b);
}

export function isZero(value: DecimalValue): boolean {
  return toDecimal(value).isZero();
}

export function isPositive(value: DecimalValue): boolean {
  return toDecimal(value).isPositive();
}

export function isNegative(value: DecimalValue): boolean {
  return toDecimal(value).isNegative();
}

// ===========================================
// Arbitrage Specific Calculations
// ===========================================

/**
 * Calculate percentage difference between two prices
 * Result is in percentage (e.g., 0.5 = 0.5%)
 *
 * @param basePrice - The base price (denominator)
 * @param comparePrice - The price to compare
 * @returns Percentage difference
 */
export function calculatePercentageDiff(
  basePrice: DecimalValue,
  comparePrice: DecimalValue
): DecimalType {
  const base = toDecimal(basePrice);
  const compare = toDecimal(comparePrice);

  if (base.isZero()) {
    return toDecimal(0);
  }

  return compare.minus(base).dividedBy(base).times(100);
}

/**
 * Calculate gross spread between buy and sell prices
 * grossSpread = (sellPrice - buyPrice) / buyPrice * 100
 *
 * @param buyPrice - Price to buy at (ask)
 * @param sellPrice - Price to sell at (bid)
 * @returns Spread percentage
 */
export function calculateGrossSpread(
  buyPrice: DecimalValue,
  sellPrice: DecimalValue
): DecimalType {
  return calculatePercentageDiff(buyPrice, sellPrice);
}

/**
 * Calculate net profit after fees and slippage
 * netProfit = grossSpread - buyFee - sellFee - estimatedSlippage
 *
 * All inputs should be in percentage form (e.g., 0.1 = 0.1%)
 */
export function calculateNetProfit(
  grossSpread: DecimalValue,
  buyFee: DecimalValue,
  sellFee: DecimalValue,
  estimatedSlippage: DecimalValue
): DecimalType {
  const spread = toDecimal(grossSpread);
  const totalFees = toDecimal(buyFee).plus(sellFee);
  const slippage = toDecimal(estimatedSlippage);

  return spread.minus(totalFees).minus(slippage);
}

/**
 * Calculate estimated slippage from orderbook depth
 * Uses volume-weighted average price (VWAP) calculation
 *
 * @param targetAmountBase - Amount to trade in base currency
 * @param orderbookLevels - Array of [price, amount] tuples
 * @param bestPrice - Best bid/ask price
 * @returns Estimated slippage percentage
 */
export function calculateSlippage(
  targetAmountBase: DecimalValue,
  orderbookLevels: Array<[DecimalValue, DecimalValue]>,
  bestPrice: DecimalValue
): DecimalType {
  const target = toDecimal(targetAmountBase);
  const best = toDecimal(bestPrice);

  if (target.isZero() || orderbookLevels.length === 0) {
    return toDecimal(0);
  }

  let remainingAmount = target;
  let totalCost = toDecimal(0);

  for (const [price, amount] of orderbookLevels) {
    if (remainingAmount.isZero()) break;

    const levelPrice = toDecimal(price);
    const levelAmount = toDecimal(amount);
    const fillAmount = Decimal.min(remainingAmount, levelAmount);

    totalCost = totalCost.plus(fillAmount.times(levelPrice));
    remainingAmount = remainingAmount.minus(fillAmount);
  }

  // If we couldn't fill the entire order, return high slippage as warning
  if (remainingAmount.isPositive()) {
    return toDecimal(10); // 10% slippage indicates insufficient liquidity
  }

  // Calculate VWAP
  const vwap = totalCost.dividedBy(target);

  // Slippage = (VWAP - bestPrice) / bestPrice * 100
  return vwap.minus(best).dividedBy(best).times(100).abs();
}

/**
 * Convert trade size from USD to base currency amount
 *
 * @param tradeSizeUsd - Trade size in USD
 * @param price - Current price of base/USD pair
 * @returns Amount in base currency
 */
export function usdToBaseAmount(tradeSizeUsd: DecimalValue, price: DecimalValue): DecimalType {
  return toDecimal(tradeSizeUsd).dividedBy(price);
}

/**
 * Calculate profit in USD from percentage and trade size
 *
 * @param profitPercentage - Net profit percentage
 * @param tradeSizeUsd - Trade size in USD
 * @returns Profit in USD
 */
export function calculateProfitUsd(
  profitPercentage: DecimalValue,
  tradeSizeUsd: DecimalValue
): DecimalType {
  return toDecimal(tradeSizeUsd).times(profitPercentage).dividedBy(100);
}

/**
 * Calculate triangular arbitrage result
 * result = startAmount * rate1 * rate2 * rate3 * (1 - fee)^3
 *
 * @param startAmount - Starting amount
 * @param rates - Array of 3 exchange rates
 * @param feePerTrade - Fee per trade (decimal, e.g., 0.001 = 0.1%)
 * @returns Final amount after 3 trades
 */
export function calculateTriangularResult(
  startAmount: DecimalValue,
  rates: [DecimalValue, DecimalValue, DecimalValue],
  feePerTrade: DecimalValue
): DecimalType {
  const start = toDecimal(startAmount);
  const feeMultiplier = toDecimal(1).minus(feePerTrade);

  let result = start;

  for (const rate of rates) {
    result = result.times(rate).times(feeMultiplier);
  }

  return result;
}

/**
 * Calculate triangular arbitrage profit percentage
 *
 * @param startAmount - Starting amount
 * @param endAmount - Ending amount after all trades
 * @returns Profit percentage
 */
export function calculateTriangularProfit(
  startAmount: DecimalValue,
  endAmount: DecimalValue
): DecimalType {
  const start = toDecimal(startAmount);
  const end = toDecimal(endAmount);

  if (start.isZero()) {
    return toDecimal(0);
  }

  return end.minus(start).dividedBy(start).times(100);
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Get minimum of multiple decimal values
 */
export function min(...values: DecimalValue[]): DecimalType {
  if (values.length === 0) {
    throw new Error('min requires at least one value');
  }

  return values.reduce<DecimalType>(
    (minVal, val) => (toDecimal(val).lessThan(minVal) ? toDecimal(val) : minVal),
    toDecimal(values[0]!)
  );
}

/**
 * Get maximum of multiple decimal values
 */
export function max(...values: DecimalValue[]): DecimalType {
  if (values.length === 0) {
    throw new Error('max requires at least one value');
  }

  return values.reduce<DecimalType>(
    (maxVal, val) => (toDecimal(val).greaterThan(maxVal) ? toDecimal(val) : maxVal),
    toDecimal(values[0]!)
  );
}

/**
 * Round to significant figures (useful for display)
 */
export function roundToSignificant(value: DecimalValue, significantFigures: number): DecimalType {
  return toDecimal(value).toSignificantDigits(significantFigures);
}

/**
 * Format decimal for display with thousands separator
 */
export function formatForDisplay(value: DecimalValue, decimalPlaces = 2): string {
  const num = toDecimal(value).toFixed(decimalPlaces);
  const parts = num.split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  // Add thousands separator
  const formattedInteger = integerPart?.replace(/\B(?=(\d{3})+(?!\d))/g, ',') ?? '0';

  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

// Re-export Decimal constructor and type
export { Decimal };
export type { DecimalType };
