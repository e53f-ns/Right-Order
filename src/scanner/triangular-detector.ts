/**
 * Triangular Arbitrage Detector
 * Detects triangular arbitrage opportunities on a single exchange
 * 
 * Example path: USDT → BTC → ETH → USDT
 * - Step 1: Buy BTC with USDT (BTC/USDT pair, buy at ask)
 * - Step 2: Buy ETH with BTC (ETH/BTC pair, buy at ask)
 * - Step 3: Sell ETH for USDT (ETH/USDT pair, sell at bid)
 */

import { v4 as uuidv4 } from 'uuid';

import { getTakerFee } from '../config/exchanges.js';
import type { ExchangeId } from '../config/schema.js';
import { getDashboardStore, type RawSpreadData } from '../dashboard/index.js';
import {
  createAmount,
  createOpportunityId,
  createPercentage,
  createUsdValue,
  nowTimestampMs,
  type Percentage,
  type Price,
  type TradingSymbol,
} from '../types/branded.js';
import type {
  TriangularArbitrageOpportunity,
  TriangularStep,
  OpportunityEvent,
} from '../types/opportunity.js';
import type { NormalizedOrderbook, OrderbookLevel } from '../types/orderbook.js';
import {
  toDecimal,
  toFixed,
  isGreaterThan,
  isLessThanOrEqual,
  multiply,
  divide,
  subtract,
  add,
  min,
  type DecimalType,
} from '../utils/decimal.js';
import { createLogger } from '../utils/logger.js';
import { sendArbitrageAlert } from '../utils/telegram.js';
import { nowMs } from '../utils/time.js';

import {
  getPathFinder,
  type PathFinder,
  type PathFinderConfig,
  type TriangularPath,
  type PathStep,
} from './path-finder.js';

const logger = createLogger('triangular-detector');

// Dashboard integration flag
let dashboardEnabled = false;
let dashboardStore: ReturnType<typeof getDashboardStore> | null = null;

/**
 * Enable dashboard integration for triangular detector
 */
export function enableTriangularDashboard(): void {
  dashboardEnabled = true;
  dashboardStore = getDashboardStore();
  logger.info('Dashboard integration enabled for TriangularDetector');
}

/**
 * Push triangular spread to dashboard (if enabled)
 * Executable opportunities get high priority for alerts
 */
function pushTriangularToDashboard(data: Omit<RawSpreadData, 'id' | 'timestamp'>): void {
  if (dashboardEnabled && dashboardStore !== null) {
    dashboardStore.addSpread(data);
    logger.debug({
      symbol: data.symbol,
      net: data.netPercent.toFixed(3),
      gross: data.grossPercent.toFixed(3),
      path: data.pathDescription,
    }, `Triangular spread pushed: ${data.symbol} net ${data.netPercent.toFixed(3)}%`);
  }
  
  // Determine if we should send alert
  // Priority 1: Executable (net > 0, sufficient depth)
  // Priority 2: Gross > 0.05% (good opportunity)
  // Priority 3: Near profitable (net > -0.05%)
  const isExecutable = data.executable === true;
  const hasGoodGross = data.grossPercent > 0.05;
  const isNearProfitable = data.netPercent > -0.05;
  const shouldAlert = isExecutable || hasGoodGross || isNearProfitable;
  
  if (shouldAlert) {
    sendArbitrageAlert({
      type: data.type,
      symbol: data.symbol,
      buyExchange: data.buyExchange,
      sellExchange: data.sellExchange,
      grossPercent: data.grossPercent,
      netPercent: data.netPercent,
      profitUsd: data.profitUsd,
      depthUsd: data.depthUsd,
      executable: isExecutable,
      ...(data.pathDescription !== undefined && { pathDescription: data.pathDescription }),
    }).catch(() => {
      // Silently ignore telegram errors
    });
    
    if (isExecutable) {
      logger.info(
        { symbol: data.symbol, path: data.pathDescription, net: data.netPercent, profit: data.profitUsd },
        `🚀 EXECUTABLE TRI pushed to dashboard: ${data.pathDescription} net=${data.netPercent.toFixed(3)}%`
      );
    }
  }
}

