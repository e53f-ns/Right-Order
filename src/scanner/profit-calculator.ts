/**
 * Profit Calculator
 * Calculates real profit after fees, slippage, and all costs
 * Uses Decimal.js for precise financial calculations
 */

import { getTakerFee } from '../config/exchanges.js';
import { loadConfig } from '../config/index.js';
import type { ExchangeId } from '../config/schema.js';
import { calculateTransferCost } from '../config/transfer-fees.js';
import {
  createAmount,
  createPercentage,
  createUsdValue,
  type Percentage,
  type Price,
  type UsdValue,
} from '../types/branded.js';
import type { FeeBreakdown, SlippageEstimate, VolumeInfo } from '../types/opportunity.js';
import type { NormalizedOrderbook, OrderbookLevel } from '../types/orderbook.js';
import {
  toDecimal,
  toFixed,
  isGreaterThan,
  isLessThanOrEqual,
  isPositive,
  subtract,
  divide,
  multiply,
  add,
  min,
  type DecimalValue,
  type DecimalType,
} from '../utils/decimal.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('profit-calculator');

/**
 * Configuration for profit calculations
 */
export interface ProfitCalculatorConfig {
  /** Default trade size in USD */
  tradeSizeUsd: number;
  /** Slippage safety multiplier (1.0 = no buffer, 1.5 = 50% extra) */
  slippageMultiplier: number;
  /** Minimum liquidity depth levels to consider */
  minLiquidityLevels: number;
  /** Maximum acceptable slippage percentage */
  maxAcceptableSlippage: number;
  /** Use VIP maker fees instead of default taker fees */
  useVipFees: boolean;
  /** VIP fee percentage (e.g., 0.075 = 0.075%) */
  vipFeePercent: number;
  /** Minimum depth USD to consider executable */
  minDepthUsd: number;
}

// Load config from env
function getConfigFromEnv(): Partial<ProfitCalculatorConfig> {
  try {
    const cfg = loadConfig();
    return {
      tradeSizeUsd: cfg.env.TRADE_SIZE_USD,
      slippageMultiplier: cfg.env.SLIPPAGE_MULTIPLIER,
      useVipFees: cfg.env.USE_VIP_FEES,
      vipFeePercent: cfg.env.VIP_FEE_PERCENT,
      minDepthUsd: cfg.env.MIN_DEPTH_USD,
    };
  } catch {
    return {};
  }
}

const DEFAULT_CONFIG: ProfitCalculatorConfig = {
  tradeSizeUsd: 1000,
  slippageMultiplier: 1.0, // No buffer - realistic execution
  minLiquidityLevels: 5,
  maxAcceptableSlippage: 2.0, // 2%
  useVipFees: true,
  vipFeePercent: 0.075, // 0.075% VIP maker fee
  minDepthUsd: 50000, // $50k minimum depth for executable
  ...getConfigFromEnv(),
};

/**
 * Dynamic slippage multiplier based on liquidity depth
 * More liquid orderbooks need less buffer
 */
function getDynamicSlippageMultiplier(depthUsd: number, baseMultiplier: number): number {
  if (depthUsd >= 100000) return 1.0; // Very liquid: $100k+ depth
  if (depthUsd >= 50000) return Math.min(baseMultiplier, 1.05); // Liquid: $50k+
  if (depthUsd >= 20000) return Math.min(baseMultiplier, 1.1); // Medium: $20k+
  return baseMultiplier; // Use configured multiplier for thin orderbooks
}

/**
 * Result of profit calculation
 */
export interface ProfitCalculationResult {
  /** Gross spread before any costs */
  grossSpread: Percentage;
  /** Net profit after all costs */
  netProfit: Percentage;
  /** Estimated profit in USD */
  estimatedProfitUsd: UsdValue;
  /** Fee breakdown */
  fees: FeeBreakdown;
  /** Slippage estimate */
  slippage: SlippageEstimate;
  /** Volume info */
  volume: VolumeInfo;
  /** Whether the opportunity is executable (sufficient liquidity) */
  isExecutable: boolean;
  /** Confidence score 0-1 */
  confidence: number;
  /** Reasons if not profitable or not executable */
  issues: string[];
  /** Transfer network info for cross-exchange arbitrage */
  transferInfo?: {
    network: string;
    costUsd: number;
    costPercent: number;
    netAfterTransfer: number;
    timeMinutes: number;
  };
}

/**
 * Profit Calculator
 * Handles all profit-related calculations for arbitrage opportunities
 */