/**
 * Configuration for the triangular detector
 */
export interface TriangularDetectorConfig {
  /** Minimum net profit threshold (percentage) */
  minProfitThreshold: number;
  /** Minimum profit in USD (filter out tiny opportunities) */
  minProfitUsd: number;
  /** Maximum orderbook age to consider (ms) */
  maxOrderbookAgeMs: number;
  /** Trade size in USD (starting amount) */
  tradeSizeUsd: number;
  /** Slippage multiplier for safety */
  slippageMultiplier: number;
  /** Minimum confidence score (0-1) */
  minConfidence: number;
  /** Dedupe window: ignore same opportunity if seen within this time (ms) */
  dedupeWindowMs: number;
  /** Path finder configuration */
  pathFinderConfig?: Partial<PathFinderConfig>;
  /** Callback for new opportunities */
  onOpportunity?: (event: OpportunityEvent) => void;
}

const DEFAULT_CONFIG: TriangularDetectorConfig = {
  minProfitThreshold: 0.08, // 0.08% minimum for triangular (lowered for VIP fees)
  minProfitUsd: 1.0, // $1.00 minimum profit
  maxOrderbookAgeMs: 1500, // Stricter for triangular (3 trades = more time sensitivity)
  tradeSizeUsd: 1000, // $1000 trade size (lowered)
  slippageMultiplier: 1.0, // No buffer - realistic execution
  minConfidence: 0.4, // Lowered to show more opportunities
  dedupeWindowMs: 15000, // 15 seconds between same path alerts
};

/**
 * Key for tracking seen opportunities
 */
type PathKey = string;

/**
 * Price change threshold to consider opportunity as "new"
 */
const PRICE_CHANGE_THRESHOLD = 0.001; // 0.1%

/**
 * Tracked opportunity info for dedupe and alert throttling
 */
interface TrackedOpportunity {
  lastSeenAt: number;
  lastAlertAt: number;
  lastNetProfit: number;
  count: number;
  alertCount: number;
}

/**
 * Orderbook cache per exchange/symbol
 */
type OrderbookCache = Map<TradingSymbol, NormalizedOrderbook>;

/**
 * Result of a single step calculation
 */
interface StepResult {
  amountIn: DecimalType;
  amountOut: DecimalType;
  price: Price;
  fee: Percentage;
  slippage: DecimalType;
  isExecutable: boolean;
}

/**
 * Result of full path calculation
 */
interface PathCalculationResult {
  steps: [StepResult, StepResult, StepResult];
  startAmount: DecimalType;
  endAmount: DecimalType;
  netProfit: DecimalType; // Percentage
  totalFees: DecimalType; // Percentage
  totalSlippage: DecimalType; // Percentage
  profitUsd: DecimalType;
  isExecutable: boolean;
  confidence: number;
  issues: string[];
}

/**
 * Triangular Arbitrage Detector
 * Scans for triangular arbitrage opportunities on a single exchange
 */
export class TriangularDetector {
  private readonly config: TriangularDetectorConfig;
  private readonly pathFinder: PathFinder;
  private readonly opportunityCallbacks: Set<(event: OpportunityEvent) => void> = new Set();
  private readonly trackedOpportunities: Map<PathKey, TrackedOpportunity> = new Map();
  private readonly orderbookCache: Map<ExchangeId, OrderbookCache> = new Map();
  private isRunning = false;

  // Stats
  private scanCount = 0;
  private totalPathsChecked = 0;
  private totalOpportunitiesFound = 0;

  constructor(config: Partial<TriangularDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pathFinder = getPathFinder(this.config.pathFinderConfig);

    if (this.config.onOpportunity !== undefined) {
      this.opportunityCallbacks.add(this.config.onOpportunity);
    }
  }

  /**
   * Start the detector
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Triangular detector already running');
      return;
    }

    this.isRunning = true;

    logger.info(
      {
        minProfitThreshold: this.config.minProfitThreshold,
        tradeSizeUsd: this.config.tradeSizeUsd,
        maxOrderbookAgeMs: this.config.maxOrderbookAgeMs,
      },
      'Triangular arbitrage detector started'
    );
  }

  /**
   * Stop the detector
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Triangular arbitrage detector stopped');
  }

  /**
   * Process an orderbook update
   * Call this when a new orderbook arrives
   */
  processOrderbook(orderbook: NormalizedOrderbook): void {
    if (!this.isRunning) return;

    const { exchange, symbol } = orderbook;

    // Update cache
    let exchangeCache = this.orderbookCache.get(exchange);
    if (exchangeCache === undefined) {
      exchangeCache = new Map();
      this.orderbookCache.set(exchange, exchangeCache);
    }
    exchangeCache.set(symbol, orderbook);

    // Scan for opportunities on this exchange
    this.scanExchange(exchange);
  }

  /**
   * Scan an exchange for triangular opportunities
   */
  private scanExchange(exchange: ExchangeId): void {
    const exchangeCache = this.orderbookCache.get(exchange);
    if (exchangeCache === undefined || exchangeCache.size < 2) {
      return; // Need at least 2 pairs for any triangular
    }

    // Get available pairs
    const availablePairs = new Set(exchangeCache.keys());

    // Get paths for this exchange
    const allPaths = this.pathFinder.getPathsForExchange(exchange);

    // Filter to paths we can actually check
    const validPaths = this.pathFinder.filterAvailablePaths(allPaths, availablePairs);

    if (validPaths.length === 0) {
      return;
    }

    this.scanCount++;
    const shouldLogDetails = this.scanCount <= 20 || this.scanCount % 200 === 0;

    let pathsChecked = 0;
    let profitablePaths = 0;
    let staleSkipped = 0;
    const bestProfit: { netProfit: string; path: string } = { netProfit: '-999', path: '' };

    for (const path of validPaths) {
      // Get orderbooks for all 3 pairs
      const orderbooks = this.getOrderbooksForPath(path, exchangeCache);
      
      if (orderbooks === null) {
        continue;
      }

      // Check staleness
      const maxAge = Math.max(
        this.getOrderbookAge(orderbooks[0]),
        this.getOrderbookAge(orderbooks[1]),
        this.getOrderbookAge(orderbooks[2])
      );

      if (maxAge > this.config.maxOrderbookAgeMs) {
        staleSkipped++;
        continue;
      }

      pathsChecked++;
      this.totalPathsChecked++;

      // Calculate profit
      const result = this.calculatePathProfit(path, orderbooks);

      // Track best
      const netProfitNum = result.netProfit.toNumber();
      if (netProfitNum > parseFloat(bestProfit.netProfit)) {
        bestProfit.netProfit = toFixed(result.netProfit, 4);
        bestProfit.path = path.description;
      }

      // Check if profitable
      const passesThreshold = isGreaterThan(result.netProfit, this.config.minProfitThreshold);
      const passesUsdThreshold = isGreaterThan(result.profitUsd, this.config.minProfitUsd);
      const isConfident = result.confidence >= this.config.minConfidence;

      // Deduplication
      const pathKey = path.id;
      const tracked = this.trackedOpportunities.get(pathKey);
      const now = nowMs();
      
      const isNew = tracked === undefined ||
        Math.abs(netProfitNum - tracked.lastNetProfit) > PRICE_CHANGE_THRESHOLD * 100;
      
      const shouldAlert = tracked === undefined ||
        (now - tracked.lastAlertAt > this.config.dedupeWindowMs) ||
        (netProfitNum > tracked.lastNetProfit + 0.05);

      // Log near-profitable for debugging
      const isNearProfitable = netProfitNum > -0.1;
      
      // Push to dashboard (even near-profitable)
      if (isNearProfitable || netProfitNum > -0.3) {
        const grossPercent = result.netProfit.toNumber() + result.totalFees.toNumber() + result.totalSlippage.toNumber();
        pushTriangularToDashboard({
          type: 'triangular',
          symbol: path.requiredPairs[0] as string,
          buyExchange: exchange,
          sellExchange: exchange,
          buyPrice: 0, // N/A for triangular
          sellPrice: 0,
          grossPercent,
          netPercent: netProfitNum,
          profitUsd: result.profitUsd.toNumber(),
          depthUsd: this.config.tradeSizeUsd,
          confidence: result.confidence,
          fees: result.totalFees.toNumber(),
          slippage: result.totalSlippage.toNumber(),
          pathDescription: path.description,
        });
      }
      
      if (isNearProfitable && result.isExecutable && (isNew || this.scanCount % 200 === 0)) {
        const emoji = netProfitNum > 0 ? '🔺' : '🔶';
        logger.info(
          {
            exchange,
            path: path.description,
            net: toFixed(result.netProfit, 4),
            fees: toFixed(result.totalFees, 4),
            slip: toFixed(result.totalSlippage, 4),
            usd: toFixed(result.profitUsd, 2),
            conf: result.confidence.toFixed(2),
          },
          `${emoji} TRI ${netProfitNum > 0 ? 'PROFIT' : 'NEAR'}: ${path.description} net=${toFixed(result.netProfit, 4)}% ($${toFixed(result.profitUsd, 2)})`
        );
      }

      // Handle profitable opportunities
      if (passesThreshold && passesUsdThreshold && isConfident && result.isExecutable && shouldAlert) {
        profitablePaths++;
        this.totalOpportunitiesFound++;

        // Update tracking
        this.trackedOpportunities.set(pathKey, {
          lastSeenAt: now,
          lastAlertAt: now,
          lastNetProfit: netProfitNum,
          count: (tracked?.count ?? 0) + 1,
          alertCount: (tracked?.alertCount ?? 0) + 1,
        });

        logger.info(
          {
            exchange,
            path: path.description,
            net: toFixed(result.netProfit, 4),
            usd: toFixed(result.profitUsd, 2),
            fees: toFixed(result.totalFees, 4),
            slip: toFixed(result.totalSlippage, 4),
            conf: result.confidence.toFixed(2),
            alertNum: tracked?.alertCount ?? 1,
          },
          `🚀 TRI ALERT: ${path.description} | net=${toFixed(result.netProfit, 4)}% ($${toFixed(result.profitUsd, 2)})`
        );

        this.emitOpportunity(path, result, orderbooks, isNew, tracked);
      } else if (tracked !== undefined) {
        tracked.lastSeenAt = now;
        tracked.lastNetProfit = netProfitNum;
        tracked.count++;
      }
    }

    // Summary log
    if (shouldLogDetails || profitablePaths > 0) {
      const bestNetNum = parseFloat(bestProfit.netProfit);
      const emoji = bestNetNum > 0 ? '🔺' : bestNetNum > -0.1 ? '🔶' : '📊';

      logger.info(
        {
          exchange,
          scan: this.scanCount,
          paths: pathsChecked,
          alerts: profitablePaths,
          stale: staleSkipped,
          best: bestProfit.path ? `${bestProfit.path} ${bestProfit.netProfit}%` : '-',
        },
        `${emoji} TRI #${this.scanCount}: ${exchange} | ${pathsChecked} paths | Best: ${bestProfit.netProfit}% | ${profitablePaths} alerts`
      );
    }
  }