export class ProfitCalculator {
  private readonly config: ProfitCalculatorConfig;
  
  // Tracking for periodic summaries
  private calcCount = 0;
  private bestGrossSpread = toDecimal(-999);
  private bestGrossPair = '';
  private bestNetProfit = toDecimal(-999);
  private bestNetPair = '';

  constructor(config: Partial<ProfitCalculatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate profit for a simple arbitrage opportunity
   * Buy on exchange A (at ask), sell on exchange B (at bid)
   *
   * @param buyExchange - Exchange to buy on
   * @param sellExchange - Exchange to sell on
   * @param buyOrderbook - Orderbook from buy exchange
   * @param sellOrderbook - Orderbook from sell exchange
   * @param tradeSizeUsd - Optional override for trade size
   */
  calculateSimpleArbitrage(
    buyExchange: ExchangeId,
    sellExchange: ExchangeId,
    buyOrderbook: NormalizedOrderbook,
    sellOrderbook: NormalizedOrderbook,
    tradeSizeUsd?: number
  ): ProfitCalculationResult {
    const tradeSize = tradeSizeUsd ?? this.config.tradeSizeUsd;
    const issues: string[] = [];

    // Validate orderbooks have data
    if (buyOrderbook.asks.length === 0) {
      issues.push('Buy orderbook has no asks');
    }
    if (sellOrderbook.bids.length === 0) {
      issues.push('Sell orderbook has no bids');
    }

    if (issues.length > 0) {
      return this.createEmptyResult(issues);
    }

    // Get best prices (we already validated they exist)
    const buyPrice = buyOrderbook.asks[0]!.price; // Best ask on buy exchange
    const sellPrice = sellOrderbook.bids[0]!.price; // Best bid on sell exchange

    // Calculate gross spread
    const grossSpread = this.calculateGrossSpread(buyPrice, sellPrice);

    // Get fees
    const fees = this.calculateFees(buyExchange, sellExchange);

    // Debug: log every spread calculation with prices
    logger.debug({
      symbol: buyOrderbook.symbol,
      buyExchange,
      sellExchange,
      buyPrice: buyPrice.toString(),
      sellPrice: sellPrice.toString(),
      gross: toFixed(grossSpread, 6),
    }, `Calculated spread: symbol=${buyOrderbook.symbol} gross=${toFixed(grossSpread, 6)}% buyPrice=${buyPrice} sellPrice=${sellPrice}`);

    // Convert trade size to base amount using buy price
    const tradeSizeBase = this.usdToBase(tradeSize, buyPrice);

    // Calculate available liquidity first (needed for dynamic slippage)
    const volume = this.calculateVolume(
      buyOrderbook.asks,
      sellOrderbook.bids,
      buyPrice,
      tradeSize
    );

    // Get dynamic slippage multiplier based on liquidity depth
    const depthUsd = parseFloat(volume.availableBase) * parseFloat(buyPrice);
    const dynamicMultiplier = getDynamicSlippageMultiplier(depthUsd, this.config.slippageMultiplier);

    // Calculate slippage on both sides
    const buySlippage = this.calculateSlippage(
      tradeSizeBase,
      buyOrderbook.asks,
      buyPrice,
      'buy'
    );
    const sellSlippage = this.calculateSlippage(
      tradeSizeBase,
      sellOrderbook.bids,
      sellPrice,
      'sell'
    );

    // Total slippage = buy slippage + sell slippage (with dynamic multiplier)
    const rawSlippage = add(buySlippage, sellSlippage);
    const slippageWithMultiplier = multiply(rawSlippage, dynamicMultiplier);

    const slippage: SlippageEstimate = {
      estimated: createPercentage(toFixed(rawSlippage, 4)),
      withMultiplier: createPercentage(toFixed(slippageWithMultiplier, 4)),
    };

    // Check slippage threshold
    if (isGreaterThan(rawSlippage, this.config.maxAcceptableSlippage)) {
      issues.push(`Slippage too high: ${toFixed(rawSlippage, 2)}%`);
    }

    // Calculate net profit
    const netProfit = this.calculateNetProfit(grossSpread, fees.totalFee, slippageWithMultiplier);

    // Check if opportunity is executable (net > 0, sufficient depth)
    const isExecutable = this.checkExecutability(volume, tradeSize, depthUsd, netProfit, issues);

    // Calculate USD profit
    const estimatedProfitUsd = this.calculateUsdProfit(netProfit, tradeSize);

    // Calculate confidence score
    const confidence = this.calculateConfidence(
      buyOrderbook,
      sellOrderbook,
      netProfit,
      slippage.estimated,
      issues,
      depthUsd
    );

    // Detailed logging of spread calculations
    const isProfitable = isGreaterThan(netProfit, 0);
    const isNearProfitable = isGreaterThan(netProfit, -0.05); // Within 0.05% of profitable
    const grossSpreadValue = toFixed(grossSpread, 6);
    const netProfitValue = toFixed(netProfit, 6);
    const totalFeesValue = toFixed(add(toDecimal(fees.totalFee), toDecimal(slippage.withMultiplier)), 4);
    const realProfitUsd = multiply(toDecimal(tradeSize), divide(netProfit, 100)); // tradeSizeUsd * (net/100)
    
    // Track calculations for periodic summary
    this.calcCount++;
    
    // Track best spreads seen
    const currentGross = toDecimal(grossSpreadValue);
    const currentNet = toDecimal(netProfitValue);
    
    if (currentGross.greaterThan(this.bestGrossSpread)) {
      this.bestGrossSpread = currentGross;
      this.bestGrossPair = `${buyExchange}→${sellExchange}`;
    }
    if (currentNet.greaterThan(this.bestNetProfit)) {
      this.bestNetProfit = currentNet;
      this.bestNetPair = `${buyExchange}→${sellExchange}`;
    }
    
    // Log only profitable or near-profitable, plus periodic samples and executables
    const shouldLog = this.calcCount <= 10 || this.calcCount % 500 === 0 || isProfitable || isNearProfitable || isExecutable;
    
    if (shouldLog) {
      const emoji = isExecutable ? '🚀' : isProfitable ? '💰' : isNearProfitable ? '🔶' : '📊';
      const realUsdStr = toFixed(realProfitUsd, 2);
      const feeType = this.config.useVipFees ? `VIP ${this.config.vipFeePercent}%` : 'taker';
      const execStr = isExecutable ? ' [EXECUTABLE]' : '';
      logger.info(
        {
          route: `${buyExchange}→${sellExchange}`,
          gross: grossSpreadValue,
          fees: { type: feeType, total: fees.totalFee },
          slip: { raw: slippage.estimated, buffered: slippage.withMultiplier, mult: dynamicMultiplier.toFixed(2) },
          costs: totalFeesValue,
          net: netProfitValue,
          realUsd: realUsdStr,
          depth: `$${Math.round(depthUsd)}`,
          executable: isExecutable,
          conf: confidence.toFixed(2),
          num: this.calcCount,
        },
        `${emoji} ${buyExchange}→${sellExchange}: gross=${grossSpreadValue}% net=${netProfitValue}% ($${realUsdStr}) [${feeType}]${execStr}`
      );
    }
    
    // Extra log for executable opportunities
    if (isExecutable) {
      logger.info(
        {
          route: `${buyExchange}→${sellExchange}`,
          net: netProfitValue,
          profitUsd: toFixed(realProfitUsd, 2),
          depth: `$${Math.round(depthUsd)}`,
          tradeSize: tradeSize,
        },
        `🚀 EXECUTABLE OPPORTUNITY: ${buyExchange}→${sellExchange} net=${netProfitValue}% profit=$${toFixed(realProfitUsd, 2)}`
      );
    }
    
    // Log periodic summary every 2000 calculations
    if (this.calcCount % 2000 === 0) {
      logger.info(
        {
          calcs: this.calcCount,
          bestGross: `${this.bestGrossSpread.toFixed(3)}% (${this.bestGrossPair})`,
          bestNet: `${this.bestNetProfit.toFixed(3)}% (${this.bestNetPair})`,
        },
        `📈 Stats: ${this.calcCount} calcs | Best gross: ${this.bestGrossSpread.toFixed(3)}% | Best net: ${this.bestNetProfit.toFixed(3)}%`
      );
    }

    // Calculate transfer costs for cross-exchange arbitrage
    const symbol = buyOrderbook.symbol;
    const transferCost = calculateTransferCost(symbol, tradeSize);
    const profitUsdNum = parseFloat(toFixed(estimatedProfitUsd, 2));
    const netAfterTransfer = profitUsdNum - transferCost.costUsd;

    return {
      grossSpread: createPercentage(toFixed(grossSpread, 4)),
      netProfit: createPercentage(toFixed(netProfit, 4)),
      estimatedProfitUsd: createUsdValue(toFixed(estimatedProfitUsd, 2)),
      fees,
      slippage,
      volume,
      isExecutable,
      confidence,
      issues,
      transferInfo: {
        network: transferCost.network,
        costUsd: transferCost.costUsd,
        costPercent: transferCost.costPercent,
        netAfterTransfer,
        timeMinutes: transferCost.timeMinutes,
      },
    };
  }

  /**
   * Calculate gross spread percentage
   * grossSpread = (sellPrice - buyPrice) / buyPrice * 100
   */
  private calculateGrossSpread(buyPrice: Price, sellPrice: Price): DecimalType {
    const buy = toDecimal(buyPrice);
    const sell = toDecimal(sellPrice);

    return multiply(divide(subtract(sell, buy), buy), 100);
  }

  /**
   * Calculate fee breakdown for exchanges
   * Uses VIP maker fees if configured, otherwise default taker fees
   */
  calculateFees(buyExchange: ExchangeId, sellExchange: ExchangeId): FeeBreakdown {
    let buyFeePercent: DecimalType;
    let sellFeePercent: DecimalType;

    if (this.config.useVipFees) {
      // Use VIP maker fees (same for both exchanges)
      buyFeePercent = toDecimal(this.config.vipFeePercent);
      sellFeePercent = toDecimal(this.config.vipFeePercent);
    } else {
      // Get taker fees (market orders for arbitrage)
      const buyFeeDecimal = getTakerFee(buyExchange);
      const sellFeeDecimal = getTakerFee(sellExchange);
      buyFeePercent = multiply(buyFeeDecimal, 100);
      sellFeePercent = multiply(sellFeeDecimal, 100);
    }

    const totalFeePercent = add(buyFeePercent, sellFeePercent);

    return {
      buyFee: createPercentage(toFixed(buyFeePercent, 4)),
      sellFee: createPercentage(toFixed(sellFeePercent, 4)),
      totalFee: createPercentage(toFixed(totalFeePercent, 4)),
    };
  }

  /**
   * Calculate slippage from orderbook depth
   * Uses VWAP calculation comparing to best price
   * 
   * Returns actual slippage based on orderbook depth, NOT a penalty value.
   * If we can't fill the order, we calculate slippage for what we can fill.
   */
  private calculateSlippage(
    targetAmountBase: DecimalType,
    orderbookLevels: OrderbookLevel[],
    bestPrice: Price,
    side: 'buy' | 'sell'
  ): DecimalType {
    if (orderbookLevels.length === 0) {
      // No orderbook data - assume minimal slippage, will be caught by other checks
      return toDecimal(0.1); // 0.1% default
    }

    let remainingAmount = targetAmountBase;
    let totalCost = toDecimal(0);
    let filledAmount = toDecimal(0);

    for (const level of orderbookLevels) {
      if (isLessThanOrEqual(remainingAmount, 0)) break;

      const levelPrice = toDecimal(level.price);
      const levelAmount = toDecimal(level.amount);
      const fillAmount = min(remainingAmount, levelAmount);

      totalCost = add(totalCost, multiply(fillAmount, levelPrice));
      filledAmount = add(filledAmount, fillAmount);
      remainingAmount = subtract(remainingAmount, fillAmount);
    }

    // If we couldn't fill anything, return a reasonable default
    if (isLessThanOrEqual(filledAmount, 0)) {
      return toDecimal(0.5); // 0.5% default when no fill possible
    }

    // Calculate VWAP based on what we could fill
    const vwap = divide(totalCost, filledAmount);
    const best = toDecimal(bestPrice);

    // Slippage calculation depends on side
    // Buy: slippage = (VWAP - best) / best * 100 (VWAP should be >= best)
    // Sell: slippage = (best - VWAP) / best * 100 (VWAP should be <= best)
    let slippage: DecimalType;

    if (side === 'buy') {
      slippage = multiply(divide(subtract(vwap, best), best), 100);
    } else {
      slippage = multiply(divide(subtract(best, vwap), best), 100);
    }

    // Ensure non-negative (due to rounding or inverted spreads)
    if (!isPositive(slippage)) {
      return toDecimal(0);
    }

    // Add penalty if we couldn't fill the full order
    // Proportional to unfilled ratio, max 1% extra
    if (isPositive(remainingAmount)) {
      const unfillRatio = divide(remainingAmount, targetAmountBase);
      const penalty = min(multiply(unfillRatio, 1), toDecimal(1)); // Max 1% penalty
      slippage = add(slippage, penalty);
    }

    // Cap at reasonable maximum (2% per side)
    const maxSlippage = toDecimal(2);
    if (isGreaterThan(slippage, maxSlippage)) {
      return maxSlippage;
    }

    return slippage;
  }

  /**
   * Calculate net profit after all costs
   * netProfit = grossSpread - totalFees - slippage
   */
  private calculateNetProfit(
    grossSpread: DecimalValue,
    totalFees: Percentage,
    slippage: DecimalValue
  ): DecimalType {
    const spread = toDecimal(grossSpread);
    const fees = toDecimal(totalFees);
    const slip = toDecimal(slippage);

    return subtract(subtract(spread, fees), slip);
  }

  /**
   * Convert USD amount to base currency amount
   */
  private usdToBase(usdAmount: number, price: Price): DecimalType {
    return divide(usdAmount, toDecimal(price));
  }

  /**
   * Calculate volume information
   */
  private calculateVolume(
    buyAsks: OrderbookLevel[],
    sellBids: OrderbookLevel[],
    buyPrice: Price,
    tradeSizeUsd: number
  ): VolumeInfo {
    // Calculate available base liquidity (sum of amounts)
    let buyLiquidity = toDecimal(0);

    for (const level of buyAsks.slice(0, this.config.minLiquidityLevels)) {
      buyLiquidity = add(buyLiquidity, toDecimal(level.amount));
    }

    let sellLiquidity = toDecimal(0);

    for (const level of sellBids.slice(0, this.config.minLiquidityLevels)) {
      sellLiquidity = add(sellLiquidity, toDecimal(level.amount));
    }

    // Available = minimum of both sides
    const availableBase = min(buyLiquidity, sellLiquidity);

    // Calculate trade size in base
    const tradeSizeBase = this.usdToBase(tradeSizeUsd, buyPrice);

    // Use the smaller of available and desired
    const actualTradeBase = min(availableBase, tradeSizeBase);
    const actualTradeUsd = multiply(actualTradeBase, toDecimal(buyPrice));

    return {
      availableBase: createAmount(toFixed(availableBase, 8)),
      tradeSizeBase: createAmount(toFixed(actualTradeBase, 8)),
      tradeSizeUsd: createUsdValue(toFixed(actualTradeUsd, 2)),
    };
  }

  /**
   * Check if opportunity is executable
   * Requires: netProfit > 0 AND depth >= tradeSize * 2
   */
  private checkExecutability(
    volume: VolumeInfo,
    targetUsd: number,
    depthUsd: number,
    netProfit: DecimalType,
    issues: string[]
  ): boolean {
    const actualUsd = toDecimal(volume.tradeSizeUsd);
    const targetUsdDecimal = toDecimal(targetUsd);
    const minDepth = this.config.minDepthUsd;

    // Check 1: Net profit must be positive
    if (!isPositive(netProfit)) {
      return false;
    }

    // Check 2: Depth must be at least 2x trade size
    const requiredDepth = targetUsd * 2;
    if (depthUsd < requiredDepth) {
      issues.push(`Low depth: $${Math.round(depthUsd)} < $${requiredDepth} required`);
      return false;
    }

    // Check 3: Depth must meet minimum threshold
    if (depthUsd < minDepth) {
      issues.push(`Depth $${Math.round(depthUsd)} below min $${minDepth}`);
      return false;
    }

    // Check 4: Can execute at least 80% of target
    const minExecutableRatio = 0.8;
    const ratio = divide(actualUsd, targetUsdDecimal);

    if (isGreaterThan(minExecutableRatio, ratio)) {
      issues.push(
        `Insufficient liquidity: only $${volume.tradeSizeUsd} of $${targetUsd} available`
      );
      return false;
    }

    return true;
  }

  /**
   * Calculate USD profit from percentage and trade size
   */
  private calculateUsdProfit(profitPercent: DecimalValue, tradeSizeUsd: number): DecimalType {
    const profit = toDecimal(profitPercent);
    const tradeSize = toDecimal(tradeSizeUsd);

    return divide(multiply(tradeSize, profit), 100);
  }

  /**
   * Calculate confidence score (0-1)
   * Based on orderbook depth, data freshness, slippage, and profitability
   */
  private calculateConfidence(
    buyOrderbook: NormalizedOrderbook,
    sellOrderbook: NormalizedOrderbook,
    netProfit: DecimalValue,
    slippage: Percentage,
    issues: string[],
    depthUsd: number
  ): number {
    let confidence = 1.0;

    // Reduce confidence for each issue
    confidence -= issues.length * 0.1;

    // Reduce confidence if orderbooks are shallow
    const minLevels = this.config.minLiquidityLevels;

    if (buyOrderbook.asks.length < minLevels) {
      confidence -= 0.15;
    }
    if (sellOrderbook.bids.length < minLevels) {
      confidence -= 0.15;
    }

    // Reduce confidence for low depth (below 2x trade size)
    const minDepthForHighConf = this.config.tradeSizeUsd * 2;
    if (depthUsd < minDepthForHighConf) {
      confidence -= 0.4; // Significant penalty for low depth
    } else if (depthUsd < this.config.minDepthUsd) {
      confidence -= 0.2;
    }

    // Reduce confidence for high slippage
    const slippageValue = toDecimal(slippage);

    if (isGreaterThan(slippageValue, 0.5)) {
      confidence -= 0.1;
    }
    if (isGreaterThan(slippageValue, 1.0)) {
      confidence -= 0.2;
    }

    // Reduce confidence for negative profit
    if (!isPositive(netProfit)) {
      confidence -= 0.2;
    }

    // Clamp to 0-1
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Create empty result for invalid inputs
   */
  private createEmptyResult(issues: string[]): ProfitCalculationResult {
    return {
      grossSpread: createPercentage('0'),
      netProfit: createPercentage('0'),
      estimatedProfitUsd: createUsdValue('0'),
      fees: {
        buyFee: createPercentage('0'),
        sellFee: createPercentage('0'),
        totalFee: createPercentage('0'),
      },
      slippage: {
        estimated: createPercentage('0'),
        withMultiplier: createPercentage('0'),
      },
      volume: {
        availableBase: createAmount('0'),
        tradeSizeBase: createAmount('0'),
        tradeSizeUsd: createUsdValue('0'),
      },
      isExecutable: false,
      confidence: 0,
      issues,
    };
  }

  /**
   * Quick check if opportunity might be profitable
   * Use this to filter before doing full calculation
   */
  quickProfitCheck(
    buyPrice: Price,
    sellPrice: Price,
    buyExchange: ExchangeId,
    sellExchange: ExchangeId,
    minProfitThreshold: number
  ): boolean {
    // Calculate gross spread
    const grossSpread = this.calculateGrossSpread(buyPrice, sellPrice);

    // Quick fee estimate
    const fees = this.calculateFees(buyExchange, sellExchange);
    const totalFees = toDecimal(fees.totalFee);

    // Rough slippage estimate (0.1% default)
    const estimatedSlippage = 0.1;

    // Quick net profit estimate
    const netProfit = subtract(subtract(grossSpread, totalFees), estimatedSlippage);

    return isGreaterThan(netProfit, minProfitThreshold);
  }

  /**
   * Get current configuration
   */
  getConfig(): ProfitCalculatorConfig {
    return { ...this.config };
  }

  /**
   * Update trade size
   */
  setTradeSize(tradeSizeUsd: number): void {
    this.config.tradeSizeUsd = tradeSizeUsd;
  }

  /**
   * Update slippage multiplier
   */
  setSlippageMultiplier(multiplier: number): void {
    this.config.slippageMultiplier = multiplier;
  }
}

// Singleton instance
let calculatorInstance: ProfitCalculator | null = null;

/**
 * Get the global profit calculator
 */
export function getProfitCalculator(config?: Partial<ProfitCalculatorConfig>): ProfitCalculator {
  calculatorInstance ??= new ProfitCalculator(config);
  return calculatorInstance;
}

/**
 * Recalculate spread profit based on user deposit size
 * Returns adjusted profitUsd, minDepositUsd, maxDepositUsd
 */
export function recalculateProfitForDeposit(
  netPercent: number,
  depthUsd: number,
  userDepositUsd: number
): { profitUsd: number; minDepositUsd: number; maxDepositUsd: number; effectiveDeposit: number } {
  // Effective deposit is capped at available depth
  const effectiveDeposit = Math.min(userDepositUsd, depthUsd);
  
  // Profit = deposit * (netPercent / 100)
  const profitUsd = effectiveDeposit * (netPercent / 100);
  
  // MinDep is typically $50-100 for most exchanges
  const minDepositUsd = 50;
  
  // MaxDep is the available depth
  const maxDepositUsd = depthUsd;
  
  return {
    profitUsd,
    minDepositUsd,
    maxDepositUsd,
    effectiveDeposit,
  };
}

/**
 * Reset the global profit calculator (mainly for testing)
 */
export function resetProfitCalculator(): void {
  calculatorInstance = null;
}