  /**
   * Get orderbooks for a path
   */
  private getOrderbooksForPath(
    path: TriangularPath,
    cache: OrderbookCache
  ): [NormalizedOrderbook, NormalizedOrderbook, NormalizedOrderbook] | null {
    const ob1 = cache.get(path.requiredPairs[0]);
    const ob2 = cache.get(path.requiredPairs[1]);
    const ob3 = cache.get(path.requiredPairs[2]);

    if (ob1 === undefined || ob2 === undefined || ob3 === undefined) {
      return null;
    }

    return [ob1, ob2, ob3];
  }

  /**
   * Calculate profit for a triangular path
   */
  private calculatePathProfit(
    path: TriangularPath,
    orderbooks: [NormalizedOrderbook, NormalizedOrderbook, NormalizedOrderbook]
  ): PathCalculationResult {
    const issues: string[] = [];
    const feeDecimal = toDecimal(getTakerFee(path.exchange));
    const feePercent = multiply(feeDecimal, 100);

    // Convert starting USD to the starting currency
    // For simplicity, we use a reference price (first step's price)
    const startAmountUsd = toDecimal(this.config.tradeSizeUsd);
    
    // Get the first orderbook to determine starting amount
    const step1 = path.steps[0];
    let startAmount: DecimalType;
    
    if (step1.side === 'buy') {
      // Starting with quote currency (e.g., USDT), buying base
      // Use the ask price to convert USD to start amount
      const askPrice = orderbooks[0].asks[0]?.price;
      if (askPrice === undefined) {
        issues.push('No ask price for step 1');
        return this.createEmptyResult(issues);
      }
      // If our start currency IS USDT/USD, use tradeSize directly
      if (step1.inputCurrency === 'USDT' || step1.inputCurrency === 'USDC') {
        startAmount = startAmountUsd;
      } else {
        // Convert from USD to start currency (rough estimate)
        startAmount = divide(startAmountUsd, toDecimal(askPrice));
      }
    } else {
      // Starting with base currency (e.g., BTC), selling it
      const bidPrice = orderbooks[0].bids[0]?.price;
      if (bidPrice === undefined) {
        issues.push('No bid price for step 1');
        return this.createEmptyResult(issues);
      }
      startAmount = divide(startAmountUsd, toDecimal(bidPrice));
    }

    // Calculate each step
    const stepResults: StepResult[] = [];
    let currentAmount = startAmount;
    let totalSlippage = toDecimal(0);

    for (let i = 0; i < 3; i++) {
      const step = path.steps[i]!;
      const orderbook = orderbooks[i]!;

      const result = this.calculateStep(step, orderbook, currentAmount, feeDecimal);
      stepResults.push(result);

      if (!result.isExecutable) {
        issues.push(`Step ${i + 1} not executable: insufficient liquidity`);
      }

      totalSlippage = add(totalSlippage, result.slippage);
      currentAmount = result.amountOut;
    }

    const endAmount = currentAmount;

    // Calculate net profit
    // profit = (endAmount - startAmount) / startAmount * 100
    const grossProfit = multiply(divide(subtract(endAmount, startAmount), startAmount), 100);
    
    // Total fees = 3 * fee per trade (as percentage)
    const totalFees = multiply(feePercent, 3);
    
    // Apply slippage multiplier
    const slippageWithMultiplier = multiply(totalSlippage, this.config.slippageMultiplier);
    
    // Net profit = gross - fees (fees already applied in step calculation, so this is double-counting)
    // Actually, we need to recalculate: gross already includes fees from step calculations
    // The step calculation already applies (1 - fee) to the output, so gross is actually net of fees
    // We just need to subtract slippage
    const netProfit = subtract(grossProfit, slippageWithMultiplier);

    // Calculate USD profit
    const profitUsd = multiply(startAmountUsd, divide(netProfit, 100));

    // Check executability
    const isExecutable = stepResults.every((s) => s.isExecutable) && issues.length === 0;

    // Calculate confidence
    const confidence = this.calculateConfidence(orderbooks, netProfit, slippageWithMultiplier, issues);

    return {
      steps: stepResults as [StepResult, StepResult, StepResult],
      startAmount,
      endAmount,
      netProfit,
      totalFees,
      totalSlippage: slippageWithMultiplier,
      profitUsd,
      isExecutable,
      confidence,
      issues,
    };
  }

  /**
   * Calculate a single step
   */
  private calculateStep(
    step: PathStep,
    orderbook: NormalizedOrderbook,
    amountIn: DecimalType,
    feeDecimal: DecimalType
  ): StepResult {
    const feePercent = createPercentage(toFixed(multiply(feeDecimal, 100), 4));

    if (step.side === 'buy') {
      // Buying base with quote
      // We have quote currency, want to buy base
      // Price = ask (we pay at ask), amountOut = amountIn / askPrice * (1 - fee)
      const asks = orderbook.asks;
      if (asks.length === 0) {
        return this.createEmptyStepResult(feePercent);
      }

      const bestAsk = asks[0]!;
      const { vwap, isPartial, slippage } = this.calculateVwapBuy(
        amountIn,
        asks,
        bestAsk.price
      );

      const amountOut = multiply(divide(amountIn, vwap), subtract(1, feeDecimal));

      return {
        amountIn,
        amountOut,
        price: bestAsk.price,
        fee: feePercent,
        slippage,
        isExecutable: !isPartial,
      };
    } else {
      // Selling base for quote
      // We have base currency, want to sell for quote
      // Price = bid (we receive at bid), amountOut = amountIn * bidPrice * (1 - fee)
      const bids = orderbook.bids;
      if (bids.length === 0) {
        return this.createEmptyStepResult(feePercent);
      }

      const bestBid = bids[0]!;
      const { vwap, isPartial, slippage } = this.calculateVwapSell(
        amountIn,
        bids,
        bestBid.price
      );

      const amountOut = multiply(multiply(amountIn, vwap), subtract(1, feeDecimal));

      return {
        amountIn,
        amountOut,
        price: bestBid.price,
        fee: feePercent,
        slippage,
        isExecutable: !isPartial,
      };
    }
  }

  /**
   * Calculate VWAP for a buy order (consuming asks)
   */
  private calculateVwapBuy(
    amountIn: DecimalType, // Quote currency amount we want to spend
    asks: OrderbookLevel[],
    bestPrice: Price
  ): { vwap: DecimalType; fillAmount: DecimalType; isPartial: boolean; slippage: DecimalType } {
    let remainingQuote = amountIn;
    let totalBase = toDecimal(0);
    let totalCost = toDecimal(0);

    for (const level of asks) {
      if (isLessThanOrEqual(remainingQuote, 0)) break;

      const levelPrice = toDecimal(level.price);
      const levelAmount = toDecimal(level.amount);
      const levelCost = multiply(levelAmount, levelPrice);

      if (isGreaterThan(levelCost, remainingQuote)) {
        // Partial fill at this level
        const fillBase = divide(remainingQuote, levelPrice);
        totalBase = add(totalBase, fillBase);
        totalCost = add(totalCost, remainingQuote);
        remainingQuote = toDecimal(0);
      } else {
        // Full fill at this level
        totalBase = add(totalBase, levelAmount);
        totalCost = add(totalCost, levelCost);
        remainingQuote = subtract(remainingQuote, levelCost);
      }
    }

    const isPartial = isGreaterThan(remainingQuote, 0);
    const vwap = isGreaterThan(totalBase, 0) ? divide(totalCost, totalBase) : toDecimal(bestPrice);
    
    // Slippage = (VWAP - best) / best * 100
    const best = toDecimal(bestPrice);
    const slippage = multiply(divide(subtract(vwap, best), best), 100);

    return {
      vwap,
      fillAmount: totalBase,
      isPartial,
      slippage: isGreaterThan(slippage, 0) ? slippage : toDecimal(0),
    };
  }

  /**
   * Calculate VWAP for a sell order (consuming bids)
   */
  private calculateVwapSell(
    amountIn: DecimalType, // Base currency amount we want to sell
    bids: OrderbookLevel[],
    bestPrice: Price
  ): { vwap: DecimalType; fillAmount: DecimalType; isPartial: boolean; slippage: DecimalType } {
    let remainingBase = amountIn;
    let totalQuote = toDecimal(0);
    let filledBase = toDecimal(0);

    for (const level of bids) {
      if (isLessThanOrEqual(remainingBase, 0)) break;

      const levelPrice = toDecimal(level.price);
      const levelAmount = toDecimal(level.amount);
      const fillAmount = min(remainingBase, levelAmount);

      totalQuote = add(totalQuote, multiply(fillAmount, levelPrice));
      filledBase = add(filledBase, fillAmount);
      remainingBase = subtract(remainingBase, fillAmount);
    }

    const isPartial = isGreaterThan(remainingBase, 0);
    const vwap = isGreaterThan(filledBase, 0) ? divide(totalQuote, filledBase) : toDecimal(bestPrice);
    
    // Slippage = (best - VWAP) / best * 100 (for sells, VWAP is lower)
    const best = toDecimal(bestPrice);
    const slippage = multiply(divide(subtract(best, vwap), best), 100);

    return {
      vwap,
      fillAmount: filledBase,
      isPartial,
      slippage: isGreaterThan(slippage, 0) ? slippage : toDecimal(0),
    };
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    orderbooks: [NormalizedOrderbook, NormalizedOrderbook, NormalizedOrderbook],
    netProfit: DecimalType,
    slippage: DecimalType,
    issues: string[]
  ): number {
    let confidence = 1.0;

    // Reduce for issues
    confidence -= issues.length * 0.15;

    // Reduce for shallow orderbooks
    for (const ob of orderbooks) {
      if (ob.asks.length < 5 || ob.bids.length < 5) {
        confidence -= 0.1;
      }
    }

    // Reduce for high slippage
    if (isGreaterThan(slippage, 0.3)) confidence -= 0.1;
    if (isGreaterThan(slippage, 0.5)) confidence -= 0.15;
    if (isGreaterThan(slippage, 1.0)) confidence -= 0.2;

    // Reduce for negative profit
    if (!isGreaterThan(netProfit, 0)) {
      confidence -= 0.3;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Create empty result for invalid calculations
   */
  private createEmptyResult(issues: string[]): PathCalculationResult {
    const emptyStep: StepResult = {
      amountIn: toDecimal(0),
      amountOut: toDecimal(0),
      price: '0' as Price,
      fee: createPercentage('0'),
      slippage: toDecimal(0),
      isExecutable: false,
    };

    return {
      steps: [emptyStep, emptyStep, emptyStep],
      startAmount: toDecimal(0),
      endAmount: toDecimal(0),
      netProfit: toDecimal(-100),
      totalFees: toDecimal(0),
      totalSlippage: toDecimal(0),
      profitUsd: toDecimal(0),
      isExecutable: false,
      confidence: 0,
      issues,
    };
  }

  /**
   * Create empty step result
   */
  private createEmptyStepResult(fee: Percentage): StepResult {
    return {
      amountIn: toDecimal(0),
      amountOut: toDecimal(0),
      price: '0' as Price,
      fee,
      slippage: toDecimal(0),
      isExecutable: false,
    };
  }

  /**
   * Get orderbook age
   */
  private getOrderbookAge(orderbook: NormalizedOrderbook): number {
    return nowMs() - orderbook.receivedAt;
  }

  /**
   * Emit opportunity event
   */
  private emitOpportunity(
    path: TriangularPath,
    result: PathCalculationResult,
    _orderbooks: [NormalizedOrderbook, NormalizedOrderbook, NormalizedOrderbook],
    isNew: boolean,
    tracked: TrackedOpportunity | undefined
  ): void {
    const steps: [TriangularStep, TriangularStep, TriangularStep] = [
      this.createTriangularStep(path.steps[0], result.steps[0]),
      this.createTriangularStep(path.steps[1], result.steps[1]),
      this.createTriangularStep(path.steps[2], result.steps[2]),
    ];

    const opportunity: TriangularArbitrageOpportunity = {
      id: createOpportunityId(uuidv4()),
      type: 'triangular',
      exchange: path.exchange,
      path: steps,
      pathDescription: path.description,
      startAmount: createAmount(toFixed(result.startAmount, 8)),
      endAmount: createAmount(toFixed(result.endAmount, 8)),
      startCurrency: path.startCurrency,
      netProfit: createPercentage(toFixed(result.netProfit, 4)),
      estimatedProfitUsd: createUsdValue(toFixed(result.profitUsd, 2)),
      totalFees: createPercentage(toFixed(result.totalFees, 4)),
      estimatedSlippage: createPercentage(toFixed(result.totalSlippage, 4)),
      timestamp: nowTimestampMs(),
      isStale: false,
      confidence: result.confidence,
    };

    const event: OpportunityEvent = {
      opportunity,
      isNew,
      priceChanged: tracked !== undefined && Math.abs(result.netProfit.toNumber() - tracked.lastNetProfit) > PRICE_CHANGE_THRESHOLD * 100,
      ...(tracked !== undefined && { previousProfit: String(tracked.lastNetProfit) as Percentage }),
    };

    for (const callback of this.opportunityCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Error in opportunity callback'
        );
      }
    }
  }

  /**
   * Create a TriangularStep from PathStep and StepResult
   */
  private createTriangularStep(step: PathStep, result: StepResult): TriangularStep {
    return {
      pair: step.pair,
      side: step.side,
      price: result.price,
      fee: result.fee,
      amountIn: createAmount(toFixed(result.amountIn, 8)),
      amountOut: createAmount(toFixed(result.amountOut, 8)),
    };
  }

  /**
   * Add opportunity callback
   */
  onOpportunity(callback: (event: OpportunityEvent) => void): void {
    this.opportunityCallbacks.add(callback);
  }

  /**
   * Remove opportunity callback
   */
  offOpportunity(callback: (event: OpportunityEvent) => void): void {
    this.opportunityCallbacks.delete(callback);
  }

  /**
   * Force scan all exchanges
   */
  scanAll(): TriangularArbitrageOpportunity[] {
    const opportunities: TriangularArbitrageOpportunity[] = [];

    const captureCallback = (event: OpportunityEvent): void => {
      if (event.opportunity.type === 'triangular') {
        opportunities.push(event.opportunity);
      }
    };

    this.opportunityCallbacks.add(captureCallback);

    for (const exchange of this.orderbookCache.keys()) {
      this.scanExchange(exchange);
    }

    this.opportunityCallbacks.delete(captureCallback);

    return opportunities;
  }

  /**
   * Get configuration
   */
  getConfig(): TriangularDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update profit threshold
   */
  setMinProfitThreshold(threshold: number): void {
    this.config.minProfitThreshold = threshold;
    logger.info({ threshold }, 'Triangular profit threshold updated');
  }

  /**
   * Update trade size
   */
  setTradeSize(tradeSizeUsd: number): void {
    this.config.tradeSizeUsd = tradeSizeUsd;
    logger.info({ tradeSizeUsd }, 'Triangular trade size updated');
  }

  /**
   * Get stats
   */
  getStats(): {
    scanCount: number;
    totalPathsChecked: number;
    totalOpportunitiesFound: number;
    trackedPaths: number;
    cachedExchanges: number;
  } {
    return {
      scanCount: this.scanCount,
      totalPathsChecked: this.totalPathsChecked,
      totalOpportunitiesFound: this.totalOpportunitiesFound,
      trackedPaths: this.trackedOpportunities.size,
      cachedExchanges: this.orderbookCache.size,
    };
  }

  /**
   * Clear tracked opportunities
   */
  clearTracked(): void {
    this.trackedOpportunities.clear();
  }

  /**
   * Clear orderbook cache for an exchange
   */
  clearCache(exchange?: ExchangeId): void {
    if (exchange !== undefined) {
      this.orderbookCache.delete(exchange);
    } else {
      this.orderbookCache.clear();
    }
  }

  /**
   * Cleanup old tracked opportunities
   */
  cleanupOldTracked(): number {
    const now = nowMs();
    const maxAge = this.config.dedupeWindowMs * 10;
    let cleanedCount = 0;

    for (const [key, tracked] of this.trackedOpportunities) {
      if (now - tracked.lastSeenAt > maxAge) {
        this.trackedOpportunities.delete(key);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}

// Singleton instance
let detectorInstance: TriangularDetector | null = null;

/**
 * Get the global triangular detector
 */
export function getTriangularDetector(
  config?: Partial<TriangularDetectorConfig>
): TriangularDetector {
  detectorInstance ??= new TriangularDetector(config);
  return detectorInstance;
}

/**
 * Reset the global detector (mainly for testing)
 */
export function resetTriangularDetector(): void {
  if (detectorInstance !== null) {
    detectorInstance.stop();
    detectorInstance = null;
  }
}
